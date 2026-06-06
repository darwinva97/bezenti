/**
 * Worker de Cloudflare con Static Assets.
 *
 * - Sirve el build estático de Astro (carpeta ./dist) tal cual: SSG intacto.
 * - La ÚNICA pieza dinámica es la raíz "/": lee el header Accept-Language
 *   (o la cookie de preferencia) y redirige 302 al idioma correspondiente.
 *
 * Como no existe ningún asset para "/" (no generamos dist/index.html), las
 * peticiones a la raíz caen en este Worker; el resto de rutas (/es/..., /en/...)
 * coinciden con un asset estático y se sirven directamente desde la CDN.
 */

interface Env {
  ASSETS: Fetcher;
  /** Base de datos de suscriptores de la newsletter. */
  DB: D1Database;
  // --- SMTP (Stalwart) para la newsletter. `vars` + secreto SMTP_PASSWORD. ---
  SMTP_HOST: string;
  SMTP_PORT: string;
  SMTP_SECURE?: string;
  SMTP_USER: string;
  SMTP_PASSWORD: string;
  SMTP_FROM?: string;
  SITE_URL?: string;
  /** Secreto para autorizar el envío manual/cron (/api/admin/send). */
  ADMIN_SECRET: string;
}

import { sendNewsletter, type PostByLocale } from "./email";

const LOCALES = ["es", "en"] as const;
// Si en "/" no hay cookie ni el Accept-Language coincide con un idioma
// soportado, servimos inglés.
const DEFAULT_LOCALE = "en";

function isLocale(value: string): boolean {
  return (LOCALES as readonly string[]).includes(value);
}

/** Elige el mejor idioma soportado a partir del header Accept-Language. */
function pickLocale(header: string | null): string {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { base: tag.toLowerCase().split("-")[0], q: q ? parseFloat(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { base } of ranked) {
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Función del Worker: recibe el formulario de contacto. */
async function handleContact(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "method" }, { status: 405 });
  }

  let body: Record<string, unknown>;
  try {
    const ct = request.headers.get("Content-Type") ?? "";
    body = ct.includes("application/json")
      ? await request.json()
      : Object.fromEntries(await request.formData());
  } catch {
    return Response.json({ ok: false, error: "bad-request" }, { status: 400 });
  }

  // Honeypot: si el campo oculto viene relleno, es un bot. Fingimos éxito.
  if (typeof body.company === "string" && body.company.trim() !== "") {
    return Response.json({ ok: true });
  }

  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim();
  const message = String(body.message ?? "").trim();

  if (!name || !message || !EMAIL_RE.test(email)) {
    return Response.json({ ok: false, error: "validation" }, { status: 400 });
  }

  // TODO entrega real: reenviar a un email (Resend/MailChannels), guardar en
  // KV/D1 o llamar a un webhook. Requiere credenciales como secretos del Worker.
  console.log("[contact]", { name, email, message: message.slice(0, 200) });

  return Response.json({ ok: true });
}

/** Idioma a partir del Referer (la página desde la que se envió el formulario). */
function localeFromReferer(referer: string | null): string {
  if (referer && /\/en(\/|$|\?)/.test(referer)) return "en";
  return "es";
}

/** Función del Worker: alta en la newsletter (footer). Persiste en D1. */
async function handleSubscribe(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "method" }, { status: 405 });
  }

  let body: Record<string, unknown>;
  try {
    const ct = request.headers.get("Content-Type") ?? "";
    body = ct.includes("application/json")
      ? await request.json()
      : Object.fromEntries(await request.formData());
  } catch {
    return Response.json({ ok: false, error: "bad-request" }, { status: 400 });
  }

  // Honeypot: campo oculto relleno = bot. Fingimos éxito.
  if (typeof body.company === "string" && body.company.trim() !== "") {
    return Response.json({ ok: true });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return Response.json({ ok: false, error: "validation" }, { status: 400 });
  }

  const token = crypto.randomUUID();
  const locale = localeFromReferer(request.headers.get("Referer"));

  // Alta idempotente: si ya existe, se reactiva (por si se había dado de baja).
  // El token original se conserva (no se sobrescribe en el conflicto).
  await env.DB.prepare(
    `INSERT INTO subscribers (email, token, locale, status, created_at)
     VALUES (?1, ?2, ?3, 'active', ?4)
     ON CONFLICT(email) DO UPDATE SET status = 'active', locale = ?3`,
  )
    .bind(email, token, locale, Date.now())
    .run();

  return Response.json({ ok: true });
}

