import type { Locale } from "./config";

/**
 * Cada SECCIÓN tiene una "clave de ruta" estable (independiente del idioma).
 * Aquí mapeamos esa clave al slug que aparece en la URL en cada idioma.
 *
 * Estas son las páginas "índice"/hub. Las páginas de contenido (servicios,
 * proyectos, artículos) NO viven aquí: salen de las Content Collections y sus
 * URLs se construyen en `src/lib/urls.ts`.
 *
 * Todos los idiomas llevan prefijo: "/en", "/es/servicios". La raíz "/" no es
 * una página: el Worker la redirige al idioma detectado (por defecto, /en).
 */
export type RouteKey = "home" | "services" | "portfolio" | "blog" | "contact";

export const routes: Record<Locale, Record<RouteKey, string>> = {
  es: {
    home: "",
    services: "servicios",
    portfolio: "proyectos",
    blog: "blog",
    contact: "contacto",
  },
  en: {
    home: "",
    services: "services",
    portfolio: "projects",
    blog: "blog",
    contact: "contact",
  },
};

/** Prefijo localizado de cada sección con hijos (para construir URLs). */
export const sectionPrefix = {
  portfolio: { es: routes.es.portfolio, en: routes.en.portfolio },
  blog: { es: routes.es.blog, en: routes.en.blog },
  topics: { es: "temas", en: "topics" },
} as const;
