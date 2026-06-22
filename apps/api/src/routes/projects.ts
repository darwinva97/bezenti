import { Hono } from "hono";
import { createDb, projects, clients, plans, clientDatabases } from "@bezenti/db";
import { and, eq, desc, ne } from "drizzle-orm";
import type { Env } from "../env";
import { slugify, isValidSlug, fitsDnsLabel, computeProjectHost } from "../lib/slug";
import { generateAccountSlug } from "./clients";

export const projectsRouter = new Hono<{ Bindings: Env }>();

export async function getClient(db: ReturnType<typeof createDb>, userId: string) {
  return db.query.clients.findFirst({
    where: eq(clients.userId, userId),
    with:  { node: true, plan: true },
  });
}

// Backfill lazy del accountSlug para clientes creados antes de esta feature
export async function ensureAccountSlug(
  db: ReturnType<typeof createDb>,
  client: { id: string; accountSlug: string | null },
  fallbackSource: string,
): Promise<string> {
  if (client.accountSlug) return client.accountSlug;
  const slug = await generateAccountSlug(db, fallbackSource);
  await db.update(clients).set({ accountSlug: slug }).where(eq(clients.id, client.id));
  return slug;
}

export async function agentFetch(
  node: { agentUrl: string | null; agentToken: string | null },
  path: string,
  method: string,
  body?: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!node.agentUrl || !node.agentToken) {
    return { ok: false, error: "El node no tiene agente configurado" };
  }
  let res: Response;
  try {
    res = await fetch(`${node.agentUrl}${path}`, {
      method,
      headers: { "X-Agent-Token": node.agentToken, "Content-Type": "application/json" },
      body:    body !== undefined ? JSON.stringify(body) : undefined,
      signal:  AbortSignal.timeout(30000),
    });
  } catch (err) {
    return { ok: false, error: `No se pudo contactar al agente del node: ${err instanceof Error ? err.message : err}` };
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    return { ok: false, error: `El agente respondió ${res.status}: ${detail}` };
  }
  return { ok: true };
}

projectsRouter.get("/", async (c) => {
  const userId = c.get("user").id;
  const db     = createDb(c.env.DB);
  const client = await getClient(db, userId);
  if (!client) return c.json({ error: "no hosting found" }, 404);

  const rows = await db.query.projects.findMany({
    where:   eq(projects.clientId, client.id),
    orderBy: desc(projects.createdAt),
  });
  return c.json(rows);
});

projectsRouter.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ name: string; subdomain?: string }>();
  if (!body.name?.trim()) return c.json({ error: "El nombre es requerido" }, 400);

  const db     = createDb(c.env.DB);
  const client = await getClient(db, user.id);
  if (!client) return c.json({ error: "no hosting found" }, 404);
  if (client.status !== "active") return c.json({ error: "Tu hosting está suspendido" }, 403);
  if (!client.node) return c.json({ error: "El hosting no tiene node asignado" }, 409);

  const accountSlug = await ensureAccountSlug(db, client, user.name || (user.email.split("@")[0] ?? user.email));

  const subdomain = (body.subdomain?.trim() || slugify(body.name)).toLowerCase();
  if (!isValidSlug(subdomain)) {
    return c.json({ error: "Subdominio inválido: solo letras minúsculas, números y guiones (sin '--')" }, 400);
  }
  if (!fitsDnsLabel(subdomain, accountSlug)) {
    return c.json({ error: "El subdominio es demasiado largo para tu cuenta" }, 400);
  }

  const host = computeProjectHost(subdomain, accountSlug, c.env.PAGES_DOMAIN);
  const taken = await db.query.projects.findFirst({ where: eq(projects.domain, host) });
  if (taken) return c.json({ error: `El subdominio "${subdomain}" ya está en uso` }, 409);

  const plan       = client.plan ?? (await db.query.plans.findFirst({ where: eq(plans.id, client.planId) }));

  // Aplicar el límite de webs del plan (cuenta los proyectos no eliminados).
  if (plan) {
    const current = await db.query.projects.findMany({
      where:   and(eq(projects.clientId, client.id), ne(projects.status, "deleted")),
      columns: { id: true },
    });
    if (current.length >= plan.maxDomains) {
      return c.json({ error: `Alcanzaste el límite de ${plan.maxDomains} webs de tu plan` }, 422);
    }
  }

  const phpVersion = plan ? ((JSON.parse(plan.phpVersions) as string[])[0] ?? "8.3") : "8.3";
  const id         = crypto.randomUUID();
  const docPath    = subdomain;

  // El agente crea el docroot y la app de Unit + listener — si falla, no se inserta nada
  const agent = await agentFetch(client.node, "/projects", "POST", {
    id,
    linux_user:      client.linuxUser,
    doc_path:        docPath,
    php_version:     phpVersion,
    memory_limit_mb: plan?.phpMemoryLimitMb ?? 128,
    max_processes:   plan?.phpMaxProcesses ?? 2,
    hosts:           [host],
  });
  if (!agent.ok) return c.json({ error: agent.error }, 502);

  await db.insert(projects).values({
    id,
    clientId:   client.id,
    name:       body.name.trim(),
    domain:     host,
    subdomain,
    phpVersion,
    docPath,
    sslStatus:  "pending",
    createdAt:  new Date(),
  });

  return c.json({ id, subdomain, host, docPath }, 201);
});

