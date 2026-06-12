import { Hono } from "hono";
import { createDb, dnsZones, dnsRecords } from "@bezenti/db";
import { and, eq } from "drizzle-orm";
import type { Env } from "../env";
import { getClient, agentFetch } from "./projects";

// Zonas DNS de clientes con verificación de propiedad estilo Cloudflare:
// cada zona recibe un par del pool *.ns.bezenti.com y solo se activa (y se
// publica en PowerDNS) cuando la delegación real en el registrador coincide
// con el par asignado — así nadie puede activar un dominio ajeno apuntándolo
// a nameservers genéricos de Bezenti.
export const dnsRouter = new Hono<{ Bindings: Env }>();

const NS_POOL = [
  "alba", "bruno", "celia", "dante", "elena", "fabio", "gala", "hugo",
  "iris", "juno", "kira", "leon", "mara", "nilo", "olga", "pablo",
  "rosa", "saul", "tania", "ulises",
] as const;

const ZONE_RE   = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
const NAME_RE   = /^(@|\*|(\*\.)?[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)*)$/;
const RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "CAA", "SRV", "PTR"] as const;
type RecordType = (typeof RECORD_TYPES)[number];

function nsPair(): [string, string] {
  const idx = crypto.getRandomValues(new Uint32Array(2));
  const a = NS_POOL[(idx[0] ?? 0) % NS_POOL.length]!;
  let b = NS_POOL[(idx[1] ?? 1) % NS_POOL.length]!;
  if (b === a) b = NS_POOL[(NS_POOL.indexOf(a) + 7) % NS_POOL.length]!;
  return [`${a}.ns.bezenti.com`, `${b}.ns.bezenti.com`];
}

function validateZoneName(zone: string, env: Env): string | null {
  if (!ZONE_RE.test(zone) || zone.length > 253) return "Dominio inválido";
  const infra = env.EMAIL_DOMAIN; // bezenti.com
  if (zone === infra) return "Ese dominio es de Bezenti";
  const reserved = ["mail", "api", "panel", "admin", "www", "pages", "db", "ns", "mta-sts", "autoconfig", "autodiscover", "hosting"];
  if (reserved.some((r) => zone === `${r}.${infra}`)) return "Ese dominio está reservado";
  if ([`.pages.${infra}`, `.db.${infra}`, `.ns.${infra}`].some((s) => zone.endsWith(s))) {
    return "Ese dominio está reservado para la infraestructura de Bezenti";
  }
  return null;
}

type RecordInput = { type: RecordType; name: string; value: string; ttl?: number; priority?: number };

function validateRecord(r: RecordInput): string | null {
  if (!RECORD_TYPES.includes(r.type)) return "Tipo de registro inválido";
  const name = r.name?.trim().toLowerCase() ?? "";
  if (!NAME_RE.test(name)) return "Nombre inválido (usa @ para el apex, o una etiqueta como www)";
  if (!r.value?.trim() || r.value.length > 1024) return "Valor inválido";
  if (r.type === "CNAME" && name === "@") return "No se permite CNAME en el apex (@) — usa un registro A";
  if ((r.type === "MX" || r.type === "SRV") && (r.priority == null || r.priority < 0 || r.priority > 65535)) {
    return "MX y SRV requieren prioridad (0–65535)";
  }
  if (r.ttl != null && (r.ttl < 60 || r.ttl > 86400)) return "TTL fuera de rango (60–86400)";
  return null;
}

// ── Sync hacia PowerDNS (vía agente del node) ────────────────────────────────

type ZoneRow = typeof dnsZones.$inferSelect;

async function syncZone(
  db: ReturnType<typeof createDb>,
  node: { agentUrl: string | null; agentToken: string | null },
  zone: ZoneRow,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const records = await db.query.dnsRecords.findMany({ where: eq(dnsRecords.zoneId, zone.id) });
  const result = await agentFetch(node, `/dns/zones/${zone.zone}`, "PUT", {
    ns: [zone.ns1, zone.ns2],
    records: records.map((r) => ({
      type: r.type, name: r.name, value: r.value, ttl: r.ttl, priority: r.priority ?? 0,
    })),
  });
  console.log("syncZone", zone.zone, JSON.stringify(result), "records:", records.length, "url:", node.agentUrl);
  return result;
}

