import { Hono } from "hono";
import { createDb, clients, nodes, plans, user } from "@bezenti/db";
import { eq, desc } from "drizzle-orm";
import type { Env } from "../env";
import { bytesToHex, sha256 } from "./provision";

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
    userId?: string; userEmail?: string; nodeId: string; planId: string;
  }>();

  const db = createDb(c.env.DB);

  // Resolver el usuario (por id o por email)
  let userId = body.userId;
  if (!userId && body.userEmail) {
    const u = await db.query.user.findFirst({ where: eq(user.email, body.userEmail) });
    if (!u) return c.json({ error: `No existe un usuario con email ${body.userEmail}` }, 404);
    userId = u.id;
  }
  if (!userId) return c.json({ error: "userId o userEmail es requerido" }, 400);

  const existing = await db.query.clients.findFirst({ where: eq(clients.userId, userId) });
  if (existing) return c.json({ error: "Ese usuario ya tiene un cliente asignado" }, 409);

  const node = await db.query.nodes.findFirst({ where: eq(nodes.id, body.nodeId) });
  if (!node) return c.json({ error: "Node no encontrado" }, 404);
  if (node.status !== "ready") return c.json({ error: `El node está en estado "${node.status}", no "ready"` }, 409);
  if (!node.agentToken) return c.json({ error: "El node no tiene token de agente — reinstálalo desde Nodes" }, 409);

  const plan = await db.query.plans.findFirst({ where: eq(plans.id, body.planId) });
  if (!plan) return c.json({ error: "Plan no encontrado" }, 404);

  const clientId     = crypto.randomUUID();
  const linuxUser    = "cli_" + clientId.replace(/-/g, "").slice(0, 8);
  const sftpPassword = bytesToHex(crypto.getRandomValues(new Uint8Array(12)));
  const phpVersion   = (JSON.parse(plan.phpVersions) as string[])[0] ?? "8.3";

  // El agente crea el usuario Linux, la app PHP en Unit y la base MariaDB
  let agentRes: Response;
  try {
    agentRes = await fetch(`${node.agentUrl}/clients`, {
      method:  "POST",
      headers: { "X-Agent-Token": node.agentToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        id:            clientId,
        linux_user:    linuxUser,
        sftp_password: sftpPassword,
        limits: {
          disk_mb:         plan.diskMb,
          max_processes:   plan.phpMaxProcesses,
          memory_limit_mb: plan.phpMemoryLimitMb,
          php_version:     phpVersion,
        },
      }),
    });
  } catch (err) {
    return c.json({ error: `No se pudo contactar al agente del node: ${err instanceof Error ? err.message : err}` }, 502);
  }

  if (!agentRes.ok) {
    const detail = (await agentRes.text()).slice(0, 500);
    return c.json({ error: `El agente falló al crear el cliente (${agentRes.status}): ${detail}` }, 502);
  }

  const provisioned = await agentRes.json() as {
    db_name: string; db_user: string; db_password: string;
    sftp_port: number; sftp_user: string;
  };

  await db.insert(clients).values({
    id:               clientId,
    userId,
    nodeId:           body.nodeId,
    planId:           body.planId,
    linuxUser,
    sftpPasswordHash: await sha256(sftpPassword),
    createdAt:        new Date(),
  });

  // Las credenciales solo se devuelven UNA VEZ — no se almacenan en claro
  return c.json({
    id:        clientId,
    linuxUser,
    sftp: {
      host:     node.ipPublic,
      port:     provisioned.sftp_port,
      user:     provisioned.sftp_user,
      password: sftpPassword,
    },
    database: {
      name:     provisioned.db_name,
      user:     provisioned.db_user,
      password: provisioned.db_password,
      host:     "localhost",
    },
  }, 201);
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
  const db     = createDb(c.env.DB);
  const client = await db.query.clients.findFirst({
    where: eq(clients.id, c.req.param("id")),
    with:  { node: true },
  });
  if (!client) return c.json({ error: "not found" }, 404);

  // Limpiar en el VPS (best-effort): usuario Linux, app Unit y base de datos
  if (client.node?.agentToken) {
    try {
      await fetch(`${client.node.agentUrl}/clients/${client.linuxUser}`, {
        method:  "DELETE",
        headers: { "X-Agent-Token": client.node.agentToken },
      });
    } catch (err) {
      console.error("agent cleanup failed:", err);
    }
  }

  // Hard-delete: el userId tiene constraint UNIQUE, así que un soft-delete
  // bloquearía recrear un cliente para el mismo usuario. Los recursos del VPS
  // ya se limpiaron arriba; las tablas hijas tienen onDelete cascade.
  await db.delete(clients).where(eq(clients.id, c.req.param("id")));
  return c.body(null, 204);
});
