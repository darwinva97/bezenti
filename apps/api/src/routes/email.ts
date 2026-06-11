import { Hono } from "hono";
import { createDb, emailAccounts, clients } from "@bezenti/db";
import { eq } from "drizzle-orm";
import type { Env } from "../env";

export const emailRouter = new Hono<{ Bindings: Env }>();

emailRouter.get("/", async (c) => {
  const userId = c.get("user").id;
  const db     = createDb(c.env.DB);
  const client = await db.query.clients.findFirst({ where: eq(clients.userId, userId) });
  if (!client) return c.json({ error: "not found" }, 404);

  const rows = await db.query.emailAccounts.findMany({
    where: eq(emailAccounts.clientId, client.id),
  });
  return c.json(rows);
});

emailRouter.post("/", async (c) => {
  const userId = c.get("user").id;
  const { email, quotaMb } = await c.req.json<{ email: string; quotaMb?: number }>();

  const db     = createDb(c.env.DB);
  const client = await db.query.clients.findFirst({ where: eq(clients.userId, userId) });
  if (!client) return c.json({ error: "not found" }, 404);

  // Crear cuenta en Stalwart via API externa
  const stalwartId = await stalwartCreateAccount(c.env.STALWART_URL, c.env.STALWART_TOKEN, {
    email,
    quotaMb: quotaMb ?? 1024,
  });

  const id = crypto.randomUUID();
  await db.insert(emailAccounts).values({
    id,
    clientId:   client.id,
    email,
    stalwartId,
    quotaMb:    quotaMb ?? 1024,
    createdAt:  new Date(),
  });

  return c.json({ id, email }, 201);
});

emailRouter.patch("/:id/quota", async (c) => {
  const { quotaMb } = await c.req.json<{ quotaMb: number }>();
  const db     = createDb(c.env.DB);
  const account = await db.query.emailAccounts.findFirst({
    where: eq(emailAccounts.id, c.req.param("id")),
  });
  if (!account) return c.json({ error: "not found" }, 404);

  await stalwartUpdateQuota(c.env.STALWART_URL, c.env.STALWART_TOKEN, account.stalwartId!, quotaMb);
  await db.update(emailAccounts).set({ quotaMb }).where(eq(emailAccounts.id, account.id));
  return c.json({ ok: true });
});

emailRouter.delete("/:id", async (c) => {
  const db      = createDb(c.env.DB);
  const account = await db.query.emailAccounts.findFirst({
    where: eq(emailAccounts.id, c.req.param("id")),
  });
  if (!account) return c.json({ error: "not found" }, 404);

  await stalwartDeleteAccount(c.env.STALWART_URL, c.env.STALWART_TOKEN, account.stalwartId!);
  await db.update(emailAccounts).set({ status: "deleted" }).where(eq(emailAccounts.id, account.id));
  return c.body(null, 204);
});

// ── Stalwart Mail API helpers ─────────────────────────────────────────────────

async function stalwartCreateAccount(baseUrl: string, token: string, opts: { email: string; quotaMb: number }) {
  const [local, domain] = opts.email.split("@");
  const res = await fetch(`${baseUrl}/api/principal`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      type:   "individual",
      name:   local,
      emails: [opts.email],
      quota:  opts.quotaMb * 1024 * 1024,
    }),
  });
  if (!res.ok) throw new Error(`Stalwart create failed: ${await res.text()}`);
  const data = await res.json<{ id: string }>();
  return data.id;
}

async function stalwartUpdateQuota(baseUrl: string, token: string, stalwartId: string, quotaMb: number) {
  await fetch(`${baseUrl}/api/principal/${stalwartId}`, {
    method:  "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([{ op: "replace", path: "/quota", value: quotaMb * 1024 * 1024 }]),
  });
}

async function stalwartDeleteAccount(baseUrl: string, token: string, stalwartId: string) {
  await fetch(`${baseUrl}/api/principal/${stalwartId}`, {
    method:  "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}
