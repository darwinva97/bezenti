import { getCollection } from "astro:content";
import type { Locale } from "../i18n/config";
import type { TopicKey } from "../i18n/topics";
import type { ProjectCategoryKey } from "../i18n/categories";
import { serviceHref, projectHref, postHref } from "./urls";

export type ContentType = "service" | "project" | "post";

export interface RelatedItem {
  type: ContentType;
  title: string;
  description: string;
  href: string;
  image?: string;
  cardImage?: string;
  imageAlt?: string;
  overlap: number;
}

/**
 * Contenido relacionado por topics compartidos, mezclando servicios, proyectos
 * y posts del MISMO idioma. Ordena por nº de topics en común y excluye la
 * propia entrada.
 */
export async function getRelated(opts: {
  locale: Locale;
  topics: TopicKey[];
  exclude: { type: ContentType; id: string };
  limit?: number;
}): Promise<RelatedItem[]> {
  const { locale, topics, exclude, limit = 6 } = opts;
  if (topics.length === 0) return [];
  const want = new Set<string>(topics);

  const [services, projects, posts] = await Promise.all([
    getCollection("services"),
    getCollection("projects"),
    getCollection("posts"),
  ]);

  const items: RelatedItem[] = [];
  const overlapOf = (t: string[]) => t.filter((x) => want.has(x)).length;

  for (const s of services) {
    if (s.data.locale !== locale || s.data.draft) continue;
    if (exclude.type === "service" && s.id === exclude.id) continue;
    const overlap = overlapOf(s.data.topics);
    if (overlap > 0)
      items.push({ type: "service", title: s.data.title, description: s.data.description, href: serviceHref(locale, s.data.slug), image: s.data.image, cardImage: s.data.cardImage, imageAlt: s.data.imageAlt, overlap });
  }
  for (const p of projects) {
    if (p.data.locale !== locale || p.data.draft) continue;
    if (exclude.type === "project" && p.id === exclude.id) continue;
    const overlap = overlapOf(p.data.topics);
    if (overlap > 0)
      items.push({ type: "project", title: p.data.title, description: p.data.description, href: projectHref(locale, p.data.category as ProjectCategoryKey, p.data.slug), image: p.data.image, cardImage: p.data.cardImage, imageAlt: p.data.imageAlt, overlap });
  }
  for (const a of posts) {
    if (a.data.locale !== locale || a.data.draft) continue;
    if (exclude.type === "post" && a.id === exclude.id) continue;
    const overlap = overlapOf(a.data.topics);
    if (overlap > 0)
      items.push({ type: "post", title: a.data.title, description: a.data.description, href: postHref(locale, a.data.slug), image: a.data.image, cardImage: a.data.cardImage, imageAlt: a.data.imageAlt, overlap });
  }

  return items.sort((a, b) => b.overlap - a.overlap).slice(0, limit);
}

/**
 * Relacionados de UN tipo (proyecto o post) por CATEGORÍA + TAGS. Puntúa la
 * coincidencia de categoría (peso fuerte) más los topics en común, de modo que
 * desde un servicio se vean primero los casos/artículos de su misma familia y,
 * dentro de ella, los que más temas comparten. Excluye por `key` (grupo de
 * traducción) para no repetir la propia entrada en su otro idioma.
 */
async function relatedOfType(
  type: "project" | "post",
  opts: {
    locale: Locale;
    category?: string;
    topics: TopicKey[];
    excludeKey?: string;
    limit?: number;
  },
): Promise<RelatedItem[]> {
  const { locale, category, topics, excludeKey, limit = 3 } = opts;
  const want = new Set<string>(topics);
  const entries = await getCollection(type === "project" ? "projects" : "posts");

  const scored: (RelatedItem & { score: number })[] = [];
  for (const e of entries) {
    if (e.data.locale !== locale || e.data.draft) continue;
    if (excludeKey && e.data.key === excludeKey) continue;
    const overlap = (e.data.topics as string[]).filter((x) => want.has(x)).length;
    const catMatch = category && e.data.category === category ? 1 : 0;
    const score = catMatch * 3 + overlap;
    if (score <= 0) continue;
    const href =
      type === "project"
        ? projectHref(locale, e.data.category as ProjectCategoryKey, e.data.slug)
        : postHref(locale, e.data.slug);
    scored.push({
      type,
      title: e.data.title,
      description: e.data.description,
      href,
      image: e.data.image,
      cardImage: e.data.cardImage,
      imageAlt: e.data.imageAlt,
      overlap: score,
      score,
    });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

export const getRelatedProjects = (opts: {
  locale: Locale;
  category?: string;
  topics: TopicKey[];
  excludeKey?: string;
  limit?: number;
}) => relatedOfType("project", opts);

export const getRelatedPosts = (opts: {
  locale: Locale;
  category?: string;
  topics: TopicKey[];
  excludeKey?: string;
  limit?: number;
}) => relatedOfType("post", opts);
