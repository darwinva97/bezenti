import type { APIRoute } from "astro";
import { buildSearchIndex } from "../../lib/searchIndex";

/** Índice de búsqueda en español, precompilado a /es/search.json. */
export const GET: APIRoute = async () => {
  const docs = await buildSearchIndex("es");
  return new Response(JSON.stringify(docs), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
