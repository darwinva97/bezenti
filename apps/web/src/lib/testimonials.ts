import type { Locale } from "../i18n/config";

export interface Testimonial {
  /** Cita del cliente. */
  quote: Record<Locale, string>;
  /** Nombre de la persona. */
  author: string;
  /** Cargo + empresa. */
  role: Record<Locale, string>;
}

/**
 * Testimonios de clientes. La prueba social es el factor #1 de conversión para
 * una agencia: un visitante contrata por confianza.
 *
 * ⚠️ CONTENIDO DE EJEMPLO. Sustitúyelo por testimonios REALES con permiso del
 * cliente (nombre, cargo y empresa verdaderos). Lo ideal: pídelos por WhatsApp
 * tras entregar cada proyecto. Mantén entre 3 y 6.
 */
export const testimonials: Testimonial[] = [
  {
    quote: {
      es: "Pasamos de no vender online a facturar todas las semanas. El equipo se encargó de todo: tienda, pagos y posicionamiento.",
      en: "We went from no online sales to revenue every week. The team handled everything: store, payments and ranking.",
    },
    author: "María Fernández",
    role: {
      es: "Fundadora · Café Artesanal",
      en: "Founder · Café Artesanal",
    },
  },
  {
    quote: {
      es: "Por fin un solo interlocutor para web, hosting y marketing. Responden rápido y entienden el negocio, no solo la parte técnica.",
      en: "Finally a single point of contact for web, hosting and marketing. Fast replies and they get the business, not just the tech.",
    },
    author: "Diego Salinas",
    role: {
      es: "Director · Estudio de Abogados Lima",
      en: "Director · Estudio de Abogados Lima",
    },
  },
  {
    quote: {
      es: "La web nueva nos trajo reservas desde el primer mes. Cuidaron cada detalle del diseño y la velocidad de carga.",
      en: "The new site brought bookings from the first month. They cared about every design detail and load speed.",
    },
    author: "Lucía Ramos",
    role: {
      es: "Gerente · Hotel Boutique",
      en: "Manager · Hotel Boutique",
    },
  },
];
