import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
import { locales } from "./i18n/config";
import { categoryKeys } from "./i18n/categories";
import { topicKeys } from "./i18n/topics";

// id estable y único que incluye la carpeta de idioma (es/foo vs en/foo). Sin
// esto, dos archivos con el mismo nombre en es/ y en/ colisionarían y uno
// sobreescribiría al otro en el store de contenido.
const idFromPath = ({ entry }: { entry: string }) =>
  entry.replace(/\.(md|mdx)$/, "");

const localeEnum = z.enum(locales as unknown as [string, ...string[]]);
const categoryEnum = z.enum(categoryKeys);
const topicEnum = z.enum(topicKeys);

/** Campos comunes a todo el contenido i18n. */
const i18nBase = {
  /** Idioma de esta entrada. */
  locale: localeEnum,
  /** Grupo de traducción: une la versión es/en del mismo recurso (hreflang). */
  key: z.string(),
  /** Slug localizado que aparece en la URL. */
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  /** Etiquetas transversales: relacionan servicios ↔ proyectos ↔ posts. */
  topics: z.array(topicEnum).default([]),
  /**
   * Categoría (grupo comercial). Spine global compartido por servicios,
   * proyectos y posts. Opcional aquí; los proyectos la redefinen como requerida.
   */
  category: categoryEnum.optional(),
  /**
   * Imagen de PORTADA (apaisada). Se usa a sangre completa en el hero de la
   * página de detalle y en los destacados/lead. Ruta del sitio,
   * p. ej. /images/services/seo.jpg.
   */
  image: z.string().optional(),
  /**
   * Imagen CUADRADA para tarjetas (rejillas de proyectos/posts/servicios y
   * contenido relacionado). Convención: la misma ruta que `image` con sufijo
   * `-card` (p. ej. /images/services/seo-card.jpg).
   */
  cardImage: z.string().optional(),
  /** Texto alternativo de `image`/`cardImage` (accesibilidad y SEO). */
  imageAlt: z.string().optional(),
  /** Imagen OpenGraph. Si falta, se usa `image` y, en su defecto, la global. */
  ogImage: z.string().optional(),
  draft: z.boolean().default(false),
};

/** Una imagen de galería con su texto alternativo y pie opcional. */
const galleryImage = z.object({
  src: z.string(),
  alt: z.string(),
  caption: z.string().optional(),
});

/** Servicios: landing PLANA por keyword (/es/diseno-web). */
const services = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/services", generateId: idFromPath }),
  schema: z.object({
    ...i18nBase,
    /** Orden en el índice de servicios. */
    order: z.number().default(0),
    /** Resumen corto para tarjetas. */
    teaser: z.string().optional(),
  }),
});

/** Proyectos: portafolio ANIDADO por categoría (/es/proyectos/web/omegastore). */
const projects = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/projects", generateId: idFromPath }),
  schema: z.object({
    ...i18nBase,
    category: categoryEnum,
    client: z.string().optional(),
    year: z.number().optional(),
    /** URL del sitio en vivo (proyectos importados), para el botón "Ver sitio". */
    url: z.string().url().optional(),
    /** Servicios aplicados (keys de la colección services), para enlazar. */
    services: z.array(z.string()).default([]),
    featured: z.boolean().default(false),
    /** Galería del caso: cada imagen con alt y pie opcional. */
    gallery: z.array(galleryImage).default([]),
  }),
});

/** Blog: artículos planos bajo /blog. */
const posts = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/posts", generateId: idFromPath }),
  schema: z.object({
    ...i18nBase,
    pubDate: z.coerce.date(),
    author: z.string().default("Bezenti"),
  }),
});

export const collections = { services, projects, posts };
