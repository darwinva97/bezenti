export type Env = {
  DB:                D1Database;
  ENVIRONMENT:       string;
  // better-auth
  BETTER_AUTH_URL:   string;   // URL pública del Worker, ej: https://api.bezenti.com
  BETTER_AUTH_SECRET: string;  // secret aleatorio — wrangler secret put BETTER_AUTH_SECRET
  TRUSTED_ORIGINS:   string;   // CSV: "https://panel.bezenti.com,http://localhost:3001"
  // Stalwart Mail Server (v0.16, API JMAP en POST /jmap)
  STALWART_URL:      string;   // ej: https://mail.bezenti.com
  STALWART_TOKEN:    string;   // "usuario:contraseña" (Basic) o API key (Bearer)
  // SMTP del sistema para correos transaccionales (reset de contraseña).
  // Apunta a un buzón real de Stalwart, ej: noreply@bezenti.com.
  SMTP_HOST:         string;   // ej: mail.bezenti.com
  SMTP_PORT:         string;   // "465" (TLS implícito) | "587" (STARTTLS)
  SMTP_SECURE?:      string;   // "true" => TLS implícito; "false" => STARTTLS
  SMTP_USER:         string;   // ej: noreply@bezenti.com
  SMTP_PASSWORD:     string;   // secret — wrangler secret put SMTP_PASSWORD
  SMTP_FROM?:        string;   // ej: "Bezenti <noreply@bezenti.com>"
  // Correos corporativos: el dominio de buzones de un cliente es
  // <accountSlug>.<EMAIL_DOMAIN>; MAIL_HOST es el MX/IMAP/SMTP.
  EMAIL_DOMAIN:      string;   // ej: "bezenti.com"
  MAIL_HOST:         string;   // ej: "mail.bezenti.com"
  // Cloudflare: creación automática del MX/SPF por cuenta
  CF_DNS_TOKEN:      string;   // secret — token con Zone DNS:Edit
  CF_ZONE_ID:        string;   // zona de EMAIL_DOMAIN
  // URL base donde están los binarios del agente para descarga
  // ej: https://releases.bezenti.com o URL de Cloudflare R2 pública
  AGENT_BINARY_URL:  string;
  // Dominio base de los subdominios Bezenti por proyecto, ej: "pages.bezenti.com".
  // El host de un proyecto se computa <subdomain>--<accountSlug>.<PAGES_DOMAIN>.
  PAGES_DOMAIN:      string;
  // Dominio base del alias DNS de la base de datos, ej: "db.bezenti.com".
  // Vacío hasta que exista el wildcard DNS (Fase B) — fallback: IP del node.
  DB_DOMAIN:         string;
};
