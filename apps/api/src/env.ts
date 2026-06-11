export type Env = {
  DB:                D1Database;
  ENVIRONMENT:       string;
  // better-auth
  BETTER_AUTH_URL:   string;   // URL pública del Worker, ej: https://api.bezenti.com
  BETTER_AUTH_SECRET: string;  // secret aleatorio — wrangler secret put BETTER_AUTH_SECRET
  TRUSTED_ORIGINS:   string;   // CSV: "https://panel.bezenti.com,http://localhost:3001"
  // Stalwart Mail Server
  STALWART_URL:      string;   // ej: https://mail.bezenti.com
  STALWART_TOKEN:    string;   // API token de Stalwart admin
  // URL base donde están los binarios del agente para descarga
  // ej: https://releases.bezenti.com o URL de Cloudflare R2 pública
  AGENT_BINARY_URL:  string;
};
