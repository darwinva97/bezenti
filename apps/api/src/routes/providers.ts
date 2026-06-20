import { Hono } from "hono";
import { createDb, providers, nodes } from "@bezenti/db";
import { eq } from "drizzle-orm";
import type { Env } from "../env";
import { bytesToHex, sha256, AGENT_PORT } from "./provision";

export const providersRouter = new Hono<{ Bindings: Env }>();

// ── Helpers comunes ───────────────────────────────────────────────────────────

// cloud-init: arranca el bootstrap del agente sin necesidad de SSH.
function bootstrapUserData(bootstrapUrl: string): string {
  return `#!/bin/bash
curl -fsSL '${bootstrapUrl}' | bash > /var/log/bezenti-install.log 2>&1
`;
}

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined),
    obj,
  );
}

// Sustituye {{clave}} en una plantilla con el mapa dado.
function render(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
}

type CustomConfig = {
  create: {
    url:     string;
    method?: string;
    headers?: Record<string, string>;
    body?:   string;   // plantilla (debe quedar como JSON válido tras render)
    ipPath:  string;   // ruta al IP en la respuesta, ej "server.ip"
    idPath?: string;   // ruta al id del servidor (para borrarlo luego)
  };
  delete?: {
    urlTemplate: string;       // ej "https://api.x.com/servers/{{id}}"
    method?:     string;
    headers?:    Record<string, string>;
  };
};

// ── Adaptador Hetzner Cloud ───────────────────────────────────────────────────

const HETZNER_API = "https://api.hetzner.cloud/v1";

