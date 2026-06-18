import type { Locale } from "../i18n/config";

/**
 * Datos de contacto directo de Bezenti. Centralizados aquí para reutilizarlos en
 * el botón flotante de WhatsApp, la página de contacto y el footer.
 *
 * ⚠️ SUSTITUYE estos valores por los REALES antes de publicar:
 *   - `whatsapp`: número en formato internacional SIN signos ni espacios
 *     (lo exige la API de wa.me). Ej. Perú: 51987654321.
 *   - `phoneDisplay`: cómo se muestra al usuario (con formato legible).
 *   - `email`: buzón de contacto (ya existe contact@bezenti.com en el Worker).
 */
export const contact = {
  /** Número de WhatsApp en formato wa.me (solo dígitos, con prefijo de país). */
  whatsapp: "51936854713",
  /** Teléfono visible (formato legible). */
  phoneDisplay: "+51 936 854 713",
  /** Correo de contacto. */
  email: "contact@bezenti.com",
} as const;

/** Mensaje precargado para abrir WhatsApp con contexto, por idioma. */
const waGreeting: Record<Locale, string> = {
  es: "Hola Bezenti, me gustaría información sobre un proyecto.",
  en: "Hi Bezenti, I'd like information about a project.",
};

/** Enlace wa.me con saludo precargado (URL-encoded). */
export function whatsappHref(locale: Locale): string {
  return `https://wa.me/${contact.whatsapp}?text=${encodeURIComponent(waGreeting[locale])}`;
}

/** Enlace mailto con asunto precargado. */
export function emailHref(locale: Locale): string {
  const subject = locale === "es" ? "Consulta sobre un proyecto" : "Project enquiry";
  return `mailto:${contact.email}?subject=${encodeURIComponent(subject)}`;
}
