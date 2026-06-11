import { Hono } from "hono";
import { createDb, nodes, nodeMetrics } from "@bezenti/db";
import { eq, desc } from "drizzle-orm";
import type { Env } from "../env";

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

nodesRouter.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  await db.delete(nodes).where(eq(nodes.id, c.req.param("id")));
  return c.body(null, 204);
});
