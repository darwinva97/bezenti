import { Hono } from "hono";
import { createDb, emailAccounts } from "@bezenti/db";
import { and, eq } from "drizzle-orm";
import type { Env } from "../env";
import { getClient, ensureAccountSlug } from "./projects";

// Correos corporativos vía Stalwart Mail Server (v0.16, API JMAP).
// El dominio de buzones de un cliente es <accountSlug>.<EMAIL_DOMAIN>; al
// crear el primer buzón se registra el dominio en Stalwart (DKIM automático)
// y se crean los registros MX/SPF en Cloudflare.
export const emailRouter = new Hono<{ Bindings: Env }>();

const LOCAL_PART_RE = /^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$/;
const MIN_QUOTA_MB = 256;
const MAX_QUOTA_MB = 10240;

function emailDomainFor(slug: string, env: Env): string {
  return `${slug}.${env.EMAIL_DOMAIN}`;
}

function generatePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, () =>
    "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)] ?? "x",
  );
}

// ── Stalwart JMAP ─────────────────────────────────────────────────────────────

type JmapCall = [string, Record<string, unknown>, string];

async function stalwartJmap(env: Env, calls: JmapCall[]): Promise<JmapCall[]> {
  // STALWART_TOKEN: "usuario:contraseña" → Basic; cualquier otra cosa → Bearer
  const auth = env.STALWART_TOKEN.includes(":")
    ? `Basic ${btoa(env.STALWART_TOKEN)}`
    : `Bearer ${env.STALWART_TOKEN}`;

  const res = await fetch(`${env.STALWART_URL}/jmap`, {
    method:  "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      using:       ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"],
      methodCalls: calls,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`Stalwart respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json<{ methodResponses: JmapCall[] }>();
  return data.methodResponses;
}

// Extrae el resultado de un Foo/set: id creado o error legible
function setResult(responses: JmapCall[], key: string): { id?: string; error?: string } {
  for (const [method, args] of responses) {
    if (method === "error") {
      return { error: (args as { description?: string; type?: string }).description ?? String((args as { type?: string }).type) };
    }
    const created    = (args as { created?: Record<string, { id: string }> }).created;
    const notCreated = (args as { notCreated?: Record<string, { description?: string; type?: string; properties?: string[] }> }).notCreated;
    if (created?.[key]) return { id: created[key].id };
    if (notCreated?.[key]) {
      const e     = notCreated[key];
      const props = e.properties?.length ? ` (${e.properties.join(", ")})` : "";
      return { error: `${e.description ?? e.type ?? "rechazado por el servidor de correo"}${props}` };
    }
  }
  return { error: "respuesta inesperada del servidor de correo" };
}

// Busca (o crea) el dominio en Stalwart y devuelve su id.
async function ensureStalwartDomain(env: Env, domain: string): Promise<string> {
  const [get] = await stalwartJmap(env, [["x:Domain/get", { ids: null }, "c0"]]);
  const list   = (get?.[1] as { list?: { id: string; name: string }[] })?.list ?? [];
  const found  = list.find((d) => d.name === domain);
  if (found) return found.id;

  const responses = await stalwartJmap(env, [[
    "x:Domain/set",
    {
      create: {
        d1: {
          name: domain,
          // El cert TLS lo cubre mail.<EMAIL_DOMAIN> (los clientes IMAP/SMTP
          // se conectan ahí) — no emitir ACME por dominio de buzones.
          certificateManagement: { "@type": "Manual" },
          dkimManagement:        { "@type": "Automatic" },
          dnsManagement:         { "@type": "Manual" },
          subAddressing:         { "@type": "Enabled" },
        },
      },
    },
    "c1",
  ]]);
  const result = setResult(responses, "d1");
  if (!result.id) throw new Error(`No se pudo registrar el dominio de correo: ${result.error}`);
  return result.id;
}

// ── Cloudflare DNS: MX + SPF por dominio de cuenta (idempotente) ─────────────

async function ensureMailDns(env: Env, domain: string): Promise<void> {
  if (!env.CF_DNS_TOKEN || !env.CF_ZONE_ID) return; // sin token no hay automatización
  const base    = `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/dns_records`;
  const headers = { Authorization: `Bearer ${env.CF_DNS_TOKEN}`, "Content-Type": "application/json" };

  const existing = await fetch(`${base}?name=${domain}&per_page=50`, { headers });
  const records  = ((await existing.json<{ result?: { type: string }[] }>()).result) ?? [];

  const wanted: Record<string, unknown>[] = [];
  if (!records.some((r) => r.type === "MX")) {
    wanted.push({ type: "MX", name: domain, content: env.MAIL_HOST, priority: 10, ttl: 3600,
                  comment: "Bezenti correo corporativo" });
  }
  if (!records.some((r) => r.type === "TXT")) {
    wanted.push({ type: "TXT", name: domain, content: `"v=spf1 mx ~all"`, ttl: 3600,
                  comment: "Bezenti correo corporativo (SPF)" });
  }
  for (const record of wanted) {
    const res  = await fetch(base, { method: "POST", headers, body: JSON.stringify(record) });
    const body = await res.json<{ success: boolean; errors?: { message: string }[] }>();
    if (!body.success) {
      throw new Error(`No se pudo crear el registro DNS ${record["type"]}: ${body.errors?.[0]?.message}`);
    }
  }
}

// ── Rutas ─────────────────────────────────────────────────────────────────────

emailRouter.get("/", async (c) => {
  const user   = c.get("user");
  const db     = createDb(c.env.DB);
  const client = await getClient(db, user.id);
  if (!client) return c.json({ error: "no hosting found" }, 404);

  const slug   = await ensureAccountSlug(db, client, user.name || (user.email.split("@")[0] ?? user.email));
  const domain = emailDomainFor(slug, c.env);

  const rows = await db.query.emailAccounts.findMany({
    where: eq(emailAccounts.clientId, client.id),
  });

  // Enriquecer con el uso real de disco (best-effort — si Stalwart no
  // responde, la lista sale igual con el último valor conocido).
  const ids = rows.map((r) => r.stalwartId).filter((x): x is string => !!x);
  if (ids.length > 0) {
    try {
      const [get] = await stalwartJmap(c.env, [["x:Account/get", { ids }, "c0"]]);
      const list  = (get?.[1] as { list?: { id: string; usedDiskQuota?: number }[] })?.list ?? [];
      for (const acc of list) {
        const row = rows.find((r) => r.stalwartId === acc.id);
        if (row && typeof acc.usedDiskQuota === "number") {
          row.usedMb = Math.round(acc.usedDiskQuota / 1024 / 1024);
          await db.update(emailAccounts).set({ usedMb: row.usedMb }).where(eq(emailAccounts.id, row.id));
        }
      }
    } catch { /* best-effort */ }
  }

  return c.json({
    domain,
    mailHost: c.env.MAIL_HOST,
    accounts: rows.map((r) => ({
      id: r.id, email: r.email, quotaMb: r.quotaMb, usedMb: r.usedMb,
      status: r.status, createdAt: r.createdAt,
    })),
  });
});

emailRouter.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ local: string; quotaMb?: number }>();

  const local = body.local?.trim().toLowerCase() ?? "";
  if (!LOCAL_PART_RE.test(local)) {
    return c.json({ error: "Nombre inválido: usa letras minúsculas, números, punto, guion o guion bajo" }, 400);
  }
  const quotaMb = Math.min(Math.max(body.quotaMb ?? 1024, MIN_QUOTA_MB), MAX_QUOTA_MB);

  const db     = createDb(c.env.DB);
  const client = await getClient(db, user.id);
  if (!client) return c.json({ error: "no hosting found" }, 404);
  if (client.status !== "active") return c.json({ error: "Tu hosting está suspendido" }, 403);

  const slug   = await ensureAccountSlug(db, client, user.name || (user.email.split("@")[0] ?? user.email));
  const domain = emailDomainFor(slug, c.env);
  const email  = `${local}@${domain}`;

  const dup = await db.query.emailAccounts.findFirst({ where: eq(emailAccounts.email, email) });
  if (dup) return c.json({ error: `El buzón ${email} ya existe` }, 409);

  const domainId = await ensureStalwartDomain(c.env, domain);
  await ensureMailDns(c.env, domain);

  const password  = generatePassword();
  const responses = await stalwartJmap(c.env, [[
    "x:Account/set",
    {
      create: {
        a1: {
          "@type":     "User",
          name:        local,
          domainId,
          description: `Bezenti ${client.id}`,
          credentials: { "0": { "@type": "Password", secret: password } },
          quotas:      { maxDiskQuota: quotaMb * 1024 * 1024 },
        },
      },
    },
    "c1",
  ]]);
  const result = setResult(responses, "a1");
  if (!result.id) return c.json({ error: `No se pudo crear el buzón: ${result.error}` }, 502);

  const id = crypto.randomUUID();
  await db.insert(emailAccounts).values({
    id,
    clientId:   client.id,
    email,
    stalwartId: result.id,
    quotaMb,
    createdAt:  new Date(),
  });

  // La contraseña se muestra UNA sola vez — no se almacena en ningún lado.
  return c.json({ id, email, password, quotaMb }, 201);
});

// Resuelve un buzón verificando que pertenece al cliente de la sesión.
async function ownAccount(c: { env: Env; get: (k: "user") => { id: string } }, accountId: string) {
  const db     = createDb(c.env.DB);
  const client = await getClient(db, c.get("user").id);
  if (!client) return null;
  const account = await db.query.emailAccounts.findFirst({
    where: and(eq(emailAccounts.id, accountId), eq(emailAccounts.clientId, client.id)),
  });
  return account ? { db, account } : null;
}

emailRouter.post("/:id/password", async (c) => {
  const own = await ownAccount(c, c.req.param("id"));
  if (!own?.account.stalwartId) return c.json({ error: "Buzón no encontrado" }, 404);

  const password  = generatePassword();
  const responses = await stalwartJmap(c.env, [[
    "x:Account/set",
    { update: { [own.account.stalwartId]: { credentials: { "0": { "@type": "Password", secret: password } } } } },
    "c1",
  ]]);
  // JMAP devuelve "updated": { "<id>": null } — comprobar presencia de la clave
  const args = responses[0]?.[1] as { updated?: Record<string, unknown>; notUpdated?: Record<string, { description?: string }> };
  if (!args?.updated || !(own.account.stalwartId in args.updated)) {
    return c.json({ error: `No se pudo cambiar la contraseña: ${args?.notUpdated?.[own.account.stalwartId]?.description ?? "error del servidor de correo"}` }, 502);
  }
  return c.json({ email: own.account.email, password });
});

emailRouter.patch("/:id/quota", async (c) => {
  const { quotaMb } = await c.req.json<{ quotaMb: number }>();
  const quota = Math.min(Math.max(quotaMb || 0, MIN_QUOTA_MB), MAX_QUOTA_MB);

  const own = await ownAccount(c, c.req.param("id"));
  if (!own?.account.stalwartId) return c.json({ error: "Buzón no encontrado" }, 404);

  await stalwartJmap(c.env, [[
    "x:Account/set",
    { update: { [own.account.stalwartId]: { quotas: { maxDiskQuota: quota * 1024 * 1024 } } } },
    "c1",
  ]]);
  await own.db.update(emailAccounts).set({ quotaMb: quota }).where(eq(emailAccounts.id, own.account.id));
  return c.json({ ok: true, quotaMb: quota });
});

emailRouter.delete("/:id", async (c) => {
  const own = await ownAccount(c, c.req.param("id"));
  if (!own) return c.json({ error: "Buzón no encontrado" }, 404);

  if (own.account.stalwartId) {
    const responses = await stalwartJmap(c.env, [[
      "x:Account/set", { destroy: [own.account.stalwartId] }, "c1",
    ]]);
    const args = responses[0]?.[1] as { destroyed?: string[]; notDestroyed?: Record<string, { description?: string }> };
    if (!args?.destroyed?.includes(own.account.stalwartId)) {
      return c.json({ error: `No se pudo eliminar el buzón del servidor de correo: ${args?.notDestroyed?.[own.account.stalwartId]?.description ?? "error desconocido"}` }, 502);
    }
  }
  // Hard-delete: email es UNIQUE y el cliente debe poder recrear la dirección.
  await own.db.delete(emailAccounts).where(eq(emailAccounts.id, own.account.id));
  return c.body(null, 204);
});
