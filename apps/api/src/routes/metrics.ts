import { Hono } from "hono";
import { createDb, clientMetrics, nodeMetrics, clients } from "@bezenti/db";
import { eq, desc } from "drizzle-orm";
import type { Env } from "../env";

export const metricsRouter = new Hono<{ Bindings: Env }>();

metricsRouter.get("/me", async (c) => {
  const userId = c.get("user").id;
  const db     = createDb(c.env.DB);
  const client = await db.query.clients.findFirst({ where: eq(clients.userId, userId) });
  if (!client) return c.json({ error: "not found" }, 404);

  const latest = await db.query.clientMetrics.findFirst({
    where:   eq(clientMetrics.clientId, client.id),
    orderBy: desc(clientMetrics.recordedAt),
  });
  return c.json(latest ?? {
    diskUsedMb: 0, mysqlUsedMb: 0, pgUsedMb: 0,
    emailUsedMb: 0, processCount: 0, requestsToday: 0,
  });
});

metricsRouter.get("/nodes/:nodeId", async (c) => {
  const db   = createDb(c.env.DB);
  const rows = await db.query.nodeMetrics.findMany({
    where:   eq(nodeMetrics.nodeId, c.req.param("nodeId")),
    orderBy: desc(nodeMetrics.recordedAt),
    limit:   60,
  });
  return c.json(rows);
});
