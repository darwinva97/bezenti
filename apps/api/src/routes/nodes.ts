import { Hono } from "hono";
import { createDb, nodes, nodeMetrics } from "@bezenti/db";
import { eq, desc } from "drizzle-orm";
import type { Env } from "../env";
import { sshRun } from "../lib/ssh";
import { bytesToHex, sha256 } from "./provision";

export const nodesRouter = new Hono<{ Bindings: Env }>();

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
    .set({ agentTokenHash: tokenHash, status: "provisioning", lastHeartbeatAt: null })
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

nodesRouter.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  await db.delete(nodes).where(eq(nodes.id, c.req.param("id")));
  return c.body(null, 204);
});
