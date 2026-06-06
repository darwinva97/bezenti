import { getCollection } from "astro:content";
import type { Locale } from "../i18n/config";
import { useTranslations } from "../i18n/utils";
import { serviceHref, projectHref, postHref } from "./urls";
import type { ProjectCategoryKey } from "../i18n/categories";

export interface SearchDoc {
  title: string;
  description: string;
  /** Etiqueta de tipo legible (Servicio/Proyecto/Artículo). */
  type: string;
  url: string;
}

/**
 * Índice de búsqueda estático para un idioma: todo el contenido publicado
 * (servicios + proyectos + posts) reducido a {title, description, type, url}.
 * Se sirve como JSON precompilado por los endpoints /<locale>/search.json y lo
 * consume el buscador del header en el cliente (sin dependencias externas).
 */
export async function buildSearchIndex(locale: Locale): Promise<SearchDoc[]> {
  const t = useTranslations(locale);
  const [services, projects, posts] = await Promise.all([
    getCollection("services"),
    getCollection("projects"),
    getCollection("posts"),
  ]);

  const docs: SearchDoc[] = [];

  for (const s of services) {
    if (s.data.locale !== locale || s.data.draft) continue;
    docs.push({
      title: s.data.title,
      description: s.data.teaser ?? s.data.description,
      type: t("type.service"),
      url: serviceHref(locale, s.data.slug),
    });
  }

  for (const p of projects) {
    if (p.data.locale !== locale || p.data.draft) continue;
    docs.push({
      title: p.data.title,
      description: p.data.description,
      type: t("type.project"),
      url: projectHref(locale, p.data.category as ProjectCategoryKey, p.data.slug),
    });
  }

  for (const a of posts) {
    if (a.data.locale !== locale || a.data.draft) continue;
    docs.push({
      title: a.data.title,
      description: a.data.description,
      type: t("type.post"),
      url: postHref(locale, a.data.slug),
    });
  }

  return docs;
}
