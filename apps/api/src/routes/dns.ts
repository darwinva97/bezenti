import { Hono } from "hono";
import { createDb, dnsZones, dnsRecords, clients } from "@bezenti/db";
import { eq } from "drizzle-orm";
import type { Env } from "../env";

export const dnsRouter = new Hono<{ Bindings: Env }>();

// ── Zonas ─────────────────────────────────────────────────────────────────────

dnsRouter.get("/zones", async (c) => {
  const userId = c.get("user").id;
  const db     = createDb(c.env.DB);
  const client = await db.query.clients.findFirst({ where: eq(clients.userId, userId) });
  if (!client) return c.json({ error: "not found" }, 404);

  const rows = await db.query.dnsZones.findMany({
    where: eq(dnsZones.clientId, client.id),
    with:  { records: true },
  });
  return c.json(rows);
});

dnsRouter.post("/zones", async (c) => {
  const userId    = c.get("user").id;
  const { zone }  = await c.req.json<{ zone: string }>();
  const db        = createDb(c.env.DB);
  const client    = await db.query.clients.findFirst({ where: eq(clients.userId, userId) });
  if (!client) return c.json({ error: "not found" }, 404);

  const id = crypto.randomUUID();
  await db.insert(dnsZones).values({ id, clientId: client.id, zone, createdAt: new Date() });

  // Registros SOA y NS por defecto al crear la zona
  await db.insert(dnsRecords).values([
    { id: crypto.randomUUID(), zoneId: id, type: "NS", name: "@", value: "ns1.bezenti.com", ttl: 86400, createdAt: new Date() },
    { id: crypto.randomUUID(), zoneId: id, type: "NS", name: "@", value: "ns2.bezenti.com", ttl: 86400, createdAt: new Date() },
  ]);

  return c.json({ id, zone }, 201);
});

dnsRouter.delete("/zones/:id", async (c) => {
  const db = createDb(c.env.DB);
  await db.delete(dnsZones).where(eq(dnsZones.id, c.req.param("id")));
  return c.body(null, 204);
});

// ── Records ───────────────────────────────────────────────────────────────────

dnsRouter.get("/zones/:zoneId/records", async (c) => {
  const db   = createDb(c.env.DB);
  const rows = await db.query.dnsRecords.findMany({
    where: eq(dnsRecords.zoneId, c.req.param("zoneId")),
  });
  return c.json(rows);
});

dnsRouter.post("/zones/:zoneId/records", async (c) => {
  const body = await c.req.json<{
    type: "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS" | "CAA" | "SRV" | "PTR";
    name: string; value: string; ttl?: number; priority?: number;
  }>();

  const db = createDb(c.env.DB);
  const id = crypto.randomUUID();
  await db.insert(dnsRecords).values({
    id,
    zoneId:    c.req.param("zoneId"),
    type:      body.type,
    name:      body.name,
    value:     body.value,
    ttl:       body.ttl ?? 3600,
    priority:  body.priority,
    createdAt: new Date(),
  });
  return c.json({ id }, 201);
});

dnsRouter.delete("/zones/:zoneId/records/:id", async (c) => {
  const db = createDb(c.env.DB);
  await db.delete(dnsRecords).where(eq(dnsRecords.id, c.req.param("id")));
  return c.body(null, 204);
});