// Resuelve los NS de la zona. Primero RDAP (la delegación según el REGISTRO —
// no la puede falsear nuestra propia respuesta autoritativa); si el dominio no
// tiene RDAP (p.ej. delegaciones de subdominio), DoH recursivo como fallback.
async function lookupNS(zone: string): Promise<string[]> {
  try {
    const res = await fetch(`https://rdap.org/domain/${zone}`, {
      headers: { Accept: "application/rdap+json" },
      signal:  AbortSignal.timeout(10000),
      redirect: "follow",
    });
    if (res.ok) {
      const data = await res.json<{ nameservers?: { ldhName?: string }[] }>();
      const ns = (data.nameservers ?? [])
        .map((n) => n.ldhName?.toLowerCase().replace(/\.$/, ""))
        .filter((x): x is string => !!x);
      if (ns.length > 0) return ns;
    }
  } catch { /* sin RDAP — fallback recursivo */ }

  const resolvers = [
    `https://cloudflare-dns.com/dns-query?name=${zone}&type=NS`,
    `https://dns.google/resolve?name=${zone}&type=NS`,
  ];
  for (const url of resolvers) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/dns-json" },
        signal:  AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const data = await res.json<{ Status: number; Answer?: { type: number; data: string }[] }>();
      const ns = (data.Answer ?? [])
        .filter((a) => a.type === 2)
        .map((a) => a.data.toLowerCase().replace(/\.$/, ""));
      if (ns.length > 0) return ns;
    } catch { /* probar el siguiente resolver */ }
  }
  return [];
}

async function ownZone(c: { env: Env; get: (k: "user") => { id: string } }, zoneId: string) {
  const db     = createDb(c.env.DB);
  const client = await getClient(db, c.get("user").id);
  if (!client) return null;
  const zone = await db.query.dnsZones.findFirst({
    where: and(eq(dnsZones.id, zoneId), eq(dnsZones.clientId, client.id)),
  });
  return zone ? { db, client, zone } : null;
}

// ── Zonas ─────────────────────────────────────────────────────────────────────

dnsRouter.get("/zones", async (c) => {
  const db     = createDb(c.env.DB);
  const client = await getClient(db, c.get("user").id);
  if (!client) return c.json({ error: "no hosting found" }, 404);

  const rows = await db.query.dnsZones.findMany({
    where: eq(dnsZones.clientId, client.id),
    with:  { records: true },
  });
  return c.json(rows);
});

dnsRouter.post("/zones", async (c) => {
  const body = await c.req.json<{ zone: string }>();
  const zone = body.zone?.trim().toLowerCase().replace(/\.$/, "") ?? "";

  const invalid = validateZoneName(zone, c.env);
  if (invalid) return c.json({ error: invalid }, 400);

  const db     = createDb(c.env.DB);
  const client = await getClient(db, c.get("user").id);
  if (!client) return c.json({ error: "no hosting found" }, 404);
  if (client.status !== "active") return c.json({ error: "Tu hosting está suspendido" }, 403);

  const taken = await db.query.dnsZones.findFirst({ where: eq(dnsZones.zone, zone) });
  if (taken) return c.json({ error: `La zona ${zone} ya está registrada` }, 409);

  const [ns1, ns2] = nsPair();
  const id = crypto.randomUUID();
  await db.insert(dnsZones).values({ id, clientId: client.id, zone, ns1, ns2, createdAt: new Date() });

  // Registros iniciales: la web del cliente apuntando a su node
  if (client.node?.ipPublic) {
    await db.insert(dnsRecords).values([
      { id: crypto.randomUUID(), zoneId: id, type: "A", name: "@", value: client.node.ipPublic, ttl: 3600, createdAt: new Date() },
      { id: crypto.randomUUID(), zoneId: id, type: "CNAME", name: "www", value: "@", ttl: 3600, createdAt: new Date() },
    ]);
  }

  // Publicar en PowerDNS desde ya (estilo Cloudflare): nadie la consulta hasta
  // que exista la delegación, y al delegar empieza a servir al instante.
  // Sin esto, la consulta NS recursiva del verify daría SERVFAIL (zona lame).
  if (client.node) {
    // best-effort: verify re-sincroniza si esto falla
    const sync = await syncZone(db, client.node, {
      id, clientId: client.id, zone, ns1, ns2,
      status: "pending", verifiedAt: null, createdAt: new Date(),
    });
    if (!sync.ok) console.error(`sync inicial de ${zone} falló:`, sync.error);
  }

  return c.json({ id, zone, ns1, ns2, status: "pending" }, 201);
});

dnsRouter.delete("/zones/:id", async (c) => {
  const own = await ownZone(c, c.req.param("id"));
  if (!own) return c.json({ error: "Zona no encontrada" }, 404);

  if (own.client.node) {
    await agentFetch(own.client.node, `/dns/zones/${own.zone.zone}`, "DELETE"); // best-effort
  }
  await own.db.delete(dnsZones).where(eq(dnsZones.id, own.zone.id));
  return c.body(null, 204);
});

