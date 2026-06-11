import { Hono } from "hono";
import { createDb, clientDatabases, clients, plans } from "@bezenti/db";
import { eq } from "drizzle-orm";
import type { Env } from "../env";

export const databasesRouter = new Hono<{ Bindings: Env }>();

databasesRouter.get("/", async (c) => {
  const userId = c.get("user").id;
  const db     = createDb(c.env.DB);
  const client = await db.query.clients.findFirst({ where: eq(clients.userId, userId) });
  if (!client) return c.json({ error: "not found" }, 404);

  const rows = await db.query.clientDatabases.findMany({
    where: eq(clientDatabases.clientId, client.id),
  });
  return c.json(rows.map((r) => ({ ...r, dbPasswordHash: undefined })));
});

databasesRouter.post("/", async (c) => {
  const userId = c.get("user").id;
  const { engine, projectId } = await c.req.json<{
    engine?: "mysql" | "postgresql"; projectId?: string;
  }>();

  const db     = createDb(c.env.DB);
  const client = await db.query.clients.findFirst({ where: eq(clients.userId, userId) });
  if (!client) return c.json({ error: "not found" }, 404);

  const plan    = await db.query.plans.findFirst({ where: eq(plans.id, client.planId) });
  const current = await db.query.clientDatabases.findMany({
    where: eq(clientDatabases.clientId, client.id),
  });
  if (plan && current.length >= plan.maxDatabases) {
    return c.json({ error: "database limit reached for your plan" }, 422);
  }

  const id       = crypto.randomUUID();
  const dbName   = `${client.linuxUser}_${current.length + 1}`;
  const password = crypto.randomUUID().replace(/-/g, "").slice(0, 16);

  await db.insert(clientDatabases).values({
    id,
    clientId:       client.id,
    projectId:      projectId ?? null,
    engine:         engine ?? "mysql",
    dbName,
    dbUser:         dbName,
    dbPasswordHash: password,
    createdAt:      new Date(),
  });

  // TODO: Queue → node agent crea BD en MariaDB o PostgreSQL
  return c.json({ id, dbName, dbUser: dbName, password }, 201);
});

databasesRouter.delete("/:id", async (c) => {
  const userId   = c.get("user").id;
  const db       = createDb(c.env.DB);
  const database = await db.query.clientDatabases.findFirst({
    where: eq(clientDatabases.id, c.req.param("id")),
  });
  if (!database) return c.json({ error: "not found" }, 404);

  const client = await db.query.clients.findFirst({ where: eq(clients.userId, userId) });
  if (!client || database.clientId !== client.id) return c.json({ error: "forbidden" }, 403);

  await db.delete(clientDatabases).where(eq(clientDatabases.id, database.id));
  // TODO: Queue → node agent elimina BD del motor correspondiente
  return c.body(null, 204);
});
