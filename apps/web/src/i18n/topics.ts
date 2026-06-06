import type { Locale } from "./config";

/**
 * "Topics" = etiquetas controladas, transversales a TODO el contenido
 * (servicios, proyectos y posts). Son el mecanismo para relacionarlos entre sí
 * y para generar páginas de archivo (/es/temas/wordpress). A diferencia de las
 * `projectCategories` (taxonomía exclusiva del portafolio), un mismo topic
 * puede aplicarse a un servicio, un proyecto y un artículo.
 */
export const topics = [
  { key: "wordpress", slug: { es: "wordpress", en: "wordpress" }, name: { es: "WordPress", en: "WordPress" } },
  { key: "shopify", slug: { es: "shopify", en: "shopify" }, name: { es: "Shopify", en: "Shopify" } },
  { key: "ecommerce", slug: { es: "ecommerce", en: "ecommerce" }, name: { es: "Ecommerce", en: "Ecommerce" } },
  { key: "seo", slug: { es: "seo", en: "seo" }, name: { es: "SEO", en: "SEO" } },
  { key: "performance", slug: { es: "rendimiento", en: "performance" }, name: { es: "Rendimiento", en: "Performance" } },
  { key: "marketing", slug: { es: "marketing", en: "marketing" }, name: { es: "Marketing", en: "Marketing" } },
  { key: "automation", slug: { es: "automatizacion", en: "automation" }, name: { es: "Automatización", en: "Automation" } },
  { key: "bots", slug: { es: "bots", en: "bots" }, name: { es: "Bots", en: "Bots" } },
  { key: "hosting", slug: { es: "hosting", en: "hosting" }, name: { es: "Hosting", en: "Hosting" } },
  { key: "email", slug: { es: "correo", en: "email" }, name: { es: "Correo", en: "Email" } },
  { key: "domains", slug: { es: "dominios", en: "domains" }, name: { es: "Dominios", en: "Domains" } },
  { key: "systems", slug: { es: "sistemas", en: "systems" }, name: { es: "Sistemas", en: "Systems" } },
] as const;

export type TopicKey = (typeof topics)[number]["key"];

export const topicKeys = topics.map((t) => t.key) as [TopicKey, ...TopicKey[]];

const byKey = new Map(topics.map((t) => [t.key, t]));

export function getTopic(key: TopicKey) {
  const t = byKey.get(key);
  if (!t) throw new Error(`Topic desconocido: ${key}`);
  return t;
}

export function topicName(locale: Locale, key: TopicKey): string {
  return getTopic(key).name[locale];
}

export function topicSlug(locale: Locale, key: TopicKey): string {
  return getTopic(key).slug[locale];
}
