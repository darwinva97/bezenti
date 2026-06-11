import { Hono } from "hono";
import { createDb, clients } from "@bezenti/db";
import { eq, desc } from "drizzle-orm";
import type { Env } from "../env";

export const clientsRouter = new Hono<{ Bindings: Env }>();

clientsRouter.get("/", async (c) => {
  const db   = createDb(c.env.DB);
  const rows = await db.query.clients.findMany({
    orderBy: desc(clients.createdAt),
    with: { plan: true, node: true },
  });
  return c.json(rows);
});

clientsRouter.get("/:id", async (c) => {
  const db     = createDb(c.env.DB);
  const client = await db.query.clients.findFirst({
    where: eq(clients.id, c.req.param("id")),
    with:  { plan: true, node: true, projects: true, databases: true },
  });
  if (!client) return c.json({ error: "not found" }, 404);
  return c.json(client);
});

clientsRouter.post("/", async (c) => {
  const body = await c.req.json<{
    userId: string; nodeId: string; planId: string;
  }>();

  const db        = createDb(c.env.DB);
  const clientId  = crypto.randomUUID();
  const linuxUser = "cli_" + clientId.replace(/-/g, "").slice(0, 8);

  await db.insert(clients).values({
    id:               clientId,
    userId:           body.userId,
    nodeId:           body.nodeId,
    planId:           body.planId,
    linuxUser,
    sftpPasswordHash: crypto.randomUUID(),
    createdAt:        new Date(),
  });

  // TODO: Queue → node agent crea usuario Linux, quota, estructura de directorios
  return c.json({ id: clientId, linuxUser }, 201);
});

clientsRouter.patch("/:id/status", async (c) => {
  const { status, reason } = await c.req.json<{
    status: "active" | "suspended"; reason?: string;
  }>();
  const db = createDb(c.env.DB);
  await db.update(clients).set({
    status,
    suspensionReason: reason,
    suspendedAt: status === "suspended" ? new Date() : null,
  }).where(eq(clients.id, c.req.param("id")));
  return c.json({ ok: true });
});

clientsRouter.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  await db.update(clients)
    .set({ status: "deleted", deletedAt: new Date() })
    .where(eq(clients.id, c.req.param("id")));
  return c.body(null, 204);
});
