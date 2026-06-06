import { defaultLocale, isLocale, locales, type Locale } from "./config";
import { routes, type RouteKey } from "./routes";
import { ui, type UIKey } from "./ui";

/** Devuelve una función de traducción `t("nav.home")` para el idioma dado. */
export function useTranslations(locale: Locale) {
  return function t(key: UIKey): string {
    return ui[locale][key] ?? ui[defaultLocale][key];
  };
}

/**
 * Construye la URL de una página (por su clave) en un idioma concreto.
 * TODOS los idiomas llevan prefijo (opción B), incluido el por defecto.
 *   getPath("es", "cart")  -> "/es/carrito"
 *   getPath("en", "cart")  -> "/en/cart"
 *   getPath("es", "home")  -> "/es"
 * La raíz "/" no es una página: el Worker la redirige al idioma detectado.
 */
export function getPath(locale: Locale, key: RouteKey): string {
  const slug = routes[locale][key];
  const path = [locale, slug].filter(Boolean).join("/");
  return `/${path}`;
}

/** Extrae el idioma de una URL a partir de su primer segmento. */
export function getLocaleFromUrl(url: URL): Locale {
  const [, first] = url.pathname.split("/");
  if (first && isLocale(first)) return first;
  return defaultLocale;
}

/** Lista de idiomas alternativos con su URL para una misma página. */
export function getAlternateLinks(key: RouteKey) {
  return locales.map((locale) => ({
    locale,
    href: getPath(locale, key),
  }));
}

export { locales, defaultLocale };
export type { Locale, RouteKey };
