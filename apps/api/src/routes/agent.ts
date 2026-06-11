import { Hono } from "hono";
import { createDb, nodes, nodeMetrics, clientMetrics, clients } from "@bezenti/db";
import { eq } from "drizzle-orm";
import type { Env } from "../env";

// Rutas llamadas por el node agent (no por el panel)
// Autenticadas con el token propio del node (X-Agent-Token)
export const agentRouter = new Hono<{ Bindings: Env }>();

// El node se registra al arrancar tras correr el bootstrap script
agentRouter.post("/register", async (c) => {
  const body = await c.req.json<{
    name: string; provider: string; region?: string;
    ipPublic: string; agentToken: string;
    diskGbTotal?: number; ramMbTotal?: number;
  }>();

  const db            = createDb(c.env.DB);
  const tokenHash     = await sha256(body.agentToken);
  const id            = crypto.randomUUID();
  const agentUrl      = `https://${id}.agent.bezenti.internal`;

  await db.insert(nodes).values({
    id,
    name:             body.name,
    provider:         body.provider,
    region:           body.region,
    ipPublic:         body.ipPublic,
    agentUrl,
    agentTokenHash:   tokenHash,
    diskGbTotal:      body.diskGbTotal,
    ramMbTotal:       body.ramMbTotal,
    status:           "ready",
    createdAt:        new Date(),
    lastHeartbeatAt:  new Date(),
  });

  return c.json({ id, agentUrl }, 201);
});

// Heartbeat periódico — el agent reporta estado del node y métricas por cliente
agentRouter.post("/heartbeat", async (c) => {
  const tokenHash = await sha256(c.req.header("X-Agent-Token") ?? "");
  const body      = await c.req.json<{
    nodeId:       string;
    agentUrl?:    string;
    cpuPct:       number;
    ramUsedMb:    number;
    diskUsedGb:   number;
    clientsCount: number;
    clients: Array<{
      id:            string;
      diskUsedMb:    number;
      processCount:  number;
      requestsToday: number;
    }>;
  }>();

  const db   = createDb(c.env.DB);
  const node = await db.query.nodes.findFirst({ where: eq(nodes.id, body.nodeId) });

  if (!node || node.agentTokenHash !== tokenHash) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const now = new Date();

  // Actualizar último heartbeat del node. El agente reporta su URL pública
  // de tunnel (cloudflared); la persistimos para que el control plane pueda
  // alcanzarlo aunque la URL del quick tunnel cambie tras un reinicio.
  await db.update(nodes).set({
    lastHeartbeatAt: now,
    status:          "ready",
    ...(body.agentUrl && body.agentUrl !== node.agentUrl ? { agentUrl: body.agentUrl } : {}),
  }).where(eq(nodes.id, body.nodeId));

  // Guardar métricas del node
  await db.insert(nodeMetrics).values({
    nodeId:       body.nodeId,
    recordedAt:   now,
    cpuPct:       body.cpuPct,
    ramUsedMb:    body.ramUsedMb,
    diskUsedGb:   body.diskUsedGb,
    clientsCount: body.clientsCount,
  });

  // Guardar métricas por cliente
  if (body.clients?.length) {
    await db.insert(clientMetrics).values(
      body.clients.map((cl) => ({
        clientId:      cl.id,
        recordedAt:    now,
        diskUsedMb:    cl.diskUsedMb,
        processCount:  cl.processCount,
        requestsToday: cl.requestsToday,
      })),
    );
  }

  return c.json({ ok: true });
});

async function sha256(input: string): Promise<string> {
  const buf    = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
