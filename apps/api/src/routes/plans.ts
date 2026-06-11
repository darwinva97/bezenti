import { Hono } from "hono";
import { createDb, plans } from "@bezenti/db";
import { eq } from "drizzle-orm";
import type { Env } from "../env";

export const plansRouter = new Hono<{ Bindings: Env }>();

plansRouter.get("/", async (c) => {
  const db   = createDb(c.env.DB);
  const rows = await db.query.plans.findMany({
    where: eq(plans.isActive, true),
  });
  return c.json(rows);
});

plansRouter.get("/:id", async (c) => {
  const db   = createDb(c.env.DB);
  const plan = await db.query.plans.findFirst({ where: eq(plans.id, c.req.param("id")) });
  if (!plan) return c.json({ error: "not found" }, 404);
  return c.json(plan);
});

plansRouter.post("/", async (c) => {
  const body = await c.req.json<{
    name: string; pricePen: number; priceUsd?: number;
    diskMb: number; ramMbSoft: number;
    maxDomains: number; maxDatabases: number;
    phpVersions?: string; phpMemoryLimitMb?: number;
    phpMaxProcesses?: number; bandwidthGbMonth?: number;
  }>();

  const db = createDb(c.env.DB);
  const id = crypto.randomUUID();

  await db.insert(plans).values({
    id,
    name:              body.name,
    pricePen:          body.pricePen,
    priceUsd:          body.priceUsd,
    diskMb:            body.diskMb,
    ramMbSoft:         body.ramMbSoft,
    maxDomains:        body.maxDomains,
    maxDatabases:      body.maxDatabases,
    phpVersions:       body.phpVersions ?? '["8.3"]',
    phpMemoryLimitMb:  body.phpMemoryLimitMb ?? 128,
    phpMaxProcesses:   body.phpMaxProcesses ?? 5,
    bandwidthGbMonth:  body.bandwidthGbMonth,
    createdAt:         new Date(),
  });

  return c.json({ id }, 201);
});

plansRouter.patch("/:id", async (c) => {
  const body = await c.req.json<Partial<typeof plans.$inferInsert>>();
  const db   = createDb(c.env.DB);

  await db.update(plans).set(body).where(eq(plans.id, c.req.param("id")));
  return c.json({ ok: true });
});