// ── Instalador 1-clic (tipo Softaculous) ──────────────────────────────────────
// Catálogo de apps instalables. Extensible: añade entradas y soporte en el
// agente (services/installer.go).
const INSTALLABLE_APPS = ["wordpress"] as const;
type InstallableApp = (typeof INSTALLABLE_APPS)[number];

projectsRouter.get("/apps/catalog", (c) =>
  c.json([
    {
      id:          "wordpress",
      name:        "WordPress",
      description: "El CMS más usado del mundo. Blog, web o tienda con WooCommerce.",
      needsAdmin:  true,
    },
  ]),
);

function genPassword(len = 20): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return Array.from(bytes, (b) => alpha[b % alpha.length]).join("");
}

projectsRouter.post("/:id/install", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    app:           string;
    title?:        string;
    adminUser?:    string;
    adminEmail?:   string;
    adminPassword?: string;
    locale?:       string;
  }>();

  if (!INSTALLABLE_APPS.includes(body.app as InstallableApp)) {
    return c.json({ error: `App no soportada: ${body.app}` }, 400);
  }

  const db     = createDb(c.env.DB);
  const client = await getClient(db, user.id);
  if (!client) return c.json({ error: "no hosting found" }, 404);
  if (client.status !== "active") return c.json({ error: "Tu hosting está suspendido" }, 403);
  if (!client.node) return c.json({ error: "El hosting no tiene node asignado" }, 409);

  const project = await db.query.projects.findFirst({ where: eq(projects.id, c.req.param("id")) });
  if (!project || project.clientId !== client.id) return c.json({ error: "not found" }, 404);
  if (project.appType) {
    return c.json({ error: `Este proyecto ya tiene ${project.appType} instalado` }, 409);
  }

  // Instalar WordPress crea una BD dedicada → cuenta contra el límite del plan.
  const plan = client.plan ?? (await db.query.plans.findFirst({ where: eq(plans.id, client.planId) }));
  if (plan) {
    const dbs = await db.query.clientDatabases.findMany({
      where:   eq(clientDatabases.clientId, client.id),
      columns: { id: true },
    });
    if (dbs.length >= plan.maxDatabases) {
      return c.json({ error: `Instalar ${body.app} necesita una base de datos y alcanzaste el límite de ${plan.maxDatabases} de tu plan` }, 422);
    }
  }

  const adminUser     = body.adminUser?.trim() || "admin";
  const adminEmail    = body.adminEmail?.trim() || user.email;
  const title         = body.title?.trim() || project.name;
  const adminPassword = body.adminPassword?.trim() || genPassword();

  const dbId       = crypto.randomUUID();
  const dbName     = `${client.linuxUser}_${dbId.replace(/-/g, "").slice(0, 6)}`;
  const dbPassword = genPassword(24);
  // Los subdominios *.pages.bezenti.com tienen TLS automático (autocert en el
  // agente termina https en :443); para dominios propios depende de sslStatus.
  const hasTls     = project.domain.endsWith(`.${c.env.PAGES_DOMAIN}`) || project.sslStatus === "active";
  const scheme     = hasTls ? "https" : "http";
  const siteUrl    = `${scheme}://${project.domain}`;

  // Llamada dedicada con timeout largo: instalar WordPress puede tardar.
  let res: Response;
  try {
    res = await fetch(`${client.node.agentUrl}/projects/${project.id}/install`, {
      method:  "POST",
      headers: { "X-Agent-Token": client.node.agentToken!, "Content-Type": "application/json" },
      body: JSON.stringify({
        app:            body.app,
        linux_user:     client.linuxUser,
        doc_path:       project.docPath,
        site_url:       siteUrl,
        title,
        admin_user:     adminUser,
        admin_password: adminPassword,
        admin_email:    adminEmail,
        locale:         body.locale ?? "es_ES",
        db_name:        dbName,
        db_user:        dbName,
        db_password:    dbPassword,
      }),
      signal: AbortSignal.timeout(120000),
    });
  } catch (err) {
    return c.json({ error: `No se pudo contactar al agente: ${err instanceof Error ? err.message : err}` }, 502);
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    return c.json({ error: `Falló la instalación: ${detail}` }, 502);
  }

  // Persistir la BD creada y marcar la app del proyecto.
  await db.insert(clientDatabases).values({
    id:             dbId,
    clientId:       client.id,
    projectId:      project.id,
    engine:         "mysql",
    dbName,
    dbUser:         dbName,
    dbPasswordHash: dbPassword,
    createdAt:      new Date(),
  });
  await db.update(projects).set({ appType: body.app }).where(eq(projects.id, project.id));

  return c.json({
    ok:       true,
    app:      body.app,
    siteUrl,
    adminUrl: `${siteUrl}/wp-admin`,
    adminUser,
    adminPassword,
    dbName,
  }, 201);
});

