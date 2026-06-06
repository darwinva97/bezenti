import type { Locale } from "../i18n/config";
import { locales } from "../i18n/config";
import { sectionPrefix } from "../i18n/routes";
import { categorySlug, type ProjectCategoryKey } from "../i18n/categories";
import { topicSlug, type TopicKey } from "../i18n/topics";

/** Servicio: PLANO bajo el idioma → /es/diseno-web */
export function serviceHref(locale: Locale, slug: string): string {
  return `/${locale}/${slug}`;
}

/** Hub de categoría de portafolio → /es/proyectos/ecommerce */
export function categoryHref(locale: Locale, cat: ProjectCategoryKey): string {
  return `/${locale}/${sectionPrefix.portfolio[locale]}/${categorySlug(locale, cat)}`;
}

/** Proyecto: ANIDADO bajo su categoría → /es/proyectos/web/omegastore */
export function projectHref(
  locale: Locale,
  cat: ProjectCategoryKey,
  slug: string,
): string {
  return `${categoryHref(locale, cat)}/${slug}`;
}

/** Artículo de blog → /es/blog/mi-articulo */
export function postHref(locale: Locale, slug: string): string {
  return `/${locale}/${sectionPrefix.blog[locale]}/${slug}`;
}

/** Archivo de un topic → /es/temas/wordpress */
export function topicHref(locale: Locale, topic: TopicKey): string {
  return `/${locale}/${sectionPrefix.topics[locale]}/${topicSlug(locale, topic)}`;
}

/**
 * Construye los enlaces hreflang para una entrada de colección, buscando en
 * `entries` las versiones del mismo `key` en cada idioma.
 * `hrefOf` devuelve la URL de una entrada concreta.
 */
export function alternatesByKey<T extends { data: { locale: string; key: string } }>(
  entries: T[],
  key: string,
  hrefOf: (entry: T) => string,
): { locale: Locale; href: string }[] {
  const out: { locale: Locale; href: string }[] = [];
  for (const locale of locales) {
    const match = entries.find((e) => e.data.key === key && e.data.locale === locale);
    if (match) out.push({ locale, href: hrefOf(match) });
  }
  return out;
}
