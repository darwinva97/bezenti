import type { Locale } from "../i18n/config";

export interface FaqItem {
  q: Record<Locale, string>;
  a: Record<Locale, string>;
}

/**
 * Preguntas frecuentes: rebaten las objeciones típicas antes de que frenen el
 * contacto, y alimentan el rich snippet de FAQ en Google (JSON-LD FAQPage).
 *
 * ⚠️ Revisa que cada respuesta refleje tu operativa real (plazos, garantías,
 * formas de pago) antes de publicar.
 */
export const faqs: FaqItem[] = [
  {
    q: {
      es: "¿Cuánto cuesta una web o una tienda online?",
      en: "How much does a website or online store cost?",
    },
    a: {
      es: "Una web profesional arranca desde 390 USD y una tienda online desde 890 USD. El precio final depende del alcance; tras una breve charla te enviamos un presupuesto cerrado y sin compromiso en menos de 24 h.",
      en: "A professional website starts from $390 and an online store from $890. The final price depends on scope; after a short chat we send a fixed, no-obligation quote within 24 h.",
    },
  },
  {
    q: {
      es: "¿Cuánto tarda el proyecto?",
      en: "How long does a project take?",
    },
    a: {
      es: "Una web esencial suele estar lista en 2–3 semanas y una tienda online en 4–6, según el contenido y las funcionalidades. Te damos un calendario claro antes de empezar.",
      en: "An essential website is usually ready in 2–3 weeks and an online store in 4–6, depending on content and features. We give you a clear timeline before starting.",
    },
  },
  {
    q: {
      es: "¿Quién se encarga del hosting, el dominio y el correo?",
      en: "Who handles hosting, domain and email?",
    },
    a: {
      es: "Nosotros. Al ser una agencia de principio a fin, gestionamos dominio, hosting y correo profesional con tu marca. Un único interlocutor para todo, sin saltar de proveedor en proveedor.",
      en: "We do. As an end-to-end agency we manage domain, hosting and branded professional email. A single point of contact for everything — no jumping between vendors.",
    },
  },
  {
    q: {
      es: "¿Podré actualizar la web yo mismo?",
      en: "Will I be able to update the site myself?",
    },
    a: {
      es: "Sí. Entregamos webs fáciles de gestionar y te formamos para que puedas editar textos, productos e imágenes. Y si prefieres delegarlo, ofrecemos mantenimiento mensual.",
      en: "Yes. We deliver sites that are easy to manage and train you to edit text, products and images. And if you prefer to delegate it, we offer monthly maintenance.",
    },
  },
  {
    q: {
      es: "¿Trabajan con negocios fuera de su país?",
      en: "Do you work with businesses outside your country?",
    },
    a: {
      es: "Sí. Operamos en Perú, Argentina, México y Chile, y trabajamos en remoto con clientes de toda Latinoamérica y España, en tu idioma y tu horario.",
      en: "Yes. We operate in Peru, Argentina, Mexico and Chile, and work remotely with clients across Latin America and Spain, in your language and time zone.",
    },
  },
];
