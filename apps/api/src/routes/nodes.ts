import { Hono } from "hono";
import { createDb, nodes, nodeMetrics } from "@bezenti/db";
import { eq, desc } from "drizzle-orm";
import type { Env } from "../env";
import { sshRun } from "../lib/ssh";
import { bytesToHex, sha256, AGENT_PORT } from "./provision";

export const nodesRouter = new Hono<{ Bindings: Env }>();

// Deriva la versión objetivo del agente del último segmento de AGENT_BINARY_URL,
// ej: ".../agent/v0.2.0" → "0.2.0".
function agentTargetVersion(binaryUrl: string | undefined): string | null {
  if (!binaryUrl) return null;
  const seg = binaryUrl.replace(/\/+$/, "").split("/").pop() ?? "";
  return seg.replace(/^v/, "") || null;
}

nodesRouter.get("/", async (c) => {
  const db   = createDb(c.env.DB);
  const rows = await db.query.nodes.findMany({
    orderBy: desc(nodes.createdAt),
  });
  return c.json(rows);
});

nodesRouter.get("/:id", async (c) => {
  const db   = createDb(c.env.DB);
  const node = await db.query.nodes.findFirst({
    where: eq(nodes.id, c.req.param("id")),
    with:  { clients: true },
  });
  if (!node) return c.json({ error: "not found" }, 404);
  return c.json(node);
});

nodesRouter.post("/", async (c) => {
  const body = await c.req.json<{
    name: string; provider: string; region?: string;
    ipPublic: string; agentUrl: string; agentTokenHash: string;
    diskGbTotal?: number; ramMbTotal?: number;
  }>();

  const db = createDb(c.env.DB);
  const id = crypto.randomUUID();

  await db.insert(nodes).values({
    id,
    name:           body.name,
    provider:       body.provider,
    region:         body.region,
    ipPublic:       body.ipPublic,
    agentUrl:       body.agentUrl,
    agentTokenHash: body.agentTokenHash,
    diskGbTotal:    body.diskGbTotal,
    ramMbTotal:     body.ramMbTotal,
    status:         "provisioning",
    createdAt:      new Date(),
  });

  return c.json({ id }, 201);
});

nodesRouter.patch("/:id/status", async (c) => {
  const { status } = await c.req.json<{ status: "ready" | "degraded" | "offline" }>();
  const db = createDb(c.env.DB);

  await db
    .update(nodes)
    .set({ status })
    .where(eq(nodes.id, c.req.param("id")));

  return c.json({ ok: true });
});

// ── POST /admin/nodes/:id/reset ───────────────────────────────────────────────
// Reestablece un nodo atascado en "provisioning": regenera el token del agente
// y devuelve un comando bootstrap nuevo. Si se envían credenciales SSH,
// relanza la instalación automáticamente.
nodesRouter.post("/:id/reset", async (c) => {
  const id   = c.req.param("id");
  const body = await c.req
    .json<{ port?: number; sshUser?: string; sshPassword?: string }>()
    .catch(() => ({}) as { port?: number; sshUser?: string; sshPassword?: string });

  const db   = createDb(c.env.DB);
  const node = await db.query.nodes.findFirst({ where: eq(nodes.id, id) });
  if (!node) return c.json({ error: "not found" }, 404);

  const agentToken = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash  = await sha256(agentToken);

  await db
    .update(nodes)
    .set({
      agentTokenHash: tokenHash,
      agentToken,
      agentUrl:       `http://${node.ipPublic}:${AGENT_PORT}`,
      status:         "provisioning",
      lastHeartbeatAt: null,
    })
    .where(eq(nodes.id, id));

  const bootstrapUrl = `${c.env.BETTER_AUTH_URL}/bootstrap/${id}?t=${agentToken}`;
  const sshCmd       = `nohup bash -c "curl -fsSL '${bootstrapUrl}' | bash" > /var/log/bezenti-install.log 2>&1 & disown`;
  const manualCmd    = `curl -fsSL '${bootstrapUrl}' | bash`;

  let sshTriggered = false;
  let sshError: string | null = null;

  if (body.sshPassword) {
    try {
      await sshRun(
        { host: node.ipPublic, port: body.port ?? 22, username: body.sshUser ?? "root", password: body.sshPassword },
        sshCmd,
      );
      sshTriggered = true;
    } catch (err) {
      sshError = err instanceof Error ? err.message : String(err);
    }
  }

  return c.json({ nodeId: id, sshTriggered, sshError, manualCmd });
});

// ── GET /admin/nodes/:id/agent-info ───────────────────────────────────────────
// Proxy al /health del agente — devuelve la versión instalada y la objetivo
// (la que sirve el control plane) para saber si hay actualización disponible.
nodesRouter.get("/:id/agent-info", async (c) => {
  const db   = createDb(c.env.DB);
  const node = await db.query.nodes.findFirst({ where: eq(nodes.id, c.req.param("id")) });
  if (!node) return c.json({ error: "not found" }, 404);

  const targetVersion = agentTargetVersion(c.env.AGENT_BINARY_URL);

  let installedVersion: string | null = null;
  let reachable = false;
  try {
    const res = await fetch(`${node.agentUrl}/health`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      reachable = true;
      installedVersion = ((await res.json()) as { version?: string }).version ?? null;
    }
  } catch {
    // agente inalcanzable — se reporta reachable=false
  }

  return c.json({
    reachable,
    installedVersion,
    targetVersion,
    updateAvailable: reachable && installedVersion !== null && installedVersion !== targetVersion,
  });
});

// ── POST /admin/nodes/:id/update-agent ────────────────────────────────────────
// Ordena al agente que se auto-actualice descargando el binario objetivo.
nodesRouter.post("/:id/update-agent", async (c) => {
  const db   = createDb(c.env.DB);
  const node = await db.query.nodes.findFirst({ where: eq(nodes.id, c.req.param("id")) });
  if (!node) return c.json({ error: "not found" }, 404);
  if (!node.agentToken) return c.json({ error: "El node no tiene token de agente — reinstálalo" }, 409);

  let res: Response;
  try {
    res = await fetch(`${node.agentUrl}/update`, {
      method:  "POST",
      headers: { "X-Agent-Token": node.agentToken, "Content-Type": "application/json" },
      body:    JSON.stringify({ base_url: c.env.AGENT_BINARY_URL }),
      signal:  AbortSignal.timeout(30000),
    });
  } catch (err) {
    return c.json({ error: `No se pudo contactar al agente: ${err instanceof Error ? err.message : err}` }, 502);
  }

  if (!res.ok) {
    return c.json({ error: `El agente rechazó la actualización (${res.status}): ${(await res.text()).slice(0, 300)}` }, 502);
  }

  return c.json({
    ok:            true,
    targetVersion: agentTargetVersion(c.env.AGENT_BINARY_URL),
    detail:        await res.json().catch(() => null),
  });
});

nodesRouter.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  await db.delete(nodes).where(eq(nodes.id, c.req.param("id")));
  return c.body(null, 204);
});
