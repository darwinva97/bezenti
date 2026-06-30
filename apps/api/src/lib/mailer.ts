/**
 * Envío de correos transaccionales del control plane (reset de contraseña, etc.)
 * por SMTP del servidor Stalwart, usando worker-mailer (SMTP sobre los TCP
 * sockets de Cloudflare Workers — TLS implícito en :465 o STARTTLS en :587).
 *
 * Mismo enfoque que apps/web (newsletter/contacto). Config por vars de
 * wrangler.jsonc: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_FROM.
 * Secreto: `wrangler secret put SMTP_PASSWORD`.
 */
import { WorkerMailer } from "worker-mailer";

export interface SmtpEnv {
  SMTP_HOST:      string;
  SMTP_PORT:      string;
  SMTP_SECURE?:   string; // "true" => TLS implícito (465); si no, STARTTLS (587)
  SMTP_USER:      string;
  SMTP_PASSWORD:  string;
  SMTP_FROM?:     string; // "Bezenti <noreply@bezenti.com>"
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

/** Envío genérico de un correo por la cuenta del sistema (SMTP_USER). */
export async function sendMail(
  env: SmtpEnv,
  msg: { to: string; subject: string; html: string; text: string },
): Promise<void> {
  const from = parseFrom(env.SMTP_FROM, env.SMTP_USER);
  await WorkerMailer.send(
    {
      host:        env.SMTP_HOST,
      port:        Number(env.SMTP_PORT) || 465,
      secure:      env.SMTP_SECURE !== "false",
      startTls:    env.SMTP_SECURE === "false",
      credentials: { username: env.SMTP_USER, password: env.SMTP_PASSWORD },
      authType:    ["plain", "login"],
    },
    { from, to: { email: msg.to }, subject: msg.subject, text: msg.text, html: msg.html },
  );
}

/**
 * Correo de "restablecer contraseña". `appName` distingue el origen (panel de
 * administración vs. portal de cliente); `url` es el enlace de un solo uso que
 * genera better-auth (caduca en 1 h).
 */
export async function sendResetPasswordEmail(
  env: SmtpEnv,
  opts: { to: string; userName?: string | null; url: string; appName: string },
): Promise<void> {
  const greetingName = opts.userName?.trim() || opts.to.split("@")[0] || "";
  const subject = `Restablece tu contraseña · ${opts.appName}`;
  const text =
    `Hola ${greetingName},\n\n` +
    `Recibimos una solicitud para restablecer la contraseña de tu cuenta en ${opts.appName}.\n\n` +
    `Abre este enlace para elegir una nueva contraseña (caduca en 1 hora):\n${opts.url}\n\n` +
    `Si no fuiste tú, ignora este correo: tu contraseña no cambiará.\n\n— Bezenti`;
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
      <tr><td style="background:#0f172a;padding:20px 28px"><span style="color:#fff;font-size:20px;font-weight:700">bezenti</span></td></tr>
      <tr><td style="padding:28px">
        <h1 style="margin:0 0 12px;color:#0f172a;font-size:20px">Restablece tu contraseña</h1>
        <p style="margin:0 0 8px;color:#475569;font-size:15px;line-height:1.6">Hola ${escapeHtml(greetingName)}, recibimos una solicitud para restablecer la contraseña de tu cuenta en <strong>${escapeHtml(opts.appName)}</strong>.</p>
        <p style="margin:0 0 22px;color:#475569;font-size:15px;line-height:1.6">Haz clic en el botón para elegir una nueva contraseña. El enlace caduca en 1 hora.</p>
        <a href="${opts.url}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:9999px">Restablecer contraseña →</a>
        <p style="margin:22px 0 0;color:#94a3b8;font-size:13px;line-height:1.6">Si no solicitaste esto, ignora este correo: tu contraseña no cambiará.</p>
      </td></tr>
      <tr><td style="padding:18px 28px;border-top:1px solid #e2e8f0"><p style="margin:0;color:#94a3b8;font-size:12px">${escapeHtml(opts.appName)} · <a href="https://bezenti.com" style="color:#64748b">bezenti.com</a></p></td></tr>
    </table></td></tr></table></body></html>`;
  await sendMail(env, { to: opts.to, subject, html, text });
}
