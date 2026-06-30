import { Hono } from "hono";
import { WorkerMailer } from "worker-mailer";
import type { Env } from "../env";

// ⚠️ TEMPORAL — endpoint admin para crear/asegurar un buzón de SISTEMA en
// Stalwart (p. ej. noreply@bezenti.com) reutilizando el STALWART_TOKEN que ya
// vive en el Worker, y probar el envío SMTP. Se monta bajo /admin (requiere
// sesión admin). ELIMINAR tras dejar SMTP_PASSWORD configurado.
export const adminMailRouter = new Hono<{ Bindings: Env }>();

type JmapCall = [string, Record<string, unknown>, string];

async function stalwartJmap(env: Env, calls: JmapCall[]): Promise<JmapCall[]> {
  const auth = env.STALWART_TOKEN.includes(":")
    ? `Basic ${btoa(env.STALWART_TOKEN)}`
    : `Bearer ${env.STALWART_TOKEN}`;
  const res = await fetch(`${env.STALWART_URL}/jmap`, {
    method:  "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      using:       ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"],
      methodCalls: calls,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Stalwart ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json<{ methodResponses: JmapCall[] }>();
  return data.methodResponses;
}

function setResult(responses: JmapCall[], key: string): { id?: string; error?: string } {
  for (const [method, args] of responses) {
    if (method === "error") {
      const a = args as { description?: string; type?: string };
      return { error: a.description ?? String(a.type) };
    }
    const created    = (args as { created?: Record<string, { id: string }> }).created;
    const notCreated = (args as { notCreated?: Record<string, { description?: string; type?: string }> }).notCreated;
    if (created?.[key]) return { id: created[key].id };
    if (notCreated?.[key]) { const e = notCreated[key]; return { error: e.description ?? e.type ?? "rechazado" }; }
  }
  return { error: "respuesta inesperada del servidor de correo" };
}

async function ensureDomain(env: Env, domain: string): Promise<string> {
  const [get] = await stalwartJmap(env, [["x:Domain/get", { ids: null }, "c0"]]);
  const list  = ((get?.[1] as { list?: { id: string; name: string }[] })?.list) ?? [];
  const found = list.find((d) => d.name === domain);
  if (found) return found.id;
  const responses = await stalwartJmap(env, [[
    "x:Domain/set",
    { create: { d1: {
      name: domain,
      certificateManagement: { "@type": "Manual" },
      dkimManagement:        { "@type": "Automatic" },
      dnsManagement:         { "@type": "Manual" },
      subAddressing:         { "@type": "Enabled" },
    } } },
    "c1",
  ]]);
  const r = setResult(responses, "d1");
  if (!r.id) throw new Error(`dominio: ${r.error}`);
  return r.id;
}

async function findAccountByName(env: Env, name: string): Promise<string | null> {
  const [get] = await stalwartJmap(env, [["x:Account/get", { ids: null }, "c0"]]);
  const list  = ((get?.[1] as { list?: { id: string; name: string }[] })?.list) ?? [];
  return list.find((a) => a.name === name)?.id ?? null;
}

adminMailRouter.post("/system-mailbox", async (c) => {
  const { local, password, testTo } = await c.req.json<{ local: string; password: string; testTo?: string }>();
  if (!local || !password) return c.json({ error: "local y password requeridos" }, 400);

  const domain = c.env.EMAIL_DOMAIN;
  const email  = `${local}@${domain}`;
  let created = false, updated = false;

  try {
    const domainId = await ensureDomain(c.env, domain);

    // Intentar crear; si ya existe el buzón, buscarlo y actualizar su clave.
    const resp = await stalwartJmap(c.env, [[
      "x:Account/set",
      { create: { a1: {
        "@type":     "User",
        name:        local,
        domainId,
        description: "Bezenti sistema (transaccional)",
        credentials: { "0": { "@type": "Password", secret: password } },
        quotas:      { maxDiskQuota: 512 * 1024 * 1024 },
      } } },
      "c1",
    ]]);
    const r = setResult(resp, "a1");
    if (r.id) {
      created = true;
    } else {
      const id = await findAccountByName(c.env, local);
      if (!id) return c.json({ error: `crear: ${r.error}` }, 502);
      const upd  = await stalwartJmap(c.env, [[
        "x:Account/set",
        { update: { [id]: { credentials: { "0": { "@type": "Password", secret: password } } } } },
        "c1",
      ]]);
      const args = upd[0]?.[1] as { updated?: Record<string, unknown>; notUpdated?: Record<string, { description?: string }> };
      if (!args?.updated || !(id in args.updated)) {
        return c.json({ error: `update: ${args?.notUpdated?.[id]?.description ?? "fallo"}` }, 502);
      }
      updated = true;
    }
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }

  // Prueba de envío real con las credenciales recién aplicadas (no usa el
  // secret del entorno, así verifica login SMTP de inmediato).
  let testSend: { ok: boolean; error?: string } | undefined;
  if (testTo) {
    try {
      await WorkerMailer.send(
        {
          host:        c.env.SMTP_HOST,
          port:        Number(c.env.SMTP_PORT) || 465,
          secure:      c.env.SMTP_SECURE !== "false",
          startTls:    c.env.SMTP_SECURE === "false",
          credentials: { username: email, password },
          authType:    ["plain", "login"],
        },
        {
          from:    { name: "Bezenti", email },
          to:      { email: testTo },
          subject: "Prueba SMTP Bezenti (noreply)",
          text:    "Si lees esto, el envío SMTP desde noreply@bezenti.com funciona correctamente.",
        },
      );
      testSend = { ok: true };
    } catch (err) {
      testSend = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  return c.json({ email, created, updated, testSend });
});
