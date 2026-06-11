import { Hono } from "hono";
import { createDb } from "@bezenti/db";
import type { Env } from "../env";
import { getClient } from "./projects";

// Explorador de archivos del portal: proxy fino hacia el agente del node.
// El agente scopea todo a /var/www/<linuxUser> y valida traversal; aquí solo
// resolvemos el cliente de la sesión y reenviamos (incluyendo streams de
// subida/descarga, que no deben bufferizarse en el Worker).
export const filesRouter = new Hono<{ Bindings: Env }>();

type AgentCtx = {
  agentUrl: string;
  agentToken: string;
  linuxUser: string;
};

async function agentCtx(c: { env: Env; get: (k: "user") => { id: string } }): Promise<AgentCtx | { error: string; status: 403 | 404 | 409 }> {
  const db = createDb(c.env.DB);
  const client = await getClient(db, c.get("user").id);
  if (!client) return { error: "no hosting found", status: 404 };
  if (client.status !== "active") return { error: "Tu hosting está suspendido", status: 403 };
  if (!client.node?.agentUrl || !client.node.agentToken) {
    return { error: "El node no tiene agente configurado", status: 409 };
  }
  return {
    agentUrl: client.node.agentUrl,
    agentToken: client.node.agentToken,
    linuxUser: client.linuxUser,
  };
}

function isErr(ctx: AgentCtx | { error: string; status: 403 | 404 | 409 }): ctx is { error: string; status: 403 | 404 | 409 } {
  return "error" in ctx;
}

function agentQueryURL(ctx: AgentCtx, endpoint: string, path: string): string {
  const u = new URL(`${ctx.agentUrl}/files/${endpoint}`);
  u.searchParams.set("user", ctx.linuxUser);
  u.searchParams.set("path", path);
  return u.toString();
}

// Los errores del agente llegan como texto plano → normalizar a {error}
async function agentError(res: Response) {
  const detail = (await res.text()).slice(0, 500).trim();
  return { error: detail || `El agente respondió ${res.status}` };
}

filesRouter.get("/list", async (c) => {
  const ctx = await agentCtx(c);
  if (isErr(ctx)) return c.json({ error: ctx.error }, ctx.status);

  const res = await fetch(agentQueryURL(ctx, "list", c.req.query("path") ?? ""), {
    headers: { "X-Agent-Token": ctx.agentToken },
    signal:  AbortSignal.timeout(30000),
  });
  if (!res.ok) return c.json(await agentError(res), 400);
  return c.json(await res.json());
});

// Lectura cruda (editor y descarga). ?download=1 fuerza attachment.
filesRouter.get("/read", async (c) => {
  const ctx = await agentCtx(c);
  if (isErr(ctx)) return c.json({ error: ctx.error }, ctx.status);

  const path = c.req.query("path") ?? "";
  const res = await fetch(agentQueryURL(ctx, "read", path), {
    headers: { "X-Agent-Token": ctx.agentToken },
  });
  if (!res.ok) return c.json(await agentError(res), 400);

  const name    = path.split("/").pop() || "archivo";
  const headers = new Headers({ "Content-Type": "application/octet-stream" });
  const len     = res.headers.get("Content-Length");
  if (len) headers.set("Content-Length", len);
  if (c.req.query("download") === "1") {
    headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  }
  return new Response(res.body, { headers });
});

// Carpeta (o archivo) como zip
filesRouter.get("/zip", async (c) => {
  const ctx = await agentCtx(c);
  if (isErr(ctx)) return c.json({ error: ctx.error }, ctx.status);

  const path = c.req.query("path") ?? "";
  const res = await fetch(agentQueryURL(ctx, "zip", path), {
    headers: { "X-Agent-Token": ctx.agentToken },
  });
  if (!res.ok) return c.json(await agentError(res), 400);

  const name = (path.split("/").pop() || "archivos") + ".zip";
  return new Response(res.body, {
    headers: {
      "Content-Type":        "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
});

// Subida / guardado del editor: el body viaja crudo hasta el agente.
filesRouter.put("/upload", async (c) => {
  const ctx = await agentCtx(c);
  if (isErr(ctx)) return c.json({ error: ctx.error }, ctx.status);

  const res = await fetch(agentQueryURL(ctx, "write", c.req.query("path") ?? ""), {
    method:  "PUT",
    headers: { "X-Agent-Token": ctx.agentToken },
    body:    c.req.raw.body,
  });
  if (!res.ok) return c.json(await agentError(res), 400);
  return c.json(await res.json());
});

// Mutaciones JSON: el portal manda solo las rutas; el user lo añade el Worker.
const JSON_OPS = ["mkdir", "rename", "copy", "delete", "chmod", "extract"] as const;

for (const op of JSON_OPS) {
  filesRouter.post(`/${op}`, async (c) => {
    const ctx = await agentCtx(c);
    if (isErr(ctx)) return c.json({ error: ctx.error }, ctx.status);

    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const res = await fetch(`${ctx.agentUrl}/files/${op}`, {
      method:  "POST",
      headers: { "X-Agent-Token": ctx.agentToken, "Content-Type": "application/json" },
      body:    JSON.stringify({ ...body, user: ctx.linuxUser }),
      signal:  AbortSignal.timeout(120000),
    });
    if (!res.ok) return c.json(await agentError(res), 400);
    return c.body(null, 204);
  });
}
