import { Hono } from "hono";
import { createDb, projects, clients, plans } from "@bezenti/db";
import { eq, desc } from "drizzle-orm";
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
