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

/** Config SMTP de la cuenta de contacto (separada de la newsletter). */
export interface ContactEnv {
  SMTP_HOST: string;
  SMTP_PORT: string;
  SMTP_SECURE?: string;
  CONTACT_SMTP_USER: string;
  CONTACT_SMTP_PASSWORD: string;
  CONTACT_SMTP_FROM?: string; // "Bezenti <contact@bezenti.com>"
  SITE_URL?: string;
}

const CONTACT_COPY = {
  es: {
    subject: "Hemos recibido tu mensaje",
    hi: (n) => `Hola ${n},`,
    body: "Gracias por escribirnos. Hemos recibido tu mensaje y te responderemos lo antes posible.",
    yours: "Tu mensaje:",
    sign: "Equipo Bezenti",
  },
  en: {
    subject: "We received your message",
    hi: (n) => `Hi ${n},`,
    body: "Thanks for reaching out. We've received your message and will get back to you as soon as possible.",
    yours: "Your message:",
    sign: "The Bezenti team",
  },
};

/**
 * Envía dos correos por la cuenta de contacto: confirmación al usuario y aviso
 * al equipo (a la propia cuenta de contacto, con reply-to del usuario).
 */
export async function sendContact(
  env: ContactEnv,
  data: { name: string; email: string; message: string; locale: "es" | "en" },
): Promise<void> {
  const c = CONTACT_COPY[data.locale];
  const site = env.SITE_URL ?? "https://bezenti.com";
  const from = parseFrom(env.CONTACT_SMTP_FROM, env.CONTACT_SMTP_USER);
  const mailer = await WorkerMailer.connect({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT) || 465,
    secure: env.SMTP_SECURE !== "false",
    startTls: env.SMTP_SECURE === "false",
    credentials: { username: env.CONTACT_SMTP_USER, password: env.CONTACT_SMTP_PASSWORD },
    authType: ["plain", "login"],
  });
  try {
    // 1) Confirmación al usuario.
    const confHtml = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
      <tr><td style="background:#0f172a;padding:20px 28px"><span style="color:#fff;font-size:20px;font-weight:700">bezenti</span></td></tr>
      <tr><td style="padding:28px">
        <p style="margin:0 0 12px;color:#0f172a;font-size:16px">${escapeHtml(c.hi(data.name))}</p>
        <p style="margin:0 0 18px;color:#475569;font-size:15px;line-height:1.6">${c.body}</p>
        <p style="margin:0 0 6px;color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:.04em">${c.yours}</p>
        <p style="margin:0;color:#334155;font-size:14px;line-height:1.6;white-space:pre-wrap;border-left:3px solid #e2e8f0;padding-left:12px">${escapeHtml(data.message)}</p>
      </td></tr>
      <tr><td style="padding:18px 28px;border-top:1px solid #e2e8f0"><p style="margin:0;color:#94a3b8;font-size:12px">${c.sign} · <a href="${site}" style="color:#64748b">bezenti.com</a></p></td></tr>
    </table></td></tr></table></body></html>`;
    await mailer.send({
      from,
      to: { name: data.name, email: data.email },
      subject: `${c.subject} · Bezenti`,
      text: `${c.hi(data.name)}\n\n${c.body}\n\n${c.yours}\n${data.message}\n\n— ${c.sign}\n${site}`,
      html: confHtml,
    });

    // 2) Aviso al equipo (a la cuenta de contacto), respondible al usuario.
    await mailer.send({
      from,
      to: { email: env.CONTACT_SMTP_USER },
      reply: { name: data.name, email: data.email },
      subject: `Nuevo contacto: ${data.name}`,
      text: `Nombre: ${data.name}\nEmail: ${data.email}\nIdioma: ${data.locale}\n\nMensaje:\n${data.message}`,
    });
  } finally {
    await mailer.close().catch(() => {});
  }
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

const WELCOME = {
  es: {
    subject: "Bienvenido a la newsletter de Bezenti",
    hi: "¡Gracias por suscribirte!",
    body: "A partir de ahora te enviaremos nuestros artículos sobre web, ecommerce, SEO, marketing y automatización, pensados para hacer crecer tu negocio. Sin spam, y te das de baja cuando quieras.",
    cta: "Ver el blog",
    unsub: "Darme de baja",
  },
  en: {
    subject: "Welcome to the Bezenti newsletter",
    hi: "Thanks for subscribing!",
    body: "From now on we'll send you our articles on web, ecommerce, SEO, marketing and automation, written to help grow your business. No spam, and you can unsubscribe anytime.",
    cta: "Read the blog",
    unsub: "Unsubscribe",
  },
};

/** Correo de bienvenida al suscribirse (newsletter@). */
export async function sendWelcome(
  env: MailEnv,
  sub: { email: string; token: string; locale: "es" | "en" },
): Promise<void> {
  const c = WELCOME[sub.locale];
  const site = env.SITE_URL ?? "https://bezenti.com";
  const from = parseFrom(env.SMTP_FROM, env.SMTP_USER);
  const blogUrl = `${site}/${sub.locale}/blog`;
  const unsubUrl = `${site}/api/unsubscribe?email=${encodeURIComponent(sub.email)}&token=${sub.token}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
      <tr><td style="background:#0f172a;padding:20px 28px"><span style="color:#fff;font-size:20px;font-weight:700">bezenti</span></td></tr>
      <tr><td style="padding:28px">
        <h1 style="margin:0 0 12px;color:#0f172a;font-size:20px">${c.hi}</h1>
        <p style="margin:0 0 22px;color:#475569;font-size:15px;line-height:1.6">${c.body}</p>
        <a href="${blogUrl}" style="display:inline-block;background:#1f6feb;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:9999px">${c.cta} →</a>
      </td></tr>
      <tr><td style="padding:18px 28px;border-top:1px solid #e2e8f0"><p style="margin:0;color:#94a3b8;font-size:12px"><a href="${unsubUrl}" style="color:#64748b">${c.unsub}</a> · <a href="${site}" style="color:#64748b">bezenti.com</a></p></td></tr>
    </table></td></tr></table></body></html>`;
  await WorkerMailer.send(
    {
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT) || 465,
      secure: env.SMTP_SECURE !== "false",
      startTls: env.SMTP_SECURE === "false",
      credentials: { username: env.SMTP_USER, password: env.SMTP_PASSWORD },
      authType: ["plain", "login"],
    },
    {
      from,
      to: { email: sub.email },
      subject: c.subject,
      text: `${c.hi}\n\n${c.body}\n\n${c.cta}: ${blogUrl}\n\n${c.unsub}: ${unsubUrl}`,
      html,
    },
  );
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
