import { Hono } from "hono";
import { createDb, projects, clients } from "@bezenti/db";
import { eq, desc } from "drizzle-orm";
import type { Env } from "../env";

export const projectsRouter = new Hono<{ Bindings: Env }>();

projectsRouter.get("/", async (c) => {
  const userId = c.get("user").id;
  const db     = createDb(c.env.DB);
  const client = await db.query.clients.findFirst({ where: eq(clients.userId, userId) });
  if (!client) return c.json({ error: "no hosting found" }, 404);

  const rows = await db.query.projects.findMany({
    where:   eq(projects.clientId, client.id),
    orderBy: desc(projects.createdAt),
  });
  return c.json(rows);
});

projectsRouter.post("/", async (c) => {
  const userId = c.get("user").id;
  const body   = await c.req.json<{
    name: string; domain: string; phpVersion?: string; docPath?: string;
  }>();

  const db     = createDb(c.env.DB);
  const client = await db.query.clients.findFirst({ where: eq(clients.userId, userId) });
  if (!client) return c.json({ error: "no hosting found" }, 404);

  const id = crypto.randomUUID();
  await db.insert(projects).values({
    id,
    clientId:   client.id,
    name:       body.name,
    domain:     body.domain,
    phpVersion: body.phpVersion ?? "8.3",
    docPath:    body.docPath ?? body.name.toLowerCase().replace(/\s+/g, "-"),
    createdAt:  new Date(),
  });

  // TODO: Queue → node agent configura NGINX Unit + Cloudflare DNS
  return c.json({ id }, 201);
});

projectsRouter.patch("/:id/php", async (c) => {
  const { phpVersion } = await c.req.json<{ phpVersion: string }>();
  const db = createDb(c.env.DB);
  await db.update(projects).set({ phpVersion }).where(eq(projects.id, c.req.param("id")));
  // TODO: Queue → node agent actualiza pool PHP-FPM o NGINX Unit app
  return c.json({ ok: true });
});

projectsRouter.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  await db.update(projects).set({ status: "deleted" }).where(eq(projects.id, c.req.param("id")));
  // TODO: Queue → node agent elimina listener + Cloudflare elimina DNS
  return c.body(null, 204);
});
