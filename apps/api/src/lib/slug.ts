// Reglas de slug para subdominios Bezenti.
// El host de un proyecto es UNA sola etiqueta DNS: <subdomain>--<accountSlug>,
// así que "--" queda reservado como separador y la suma debe caber en 63 chars.

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function isValidSlug(s: string): boolean {
  return SLUG_RE.test(s) && !s.includes("--");
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // tildes/diacríticos
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function computeProjectHost(subdomain: string, accountSlug: string, pagesDomain: string): string {
  return `${subdomain}--${accountSlug}.${pagesDomain}`;
}

// La etiqueta combinada <subdomain>--<accountSlug> no puede exceder 63 chars (límite DNS)
export function fitsDnsLabel(subdomain: string, accountSlug: string): boolean {
  return subdomain.length + 2 + accountSlug.length <= 63;
}

export function randomSlugSuffix(len = 4): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}
