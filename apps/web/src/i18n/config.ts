export const locales = ["es", "en"] as const;
export type Locale = (typeof locales)[number];

// Idioma por defecto: si al entrar en "/" no se detecta preferencia, se sirve
// inglés. También es el destino del hreflang `x-default`.
export const defaultLocale: Locale = "en";

export const localeNames: Record<Locale, string> = {
  es: "Español",
  en: "English",
};

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}
