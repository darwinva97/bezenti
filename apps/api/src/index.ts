import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createAuth } from "@bezenti/auth/server";
import { createDb } from "@bezenti/db";

import type { Env } from "./env";
import { authRouter }      from "./routes/auth";
import { nodesRouter }     from "./routes/nodes";
import { clientsRouter }   from "./routes/clients";
import { plansRouter }     from "./routes/plans";
import { projectsRouter }  from "./routes/projects";
import { accountRouter }   from "./routes/account";
import { filesRouter }     from "./routes/files";
import { databasesRouter } from "./routes/databases";
import { emailRouter }     from "./routes/email";
import { dnsRouter }       from "./routes/dns";
import { metricsRouter }   from "./routes/metrics";
import { agentRouter }           from "./routes/agent";
import { provisionRouter, bootstrapScriptHandler } from "./routes/provision";

const app = new Hono<{ Bindings: Env }>();

app.use("*", logger());
app.use("*", async (c, next) => {
  return cors({
    origin:      (c.env.TRUSTED_ORIGINS ?? "http://localhost:3001").split(","),
    credentials: true,
  })(c, next);
});

app.get("/", (c) => c.json({ service: "bezenti-api", status: "ok" }));

// Público — el VPS descarga el script de instalación del agente
app.get("/bootstrap/:nodeId", (c) => bootstrapScriptHandler(c as never));

// better-auth maneja /api/auth/* completo (sign-in, sign-up, session, admin.*)
app.route("/api/auth", authRouter);

// Rutas del agente (token propio por node)
app.route("/agent", agentRouter);

// Middleware de sesión better-auth para rutas protegidas
app.use("/admin/*", async (c, next) => {
  const db      = createDb(c.env.DB);
  const auth    = createAuth(db, { baseUrl: c.env.BETTER_AUTH_URL });
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  if (session.user.role !== "admin") return c.json({ error: "forbidden" }, 403);
  c.set("user", session.user);
  c.set("session", session.session);
  await next();
});

app.use("/portal/*", async (c, next) => {
  const db      = createDb(c.env.DB);
  const auth    = createAuth(db, { baseUrl: c.env.BETTER_AUTH_URL });
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  c.set("user", session.user);
  c.set("session", session.session);
  await next();
});

// Lista de usuarios para el selector de "Nuevo cliente" del admin
app.get("/admin/users", async (c) => {
  const db   = createDb(c.env.DB);
  const rows = await db.query.user.findMany({
    columns: { id: true, email: true, name: true, role: true },
  });
  return c.json(rows);
});

// Provision va antes del nodes router para que /provision no sea capturado como /:id
app.route("/admin/nodes/provision", provisionRouter);
app.route("/admin/nodes",    nodesRouter);
app.route("/admin/clients",  clientsRouter);
app.route("/admin/plans",    plansRouter);
app.route("/portal/projects",  projectsRouter);
app.route("/portal/account",   accountRouter);
app.route("/portal/files",     filesRouter);
app.route("/portal/databases", databasesRouter);
app.route("/portal/email",     emailRouter);
app.route("/portal/dns",       dnsRouter);
app.route("/portal/metrics",   metricsRouter);

app.notFound((c) => c.json({ error: "not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});

export default app;