async function hetzner(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`${HETZNER_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  if (!res.ok) {
    const err = data["error"] as { message?: string } | undefined;
    throw new Error(err?.message ?? `Hetzner respondió ${res.status}`);
  }
  return data;
}

// ── CRUD de proveedores ───────────────────────────────────────────────────────

// Nunca devolver el token; solo si está presente.
function maskProvider(p: typeof providers.$inferSelect) {
  return {
    id: p.id, name: p.name, kind: p.kind,
    hasToken: !!p.apiToken, isActive: p.isActive, createdAt: p.createdAt,
  };
}

providersRouter.get("/", async (c) => {
  const db   = createDb(c.env.DB);
  const rows = await db.query.providers.findMany();
  return c.json(rows.map(maskProvider));
});

providersRouter.post("/", async (c) => {
  const body = await c.req.json<{ name: string; kind: "hetzner" | "custom"; apiToken: string; config?: string }>();
  if (!body.name?.trim() || !body.apiToken?.trim()) {
    return c.json({ error: "name y apiToken son requeridos" }, 400);
  }
  if (body.kind !== "hetzner" && body.kind !== "custom") {
    return c.json({ error: "kind debe ser 'hetzner' o 'custom'" }, 400);
  }
  if (body.kind === "custom") {
    try {
      const cfg = JSON.parse(body.config ?? "{}") as CustomConfig;
      if (!cfg.create?.url || !cfg.create?.ipPath) {
        return c.json({ error: "El config custom requiere create.url y create.ipPath" }, 400);
      }
    } catch {
      return c.json({ error: "El config custom no es JSON válido" }, 400);
    }
  }

  const db = createDb(c.env.DB);
  const id = crypto.randomUUID();
  await db.insert(providers).values({
    id,
    name:      body.name.trim(),
    kind:      body.kind,
    apiToken:  body.apiToken.trim(),
    config:    body.kind === "custom" ? (body.config ?? null) : null,
    createdAt: new Date(),
  });
  return c.json({ id }, 201);
});

providersRouter.patch("/:id", async (c) => {
  const body = await c.req.json<Partial<{ name: string; apiToken: string; config: string; isActive: boolean }>>();
  const db   = createDb(c.env.DB);
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined)     patch["name"] = body.name;
  if (body.apiToken !== undefined && body.apiToken.trim()) patch["apiToken"] = body.apiToken.trim();
  if (body.config !== undefined)   patch["config"] = body.config;
  if (body.isActive !== undefined) patch["isActive"] = body.isActive;
  await db.update(providers).set(patch).where(eq(providers.id, c.req.param("id")));
  return c.json({ ok: true });
});

providersRouter.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param("id");
  const linked = await db.query.nodes.findMany({ where: eq(nodes.providerId, id), columns: { id: true } });
  if (linked.length > 0) {
    return c.json({ error: `Hay ${linked.length} nodo(s) creados con este proveedor. Elimínalos primero.` }, 409);
  }
  await db.delete(providers).where(eq(providers.id, id));
  return c.body(null, 204);
});

// ── Opciones de Hetzner (para los desplegables del modal) ─────────────────────

providersRouter.get("/:id/options", async (c) => {
  const db       = createDb(c.env.DB);
  const provider = await db.query.providers.findFirst({ where: eq(providers.id, c.req.param("id")) });
  if (!provider) return c.json({ error: "not found" }, 404);
  if (provider.kind !== "hetzner") return c.json({ serverTypes: [], locations: [] });

  try {
    const [types, locs] = await Promise.all([
      hetzner(provider.apiToken, "/server_types?per_page=50"),
      hetzner(provider.apiToken, "/locations"),
    ]);
    const serverTypes = ((types["server_types"] as Array<Record<string, unknown>>) ?? [])
      .filter((t) => !(t["deprecated"]))
      .map((t) => {
        const price = (t["prices"] as Array<{ price_monthly?: { gross?: string } }> | undefined)?.[0]?.price_monthly?.gross;
        return {
          name:     t["name"] as string,
          cores:    t["cores"] as number,
          memory:   t["memory"] as number,
          disk:     t["disk"] as number,
          priceMonthly: price ? Number(price).toFixed(2) : null,
        };
      });
    const locations = ((locs["locations"] as Array<Record<string, unknown>>) ?? []).map((l) => ({
      name: l["name"] as string, city: l["city"] as string, country: l["country"] as string,
    }));
    return c.json({ serverTypes, locations });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Error consultando Hetzner" }, 502);
  }
});

// ── Crear un VPS a través del proveedor ───────────────────────────────────────

providersRouter.post("/:id/nodes", async (c) => {
  const body = await c.req.json<{
    name: string; serverType?: string; location?: string; image?: string;
  }>();
  if (!body.name?.trim()) return c.json({ error: "El nombre es requerido" }, 400);

  const db       = createDb(c.env.DB);
  const provider = await db.query.providers.findFirst({ where: eq(providers.id, c.req.param("id")) });
  if (!provider) return c.json({ error: "Proveedor no encontrado" }, 404);

  const nodeId       = crypto.randomUUID();
  const agentToken   = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash    = await sha256(agentToken);
  const bootstrapUrl = `${c.env.BETTER_AUTH_URL}/bootstrap/${nodeId}?t=${agentToken}`;
  const userData     = bootstrapUserData(bootstrapUrl);

  let ip: string;
  let externalId: string;
  let region: string | undefined;

  try {
    if (provider.kind === "hetzner") {
      const serverType = body.serverType || "cx22";
      const image      = body.image || "debian-12";
      const location   = body.location || "nbg1";
      region = location;
      const data = await hetzner(provider.apiToken, "/servers", {
        method: "POST",
        body: JSON.stringify({
          name:               body.name.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-"),
          server_type:        serverType,
          image,
          location,
          start_after_create: true,
          user_data:          userData,
          labels:             { managed_by: "bezenti" },
        }),
      });
      const server = data["server"] as { id?: number; public_net?: { ipv4?: { ip?: string } } } | undefined;
      ip         = server?.public_net?.ipv4?.ip ?? "";
      externalId = String(server?.id ?? "");
      if (!ip || !externalId) throw new Error("Hetzner no devolvió IP o id del servidor");
    } else {
      // Adaptador custom: renderiza la plantilla y extrae IP/id de la respuesta.
      const cfg = JSON.parse(provider.config ?? "{}") as CustomConfig;
      const vars: Record<string, string> = {
        token:          provider.apiToken,
        name:           body.name.trim(),
        bootstrap_url:  bootstrapUrl,
        user_data:      userData,
        user_data_json: JSON.stringify(userData),
      };
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(cfg.create.headers ?? {})) headers[k] = render(v, vars);
      const res = await fetch(render(cfg.create.url, vars), {
        method:  cfg.create.method ?? "POST",
        headers,
        body:    cfg.create.body ? render(cfg.create.body, vars) : undefined,
        signal:  AbortSignal.timeout(30000),
      });
      const respData = await res.json<unknown>().catch(() => ({}));
      if (!res.ok) throw new Error(`El proveedor respondió ${res.status}`);
      ip         = String(getPath(respData, cfg.create.ipPath) ?? "");
      externalId = cfg.create.idPath ? String(getPath(respData, cfg.create.idPath) ?? "") : "";
      if (!ip) throw new Error("La respuesta del proveedor no trajo IP (revisa ipPath)");
    }
  } catch (err) {
    return c.json({ error: `No se pudo crear el VPS: ${err instanceof Error ? err.message : err}` }, 502);
  }

  await db.insert(nodes).values({
    id:             nodeId,
    name:           body.name.trim(),
    provider:       provider.kind,
    providerId:     provider.id,
    externalId,
    region,
    ipPublic:       ip,
    agentUrl:       `http://${ip}:${AGENT_PORT}`,
    agentTokenHash: tokenHash,
    agentToken,
    status:         "provisioning",
    createdAt:      new Date(),
  });

  return c.json({ nodeId, ip }, 201);
});

// Borra el servidor en el proveedor (best-effort). Lo usa el DELETE de nodos.
export async function deleteProviderServer(
  provider: typeof providers.$inferSelect,
  externalId: string,
): Promise<void> {
  if (!externalId) return;
  if (provider.kind === "hetzner") {
    await hetzner(provider.apiToken, `/servers/${externalId}`, { method: "DELETE" });
    return;
  }
  const cfg = JSON.parse(provider.config ?? "{}") as CustomConfig;
  if (!cfg.delete?.urlTemplate) return;
  const vars = { token: provider.apiToken, id: externalId };
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(cfg.delete.headers ?? {})) headers[k] = render(v, vars);
  await fetch(render(cfg.delete.urlTemplate, vars), {
    method: cfg.delete.method ?? "DELETE",
    headers,
    signal: AbortSignal.timeout(30000),
  });
}
