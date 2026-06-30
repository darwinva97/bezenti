import { Hono } from "hono";
import { createDb, clientDatabases, clients, plans } from "@bezenti/db";
import { eq } from "drizzle-orm";
import type { Env } from "../env";
import { getClient, agentFetch } from "./projects";

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
  const client = await getClient(db, userId);
  if (!client) return c.json({ error: "not found" }, 404);
  if (client.status !== "active") return c.json({ error: "Tu hosting está suspendido" }, 403);
  if (!client.node) return c.json({ error: "El hosting no tiene node asignado" }, 409);

  const plan    = client.plan ?? (await db.query.plans.findFirst({ where: eq(plans.id, client.planId) }));
  const current = await db.query.clientDatabases.findMany({
    where:   eq(clientDatabases.clientId, client.id),
    columns: { id: true },
  });
  if (plan && current.length >= plan.maxDatabases) {
    return c.json({ error: `Alcanzaste el límite de ${plan.maxDatabases} bases de datos de tu plan` }, 422);
  }

  // Sufijo aleatorio (no contador) para no reusar nombres tras un borrado.
  const id       = crypto.randomUUID();
  const dbName   = `${client.linuxUser}_${id.replace(/-/g, "").slice(0, 6)}`;
  const password = crypto.randomUUID().replace(/-/g, "").slice(0, 20);

  // Crear en el nodo primero — si falla, no se registra nada (sin filas huérfanas).
  const agent = await agentFetch(client.node, "/databases", "POST", {
    db_name:  dbName,
    db_user:  dbName,
    password,
  });
  if (!agent.ok) return c.json({ error: agent.error }, 502);

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

  // La contraseña se muestra una sola vez.
  return c.json({ id, dbName, dbUser: dbName, password }, 201);
});

// Probar conexión / ejecutar SQL contra una BD del cliente (vía el agente del
// nodo, conectándose con las credenciales reales de esa BD).
databasesRouter.post("/:id/query", async (c) => {
  const userId   = c.get("user").id;
  const db       = createDb(c.env.DB);
  const database = await db.query.clientDatabases.findFirst({
    where: eq(clientDatabases.id, c.req.param("id")),
  });
  if (!database) return c.json({ error: "not found" }, 404);

  const client = await getClient(db, userId);
  if (!client || database.clientId !== client.id) return c.json({ error: "forbidden" }, 403);
  if (!client.node?.agentUrl || !client.node?.agentToken) {
    return c.json({ error: "El hosting no tiene node disponible" }, 409);
  }

  const { sql } = await c.req.json<{ sql?: string }>().catch(() => ({ sql: undefined }));

  let res: Response;
  try {
    res = await fetch(`${client.node.agentUrl}/databases/query`, {
      method:  "POST",
      headers: { "X-Agent-Token": client.node.agentToken, "Content-Type": "application/json" },
      body:    JSON.stringify({
        db_name:  database.dbName,
        db_user:  database.dbUser,
        password: database.dbPasswordHash, // credencial real de la BD
        sql:      sql ?? "",
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return c.json({ error: `No se pudo contactar al agente: ${err instanceof Error ? err.message : err}` }, 502);
  }
  if (!res.ok) return c.json({ error: `El agente respondió ${res.status}` }, 502);
  return c.json(await res.json());
});

// Cambiar la contraseña del usuario de una BD del cliente. Si no se envía
// `password`, se genera una aleatoria. La nueva credencial se guarda (la usa
// "Probar conexión") y se devuelve una sola vez para que el cliente la copie.
databasesRouter.post("/:id/password", async (c) => {
  const userId   = c.get("user").id;
  const db       = createDb(c.env.DB);
  const database = await db.query.clientDatabases.findFirst({
    where: eq(clientDatabases.id, c.req.param("id")),
  });
  if (!database) return c.json({ error: "not found" }, 404);

  const client = await getClient(db, userId);
  if (!client || database.clientId !== client.id) return c.json({ error: "forbidden" }, 403);
  if (!client.node) return c.json({ error: "El hosting no tiene node asignado" }, 409);

  const body = await c.req.json<{ password?: string }>().catch(() => ({} as { password?: string }));
  let password = body.password?.trim();
  if (password) {
    if (password.length < 8) return c.json({ error: "La contraseña debe tener al menos 8 caracteres" }, 422);
  } else {
    password = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  }

  const agent = await agentFetch(client.node, "/databases/password", "POST", {
    db_user:  database.dbUser,
    password,
  });
  if (!agent.ok) return c.json({ error: agent.error }, 502);

  await db.update(clientDatabases)
    .set({ dbPasswordHash: password })
    .where(eq(clientDatabases.id, database.id));

  return c.json({ ok: true, password });
});

// Login 1-clic al gestor web (Adminer): el agente prepara Adminer y devuelve
// una URL con un token de un solo uso que inyecta las credenciales de la BD.
databasesRouter.post("/:id/adminer-login", async (c) => {
  const userId   = c.get("user").id;
  const db       = createDb(c.env.DB);
  const database = await db.query.clientDatabases.findFirst({
    where: eq(clientDatabases.id, c.req.param("id")),
  });
  if (!database) return c.json({ error: "not found" }, 404);

  const client = await getClient(db, userId);
  if (!client || database.clientId !== client.id) return c.json({ error: "forbidden" }, 403);
  if (!client.node?.agentUrl || !client.node?.agentToken) {
    return c.json({ error: "El hosting no tiene node disponible" }, 409);
  }

  let res: Response;
  try {
    res = await fetch(`${client.node.agentUrl}/databases/adminer-login`, {
      method:  "POST",
      headers: { "X-Agent-Token": client.node.agentToken, "Content-Type": "application/json" },
      body:    JSON.stringify({
        engine:   database.engine,
        server:   "127.0.0.1",
        db_name:  database.dbName,
        db_user:  database.dbUser,
        password: database.dbPasswordHash, // credencial real de la BD
      }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    return c.json({ error: `No se pudo contactar al agente: ${err instanceof Error ? err.message : err}` }, 502);
  }
  if (!res.ok) return c.json({ error: `El agente respondió ${res.status}` }, 502);
  return c.json(await res.json());
});

databasesRouter.delete("/:id", async (c) => {
  const userId   = c.get("user").id;
  const db       = createDb(c.env.DB);
  const database = await db.query.clientDatabases.findFirst({
    where: eq(clientDatabases.id, c.req.param("id")),
  });
  if (!database) return c.json({ error: "not found" }, 404);

  const client = await getClient(db, userId);
  if (!client || database.clientId !== client.id) return c.json({ error: "forbidden" }, 403);

  // Borrar en el nodo (best-effort): si el agente no responde, igual quitamos
  // el registro para que el cliente no quede atascado.
  if (client.node) {
    await agentFetch(
      client.node,
      `/databases/${encodeURIComponent(database.dbName)}?user=${encodeURIComponent(database.dbUser)}`,
      "DELETE",
    );
  }

  await db.delete(clientDatabases).where(eq(clientDatabases.id, database.id));
  return c.body(null, 204);
});
