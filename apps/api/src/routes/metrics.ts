import { Hono } from "hono";
import {
  createDb, clientMetrics, nodeMetrics, clients,
  projects, clientDatabases, emailAccounts,
} from "@bezenti/db";
import { and, eq, desc, ne } from "drizzle-orm";
import type { Env } from "../env";

export const metricsRouter = new Hono<{ Bindings: Env }>();

// ── GET /portal/metrics/usage ─────────────────────────────────────────────────
// Resumen de consumo vs cuota del plan: lo que el panel del cliente muestra
// como barras (disco, webs, bases de datos, correos, procesos). Cruza el último
// registro de clientMetrics con los límites del plan y los conteos reales.
metricsRouter.get("/usage", async (c) => {
  const userId = c.get("user").id;
  const db     = createDb(c.env.DB);

  const client = await db.query.clients.findFirst({
    where: eq(clients.userId, userId),
    with:  { plan: true },
  });
  if (!client) return c.json({ error: "no hosting found" }, 404);
  const plan = client.plan;

  const [latest, projectRows, dbRows, emailRows] = await Promise.all([
    db.query.clientMetrics.findFirst({
      where:   eq(clientMetrics.clientId, client.id),
      orderBy: desc(clientMetrics.recordedAt),
    }),
    db.query.projects.findMany({
      where: and(eq(projects.clientId, client.id), ne(projects.status, "deleted")),
    }),
    db.query.clientDatabases.findMany({ where: eq(clientDatabases.clientId, client.id) }),
    db.query.emailAccounts.findMany({
      where: and(eq(emailAccounts.clientId, client.id), ne(emailAccounts.status, "deleted")),
    }),
  ]);

  const filesMb = latest?.diskUsedMb ?? 0;
  const mysqlMb = latest?.mysqlUsedMb ?? 0;
  const pgMb    = latest?.pgUsedMb ?? 0;
  const emailMb = emailRows.reduce((sum, r) => sum + (r.usedMb ?? 0), 0);

  return c.json({
    recordedAt: latest?.recordedAt ?? null,
    plan: plan ? { id: plan.id, name: plan.name, diskMb: plan.diskMb } : null,
    // El disco total del plan cubre archivos + BD + correo del cliente.
    disk: {
      usedMb:    filesMb + mysqlMb + pgMb + emailMb,
      totalMb:   plan?.diskMb ?? null,
      breakdown: { filesMb, mysqlMb, pgMb, emailMb },
    },
    web:       { used: projectRows.length, max: plan?.maxDomains ?? null },
    databases: { used: dbRows.length,      max: plan?.maxDatabases ?? null },
    email:     { used: emailRows.length,   max: plan?.maxEmailAccounts ?? null, usedMb: emailMb },
    processes: { used: latest?.processCount ?? 0, max: plan?.phpMaxProcesses ?? null },
  });
});

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