/** Página de baja de la newsletter: GET /api/unsubscribe?email=..&token=.. */
async function handleUnsubscribe(env: Env, url: URL): Promise<Response> {
  const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
  const token = (url.searchParams.get("token") ?? "").trim();
  let ok = false;
  if (email && token) {
    const res = await env.DB.prepare(
      "UPDATE subscribers SET status = 'unsubscribed' WHERE email = ?1 AND token = ?2",
    )
      .bind(email, token)
      .run();
    ok = (res.meta.changes ?? 0) > 0;
  }
  const msg = ok
    ? "Te has dado de baja. No recibirás más correos. · You've been unsubscribed."
    : "No encontramos esa suscripción. · Subscription not found.";
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bezenti · Newsletter</title>
<style>body{font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a;display:grid;place-items:center;min-height:100vh;margin:0}
.card{max-width:30rem;padding:2.5rem;text-align:center}.card a{color:#1f6feb}</style></head>
<body><div class="card"><h1 style="font-size:1.25rem">${msg}</h1>
<p style="margin-top:1rem;color:#475569"><a href="https://bezenti.com">← bezenti.com</a></p></div></body></html>`;
  return new Response(html, {
    status: ok ? 200 : 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * Envío manual de la newsletter (protegido). La Fase 3 (cron) llama a
 * `sendNewsletter` directamente; este endpoint sirve para pruebas y disparos
 * manuales. Auth: header `Authorization: Bearer <ADMIN_SECRET>`.
 * Body JSON: { "post": { "es": {slug,title,description}, "en": {...} } }
 */
async function handleAdminSend(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "method" }, { status: 405 });
  }
  if (!env.ADMIN_SECRET || request.headers.get("Authorization") !== `Bearer ${env.ADMIN_SECRET}`) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: { post?: PostByLocale };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "bad-request" }, { status: 400 });
  }
  const post = body.post;
  if (!post || (!post.es && !post.en)) {
    return Response.json({ ok: false, error: "validation" }, { status: 400 });
  }
  try {
    const summary = await sendNewsletter(env, post);
    return Response.json({ ok: true, ...summary });
  } catch (e) {
    return Response.json({ ok: false, error: "send-failed", detail: String(e) }, { status: 502 });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/contact") {
      return handleContact(request);
    }

    if (url.pathname === "/api/subscribe") {
      return handleSubscribe(request, env);
    }

    if (url.pathname === "/api/unsubscribe") {
      return handleUnsubscribe(env, url);
    }

    if (url.pathname === "/api/admin/send") {
      return handleAdminSend(request, env);
    }

    if (url.pathname === "/") {
      // La cookie (elección explícita del usuario) tiene prioridad sobre el header.
      const saved = /(?:^|;\s*)locale=(\w{2})/.exec(
        request.headers.get("Cookie") ?? "",
      )?.[1];

      const locale =
        saved && isLocale(saved)
          ? saved
          : pickLocale(request.headers.get("Accept-Language"));

      return new Response(null, {
        status: 302, // temporal: el destino depende del usuario, no es permanente
        headers: {
          Location: `/${locale}`,
          "Set-Cookie": `locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`,
          "Cache-Control": "no-store",
          Vary: "Accept-Language",
        },
      });
    }

    // Resto de rutas: servir el asset estático correspondiente.
    return env.ASSETS.fetch(request);
  },
};
