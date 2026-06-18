import type { Locale } from "../i18n/config";

export interface Package {
  name: Record<Locale, string>;
  /** Precio "desde" en USD (solo el número, sin símbolo). */
  priceFrom: number;
  tagline: Record<Locale, string>;
  features: Record<Locale, string[]>;
  /** Resalta el plan como el más elegido. */
  popular?: boolean;
}

/**
 * Planes de entrada con precio "desde". Mostrar un punto de partida elimina la
 * fricción de "¿me lo puedo permitir?" y filtra leads fuera de presupuesto.
 *
 * ⚠️ PRECIOS DE EJEMPLO. Ajústalos a tu estructura real de costes antes de
 * publicar. El "desde" debe ser un precio real al que de verdad arranques.
 */
export const packages: Package[] = [
  {
    name: { es: "Web esencial", en: "Essential website" },
    priceFrom: 390,
    tagline: {
      es: "Para presentar tu negocio con una web rápida y profesional.",
      en: "Present your business with a fast, professional website.",
    },
    features: {
      es: [
        "Web de hasta 5 secciones",
        "Diseño a medida y responsive",
        "Formulario de contacto + WhatsApp",
        "SEO básico y alta en Google",
        "Hosting y dominio el primer año",
      ],
      en: [
        "Up to 5-section website",
        "Custom, responsive design",
        "Contact form + WhatsApp",
        "Basic SEO and Google indexing",
        "Hosting and domain for the first year",
      ],
    },
  },
  {
    name: { es: "Tienda online", en: "Online store" },
    priceFrom: 890,
    popular: true,
    tagline: {
      es: "Empieza a vender online con catálogo, carrito y pagos.",
      en: "Start selling online with catalog, cart and payments.",
    },
    features: {
      es: [
        "Tienda WooCommerce o Shopify",
        "Catálogo y pasarela de pagos",
        "Fichas de producto optimizadas",
        "Envíos y stock configurados",
        "Formación para gestionarla tú",
      ],
      en: [
        "WooCommerce or Shopify store",
        "Catalog and payment gateway",
        "Optimized product pages",
        "Shipping and stock configured",
        "Training so you can run it",
      ],
    },
  },
  {
    name: { es: "Crecimiento", en: "Growth" },
    priceFrom: 490,
    tagline: {
      es: "Marketing y automatización mensual para captar más clientes.",
      en: "Monthly marketing and automation to win more clients.",
    },
    features: {
      es: [
        "SEO y contenidos continuos",
        "Campañas en Google y Meta Ads",
        "Bots y automatizaciones",
        "Informe mensual de resultados",
        "Soporte prioritario",
      ],
      en: [
        "Ongoing SEO and content",
        "Google and Meta Ads campaigns",
        "Bots and automations",
        "Monthly results report",
        "Priority support",
      ],
    },
  },
];