// Verificación de propiedad: la delegación vista en internet debe coincidir
// con el par asignado a ESTA zona. Al pasar, la zona se publica en PowerDNS.
dnsRouter.post("/zones/:id/verify", async (c) => {
  const own = await ownZone(c, c.req.param("id"));
  if (!own) return c.json({ error: "Zona no encontrada" }, 404);
  const { db, client, zone } = own;

  const seen = await lookupNS(zone.zone);
  if (seen.length === 0) {
    return c.json({
      error: "Aún no vemos nameservers para tu dominio. Configura el par asignado en tu registrador y espera la propagación (puede tardar hasta 48h, normalmente minutos).",
      seen,
    }, 409);
  }

  const assigned = [zone.ns1, zone.ns2].filter((x): x is string => !!x);
  const hasAssigned = assigned.every((n) => seen.includes(n));
  const foreignPool = seen.some((n) => n.endsWith(".ns.bezenti.com") && !assigned.includes(n));

  if (!hasAssigned || foreignPool) {
    return c.json({
      error: `Los nameservers actuales (${seen.join(", ")}) no coinciden con los asignados a tu cuenta. Debes usar exactamente: ${assigned.join(" y ")}.`,
      seen,
    }, 409);
  }

  if (!client.node) return c.json({ error: "El hosting no tiene node asignado" }, 409);
  const sync = await syncZone(db, client.node, zone);
  if (!sync.ok) return c.json({ error: `Verificado, pero falló la publicación: ${sync.error}` }, 502);

  await db.update(dnsZones)
    .set({ status: "active", verifiedAt: new Date() })
    .where(eq(dnsZones.id, zone.id));
  return c.json({ ok: true, status: "active" });
});

// ── Records ───────────────────────────────────────────────────────────────────

async function mutateRecords(
  c: { env: Env; get: (k: "user") => { id: string } },
  zoneId: string,
  mutate: (db: ReturnType<typeof createDb>, zone: ZoneRow) => Promise<string | null>,
): Promise<{ status: 200 | 400 | 404 | 502; body: Record<string, unknown> }> {
  const own = await ownZone(c, zoneId);
  if (!own) return { status: 404, body: { error: "Zona no encontrada" } };

  const err = await mutate(own.db, own.zone);
  if (err) return { status: 400, body: { error: err } };

  // Publicar el estado completo (la zona vive en PowerDNS desde su creación)
  if (own.client.node) {
    const sync = await syncZone(own.db, own.client.node, own.zone);
    if (!sync.ok) return { status: 502, body: { error: `Guardado, pero falló la publicación: ${sync.error}` } };
  }
  return { status: 200, body: { ok: true } };
}

dnsRouter.post("/zones/:zoneId/records", async (c) => {
  const body = await c.req.json<RecordInput>();
  const invalid = validateRecord(body);
  if (invalid) return c.json({ error: invalid }, 400);

  const id = crypto.randomUUID();
  const result = await mutateRecords(c, c.req.param("zoneId"), async (db, zone) => {
    await db.insert(dnsRecords).values({
      id,
      zoneId:    zone.id,
      type:      body.type,
      name:      body.name.trim().toLowerCase(),
      value:     body.value.trim(),
      ttl:       body.ttl ?? 3600,
      priority:  body.priority,
      createdAt: new Date(),
    });
    return null;
  });
  return c.json({ ...result.body, id }, result.status === 200 ? 201 : result.status);
});

dnsRouter.patch("/zones/:zoneId/records/:id", async (c) => {
  const body = await c.req.json<RecordInput>();
  const invalid = validateRecord(body);
  if (invalid) return c.json({ error: invalid }, 400);

  const recordId = c.req.param("id");
  const result = await mutateRecords(c, c.req.param("zoneId"), async (db, zone) => {
    const existing = await db.query.dnsRecords.findFirst({
      where: and(eq(dnsRecords.id, recordId), eq(dnsRecords.zoneId, zone.id)),
    });
    if (!existing) return "Registro no encontrado";
    await db.update(dnsRecords).set({
      type:     body.type,
      name:     body.name.trim().toLowerCase(),
      value:    body.value.trim(),
      ttl:      body.ttl ?? 3600,
      priority: body.priority ?? null,
    }).where(eq(dnsRecords.id, recordId));
    return null;
  });
  return c.json(result.body, result.status);
});

dnsRouter.delete("/zones/:zoneId/records/:id", async (c) => {
  const recordId = c.req.param("id");
  const result = await mutateRecords(c, c.req.param("zoneId"), async (db, zone) => {
    const existing = await db.query.dnsRecords.findFirst({
      where: and(eq(dnsRecords.id, recordId), eq(dnsRecords.zoneId, zone.id)),
    });
    if (!existing) return "Registro no encontrado";
    await db.delete(dnsRecords).where(eq(dnsRecords.id, recordId));
    return null;
  });
  return c.json(result.body, result.status);
});
