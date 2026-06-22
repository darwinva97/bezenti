import { Hono } from "hono";
import { createDb, projects, clients, emailAccounts } from "@bezenti/db";
import { eq } from "drizzle-orm";
import type { Env } from "../env";
import { isValidSlug, fitsDnsLabel, computeProjectHost } from "../lib/slug";
import { getClient, ensureAccountSlug, agentFetch } from "./projects";

export const accountRouter = new Hono<{ Bindings: Env }>();

accountRouter.get("/", async (c) => {
  const user   = c.get("user");
  const db     = createDb(c.env.DB);
  const client = await getClient(db, user.id);
  if (!client) return c.json({ error: "no hosting found" }, 404);

  const accountSlug = await ensureAccountSlug(db, client, user.name || (user.email.split("@")[0] ?? user.email));

  return c.json({
    id:          client.id,
    status:      client.status,
    accountSlug,
    pagesDomain: c.env.PAGES_DOMAIN,
    // Alias DNS de la DB en Fase B; mientras, la IP pública del node
    dbHost:      c.env.DB_DOMAIN ? `${user.id}.${c.env.DB_DOMAIN}` : (client.node?.ipPublic ?? null),
    sftpHost:    client.node?.ipPublic ?? null,
    sftpUser:    client.linuxUser,
    plan:        client.plan ? { id: client.plan.id, name: client.plan.name } : null,
    // Tope de memoria PHP que el cliente puede asignar a un proyecto (= su plan).
    phpMemoryMaxMb: client.plan?.phpMemoryLimitMb ?? 256,
  });
});

// Renombrar el slug de cuenta cambia TODOS los hosts de los proyectos del
// cliente: se recablean los listeners de cada proyecto en el agente.
accountRouter.patch("/slug", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ slug: string }>();

  const db     = createDb(c.env.DB);
  const client = await getClient(db, user.id);
  if (!client) return c.json({ error: "no hosting found" }, 404);

  const newSlug = body.slug?.trim().toLowerCase() ?? "";
  if (!isValidSlug(newSlug)) {
    return c.json({ error: "Slug inválido: solo letras minúsculas, números y guiones (sin '--')" }, 400);
  }
  if (newSlug === client.accountSlug) return c.json({ ok: true, accountSlug: newSlug });

  const inUse = await db.query.clients.findFirst({ where: eq(clients.accountSlug, newSlug) });
  if (inUse) return c.json({ error: `El slug "${newSlug}" ya está en uso` }, 409);

  // Los buzones de correo viven en <slug>.<EMAIL_DOMAIN> — renombrar el slug
  // les cambiaría la dirección. Bloquear mientras existan buzones.
  const mailboxes = await db.query.emailAccounts.findMany({ where: eq(emailAccounts.clientId, client.id) });
  if (mailboxes.length > 0) {
    return c.json({ error: "No puedes cambiar el slug mientras tengas buzones de correo — elimínalos primero" }, 409);
  }

  const rows = await db.query.projects.findMany({ where: eq(projects.clientId, client.id) });
  const bezentiProjects = rows.filter((p) => p.subdomain);

  // Pre-validar TODO antes de tocar nada
  for (const p of bezentiProjects) {
    if (!fitsDnsLabel(p.subdomain!, newSlug)) {
      return c.json({ error: `El proyecto "${p.name}" quedaría con un host demasiado largo` }, 400);
    }
    const newHost = computeProjectHost(p.subdomain!, newSlug, c.env.PAGES_DOMAIN);
    const taken   = await db.query.projects.findFirst({ where: eq(projects.domain, newHost) });
    if (taken && taken.id !== p.id) {
      return c.json({ error: `El host ${newHost} ya está en uso` }, 409);
    }
  }

  if (bezentiProjects.length > 0 && !client.node) {
    return c.json({ error: "El hosting no tiene node asignado" }, 409);
  }

  // Recablear listeners por proyecto y persistir cada uno al éxito
  for (const p of bezentiProjects) {
    const newHost = computeProjectHost(p.subdomain!, newSlug, c.env.PAGES_DOMAIN);
    const agent   = await agentFetch(client.node!, `/projects/${p.id}/hosts`, "POST", {
      add:    [newHost],
      remove: [p.domain],
    });
    if (!agent.ok) {
      return c.json({ error: `Fallo recableando "${p.name}": ${agent.error}. El slug no se cambió.` }, 502);
    }
    await db.update(projects).set({ domain: newHost }).where(eq(projects.id, p.id));
  }

  await db.update(clients).set({ accountSlug: newSlug }).where(eq(clients.id, client.id));
  return c.json({ ok: true, accountSlug: newSlug });
});
