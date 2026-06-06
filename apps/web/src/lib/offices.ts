import type { Locale } from "../i18n/config";

export interface Office {
  /** Código ISO-3166 alfa-3 (coincide con los ids del mapa). */
  country: string;
  countryName: Record<Locale, string>;
  city: string;
  /** Coordenadas para situar el marcador en el mapa. */
  lat: number;
  lon: number;
}

/** Sedes de Bezenti. El mapa resalta los países presentes en esta lista. */
export const offices: Office[] = [
  { country: "PER", countryName: { es: "Perú", en: "Peru" }, city: "Lima", lat: -12.046, lon: -77.043 },
  { country: "PER", countryName: { es: "Perú", en: "Peru" }, city: "Arequipa", lat: -16.409, lon: -71.537 },
  { country: "ARG", countryName: { es: "Argentina", en: "Argentina" }, city: "Buenos Aires", lat: -34.604, lon: -58.382 },
  { country: "MEX", countryName: { es: "México", en: "Mexico" }, city: "Ciudad de México", lat: 19.433, lon: -99.133 },
  { country: "CHL", countryName: { es: "Chile", en: "Chile" }, city: "Santiago", lat: -33.45, lon: -70.66 },
];

/** Países (ISO-3) con al menos una sede. */
export const officeCountries = [...new Set(offices.map((o) => o.country))];

// --- Proyección equirectangular sobre un lienzo de 1000×500 (debe coincidir
//     con el generador del mapa) ---
export const WORLD_W = 1000;
export const WORLD_H = 500;
/** viewBox recortado a Latinoamérica (México hacia el sur), donde están las sedes. */
export const MAP_VIEWBOX = "150 165 250 200";

export function project(lon: number, lat: number): { x: number; y: number } {
  return {
    x: ((lon + 180) / 360) * WORLD_W,
    y: ((90 - lat) / 180) * WORLD_H,
  };
}

/** Agrupa las sedes por país conservando el orden de aparición. */
export function officesByCountry(): { country: string; name: Record<Locale, string>; cities: Office[] }[] {
  const groups: { country: string; name: Record<Locale, string>; cities: Office[] }[] = [];
  for (const o of offices) {
    let g = groups.find((x) => x.country === o.country);
    if (!g) {
      g = { country: o.country, name: o.countryName, cities: [] };
      groups.push(g);
    }
    g.cities.push(o);
  }
  return groups;
}