// Login 1-clic al admin de WordPress: el agente genera un token de un solo uso
// (90 s) y devolvemos la URL mágica. Solo el dueño del proyecto puede pedirlo.
projectsRouter.post("/:id/wp-login", async (c) => {
  const user   = c.get("user");
  const db     = createDb(c.env.DB);
  const client = await getClient(db, user.id);
  if (!client) return c.json({ error: "no hosting found" }, 404);
  if (client.status !== "active") return c.json({ error: "Tu hosting está suspendido" }, 403);
  if (!client.node?.agentUrl || !client.node?.agentToken) {
    return c.json({ error: "El hosting no tiene node disponible" }, 409);
  }

  const project = await db.query.projects.findFirst({ where: eq(projects.id, c.req.param("id")) });
  if (!project || project.clientId !== client.id) return c.json({ error: "not found" }, 404);
  if (project.appType !== "wordpress") {
    return c.json({ error: "Este proyecto no tiene WordPress instalado" }, 409);
  }

  let res: Response;
  try {
    res = await fetch(`${client.node.agentUrl}/projects/${project.id}/sso`, {
      method:  "POST",
      headers: { "X-Agent-Token": client.node.agentToken, "Content-Type": "application/json" },
      signal:  AbortSignal.timeout(30000),
    });
  } catch (err) {
    return c.json({ error: `No se pudo contactar al agente: ${err instanceof Error ? err.message : err}` }, 502);
  }
  if (!res.ok) {
    return c.json({ error: `No se pudo generar el acceso: ${(await res.text()).slice(0, 300)}` }, 502);
  }

  const { token } = await res.json<{ token: string }>();
  const scheme = project.domain.endsWith(`.${c.env.PAGES_DOMAIN}`) || project.sslStatus === "active" ? "https" : "http";
  return c.json({ url: `${scheme}://${project.domain}/?bezenti_sso=${encodeURIComponent(token)}` });
});

// Renombrar el subdominio: recablea listeners en el agente, la app y los
// archivos no se mueven (docPath queda como estaba).
projectsRouter.patch("/:id/subdomain", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ subdomain: string }>();

  const db     = createDb(c.env.DB);
  const client = await getClient(db, user.id);
  if (!client) return c.json({ error: "no hosting found" }, 404);
  if (!client.node) return c.json({ error: "El hosting no tiene node asignado" }, 409);

  const project = await db.query.projects.findFirst({ where: eq(projects.id, c.req.param("id")) });
  if (!project || project.clientId !== client.id) return c.json({ error: "not found" }, 404);

  const accountSlug = await ensureAccountSlug(db, client, user.name || (user.email.split("@")[0] ?? user.email));
  const subdomain   = body.subdomain?.trim().toLowerCase() ?? "";
  if (!isValidSlug(subdomain)) {
    return c.json({ error: "Subdominio inválido: solo letras minúsculas, números y guiones (sin '--')" }, 400);
  }
  if (!fitsDnsLabel(subdomain, accountSlug)) {
    return c.json({ error: "El subdominio es demasiado largo para tu cuenta" }, 400);
  }
  if (subdomain === project.subdomain) return c.json({ ok: true, host: project.domain });

  const newHost = computeProjectHost(subdomain, accountSlug, c.env.PAGES_DOMAIN);
  const taken   = await db.query.projects.findFirst({ where: eq(projects.domain, newHost) });
  if (taken) return c.json({ error: `El subdominio "${subdomain}" ya está en uso` }, 409);

  const agent = await agentFetch(client.node, `/projects/${project.id}/hosts`, "POST", {
    add:    [newHost],
    remove: [project.domain],
  });
  if (!agent.ok) return c.json({ error: agent.error }, 502);

  await db.update(projects)
    .set({ subdomain, domain: newHost })
    .where(eq(projects.id, project.id));

  return c.json({ ok: true, subdomain, host: newHost });
});

projectsRouter.delete("/:id", async (c) => {
  const user   = c.get("user");
  const db     = createDb(c.env.DB);
  const client = await getClient(db, user.id);
  if (!client) return c.json({ error: "no hosting found" }, 404);

  const project = await db.query.projects.findFirst({ where: eq(projects.id, c.req.param("id")) });
  if (!project || project.clientId !== client.id) return c.json({ error: "not found" }, 404);

  // Best-effort: quita la app y los listeners del node (conserva archivos)
  if (client.node) {
    const agent = await agentFetch(client.node, `/projects/${project.id}`, "DELETE", {
      hosts: [project.domain],
    });
    if (!agent.ok) console.error("agent project cleanup failed:", agent.error);
  }

  // Hard-delete: domain es UNIQUE — un soft-delete bloquearía reusar el subdominio
  await db.delete(projects).where(eq(projects.id, project.id));
  return c.body(null, 204);
});
