import type { Locale } from "./config";

/**
 * Taxonomía UNIFICADA de categorías.
 *
 * Un único árbol con un discriminador `scope` en vez de cuatro taxonomías
 * paralelas. Hoy todas son `global` (el "spine comercial" del negocio: webs,
 * tiendas, marketing, automatiza, sistemas), compartido por servicios,
 * proyectos y posts. El modelo admite, sin migración, categorías propias de un
 * tipo (`scope: 'service' | 'project' | 'post'`) que opcionalmente apuntan a una
 * global vía `globalRef`, y jerarquía vía `parent`.
 *
 * `key` es estable (la referencia el frontmatter). `slug` y `name` se localizan.
 * Los slugs se conservan respecto a la taxonomía anterior del portafolio para no
 * romper URLs; los `name` adoptan la etiqueta comercial.
 */
export type CategoryScope = "global" | "service" | "project" | "post";

export interface Category {
  key: string;
  scope: CategoryScope;
  /** Categoría padre (su `key`), para jerarquía. */
  parent?: string;
  /** Si `scope` != 'global', categoría global asociada (su `key`). */
  globalRef?: string;
  slug: Record<Locale, string>;
  name: Record<Locale, string>;
  /** Orden de aparición en índices y agrupaciones. */
  order: number;
}

export const categories = [
  {
    key: "web",
    scope: "global",
    slug: { es: "web", en: "web" },
    name: { es: "Webs", en: "Websites" },
    order: 1,
  },
  {
    key: "ecommerce",
    scope: "global",
    slug: { es: "ecommerce", en: "ecommerce" },
    name: { es: "Tiendas", en: "Stores" },
    order: 2,
  },
  {
    key: "marketing",
    scope: "global",
    slug: { es: "marketing", en: "marketing" },
    name: { es: "Marketing", en: "Marketing" },
    order: 3,
  },
  {
    key: "automation",
    scope: "global",
    slug: { es: "automatizaciones", en: "automation" },
    name: { es: "Automatiza", en: "Automation" },
    order: 4,
  },
  {
    key: "systems",
    scope: "global",
    slug: { es: "sistemas", en: "systems" },
    name: { es: "Sistemas", en: "Systems" },
    order: 5,
  },
  {
    key: "servers",
    scope: "global",
    slug: { es: "servidores", en: "servers" },
    name: { es: "Servidores", en: "Servers" },
    order: 6,
  },

  // --- Hijas de "servidores" (infraestructura) ---
  {
    key: "mail-server",
    scope: "global",
    parent: "servers",
    slug: { es: "servidor-de-correo", en: "mail-server" },
    name: { es: "Servidor de correo", en: "Mail server" },
    order: 601,
  },
  {
    key: "web-hosting",
    scope: "global",
    parent: "servers",
    slug: { es: "hosting-web", en: "web-hosting" },
    name: { es: "Hosting web", en: "Web hosting" },
    order: 602,
  },
  {
    key: "domains",
    scope: "global",
    parent: "servers",
    slug: { es: "dominios", en: "domains" },
    name: { es: "Dominios", en: "Domains" },
    order: 603,
  },
  {
    key: "vps",
    scope: "global",
    parent: "servers",
    slug: { es: "vps", en: "vps" },
    name: { es: "VPS", en: "VPS" },
    order: 604,
  },
] as const satisfies readonly Category[];

export type CategoryKey = (typeof categories)[number]["key"];

/** Vista ensanchada a `Category` (con los campos opcionales parent/globalRef). */
const all: readonly Category[] = categories;

/** Todas las keys (para el enum de Zod en content.config). */
export const categoryKeys = categories.map((c) => c.key) as [
  CategoryKey,
  ...CategoryKey[],
];

const byKey = new Map<string, Category>(all.map((c) => [c.key, c]));

export function getCategory(key: CategoryKey): Category {
  const c = byKey.get(key);
  if (!c) throw new Error(`Categoría desconocida: ${key}`);
  return c;
}

export function categorySlug(locale: Locale, key: CategoryKey): string {
  return getCategory(key).slug[locale];
}

export function categoryName(locale: Locale, key: CategoryKey): string {
  return getCategory(key).name[locale];
}

/** Categorías de un `scope`, ordenadas. */
export function categoriesByScope(scope: CategoryScope): Category[] {
  return all
    .filter((c) => c.scope === scope)
    .sort((a, b) => a.order - b.order);
}

/** Hijas directas de una categoría (jerarquía). */
export function childrenOf(key: CategoryKey): Category[] {
  return all
    .filter((c) => c.parent === key)
    .sort((a, b) => a.order - b.order);
}

// --- Back-compat: el portafolio y la ruta catch-all iteran las categorías que
//     pueden tener proyectos. Hoy son las globales (el spine compartido). ---
export const projectCategories = categoriesByScope("global");
export type ProjectCategoryKey = CategoryKey;
