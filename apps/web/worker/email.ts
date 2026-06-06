/**
 * Envío de la newsletter por SMTP (tu servidor Stalwart) usando worker-mailer,
 * que habla SMTP sobre los TCP sockets de Cloudflare Workers (STARTTLS / TLS).
 *
 * Config por variables (wrangler.jsonc `vars`): SMTP_HOST, SMTP_PORT,
 * SMTP_SECURE, SMTP_USER, SMTP_FROM, SITE_URL.
 * Secretos (wrangler secret put): SMTP_PASSWORD.
 */
import { WorkerMailer } from "worker-mailer";

export interface MailEnv {
  DB: D1Database;
  SMTP_HOST: string;
  SMTP_PORT: string;
  SMTP_SECURE?: string; // "true" => TLS implícito (465); si no, STARTTLS (587)
  SMTP_USER: string;
  SMTP_PASSWORD: string;
  SMTP_FROM?: string; // "Bezenti <newsletter@bezenti.com>"
  SITE_URL?: string; // https://bezenti.com
}

/** Datos del post por idioma para construir el correo. */
export interface PostByLocale {
  es?: { slug: string; title: string; description: string };
  en?: { slug: string; title: string; description: string };
}

const COPY = {
  es: {
    subject: (t: string) => `Nuevo en el blog: ${t}`,
    intro: "Acabamos de publicar un artículo nuevo:",
    cta: "Leer el artículo",
    why: "Recibes este correo porque te suscribiste a la newsletter de Bezenti.",
    unsub: "Darme de baja",
  },
  en: {
    subject: (t: string) => `New on the blog: ${t}`,
    intro: "We just published a new article:",
    cta: "Read the article",
    why: "You're getting this because you subscribed to the Bezenti newsletter.",
    unsub: "Unsubscribe",
  },
};

function renderEmail(opts: {
  locale: "es" | "en";
  title: string;
  description: string;
  postUrl: string;
  unsubUrl: string;
}): { subject: string; html: string; text: string } {
  const c = COPY[opts.locale];
  const subject = c.subject(opts.title);
  const text =
    `${c.intro}\n\n${opts.title}\n${opts.description}\n\n${c.cta}: ${opts.postUrl}\n\n` +
    `— Bezenti\n${c.why}\n${c.unsub}: ${opts.unsubUrl}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
        <tr><td style="background:#0f172a;padding:20px 28px">
          <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.02em">bezenti</span>
        </td></tr>
        <tr><td style="padding:28px">
          <p style="margin:0 0 14px;color:#475569;font-size:15px">${c.intro}</p>
          <h1 style="margin:0 0 10px;color:#0f172a;font-size:22px;line-height:1.3">${escapeHtml(opts.title)}</h1>
          <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6">${escapeHtml(opts.description)}</p>
          <a href="${opts.postUrl}" style="display:inline-block;background:#1f6feb;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:9999px">${c.cta} →</a>
        </td></tr>
        <tr><td style="padding:20px 28px;border-top:1px solid #e2e8f0">
          <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6">${c.why}<br>
          <a href="${opts.unsubUrl}" style="color:#64748b">${c.unsub}</a> · <a href="${opts.SITE_URL ?? "https://bezenti.com"}" style="color:#64748b">bezenti.com</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
  return { subject, html, text };
}

/** Convierte "Nombre <correo@dominio>" en { name, email }. */
function parseFrom(raw: string | undefined, fallbackEmail: string): { name?: string; email: string } {
  if (!raw) return { name: "Bezenti", email: fallbackEmail };
  const m = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1] || undefined, email: m[2].trim() };
  return { email: raw.trim() };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

/**
 * Envía un post a todos los suscriptores activos, cada uno en su idioma y con su
 * propio enlace de baja. Devuelve un resumen {sent, failed}.
 */
export async function sendNewsletter(
  env: MailEnv,
  post: PostByLocale,
): Promise<{ sent: number; failed: number; total: number; errors: string[] }> {
  const site = env.SITE_URL ?? "https://bezenti.com";
  // El sobre MAIL FROM debe ser SOLO la dirección; el nombre va aparte. Si se
  // pasa "Nombre <correo>" como string, worker-mailer lo usa entero y el SMTP
  // lo rechaza (501 Bad sender). Por eso lo parseamos a { name, email }.
  const from = parseFrom(env.SMTP_FROM, env.SMTP_USER);

  const { results } = await env.DB.prepare(
    "SELECT email, token, locale FROM subscribers WHERE status = 'active'",
  ).all<{ email: string; token: string; locale: string }>();

  const recipients = (results ?? []).filter((r) => {
    const loc = r.locale === "en" ? "en" : "es";
    return Boolean(post[loc]);
  });
  if (recipients.length === 0) return { sent: 0, failed: 0, total: 0 };

  const mailer = await WorkerMailer.connect({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT) || 465,
    secure: env.SMTP_SECURE !== "false",
    startTls: env.SMTP_SECURE === "false",
    credentials: { username: env.SMTP_USER, password: env.SMTP_PASSWORD },
    authType: ["plain", "login"],
  });

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  try {
    for (const r of recipients) {
      const loc = (r.locale === "en" ? "en" : "es") as "es" | "en";
      const data = post[loc]!;
      const postUrl = `${site}/${loc}/blog/${data.slug}`;
      const unsubUrl = `${site}/api/unsubscribe?email=${encodeURIComponent(r.email)}&token=${r.token}`;
      const { subject, html, text } = renderEmail({
        locale: loc,
        title: data.title,
        description: data.description,
        postUrl,
        unsubUrl,
      });
      try {
        await mailer.send({ from, to: { email: r.email }, subject, text, html });
        sent++;
      } catch (e) {
        failed++;
        if (errors.length < 3) errors.push(String((e as Error)?.message ?? e));
      }
    }
  } finally {
    await mailer.close().catch(() => {});
  }
  return { sent, failed, total: recipients.length, errors };
}
