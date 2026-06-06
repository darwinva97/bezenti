import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import preact from "@astrojs/preact";

// El routing i18n lo gestionamos manualmente (rutas con slugs traducidos:
// /carrito vs /cart), por eso NO usamos la opción `i18n` integrada de Astro,
// que solo permite prefijos de idioma con el mismo nombre de segmento.
//
// Esta app renderiza con PREACT. `compat: true` activa los alias
// `react`/`react-dom` -> `preact/compat`, de modo que los componentes de
// `@repo/ui` (escritos contra la API de React, agnósticos del motor) se
// renderizan con Preact sin cambios. Sin directiva `client:*` salen como HTML
// estático; con `client:load`/`client:visible` se hidratan con Preact (~4 kB).
export default defineConfig({
  site: "https://bezenti.com",
  integrations: [preact({ compat: true })],
  vite: {
    plugins: [tailwindcss()],
    // Workaround: `@astrojs/preact` fuerza el pre-bundle (esbuild) de
    // `server.js`, que importa el módulo virtual `astro:preact:opts`. El
    // optimizador no lo resuelve y el build estático falla. Lo marcamos como
    // EXTERNO solo en el optimizador: esbuild deja el import intacto y luego lo
    // resuelve el propio plugin de la integración en el pipeline de Vite/Rollup.
    optimizeDeps: {
      esbuildOptions: {
        plugins: [
          {
            name: "astro-preact-opts-external",
            setup(build) {
              build.onResolve({ filter: /^astro:preact:opts$/ }, () => ({
                path: "astro:preact:opts",
                external: true,
              }));
            },
          },
        ],
      },
    },
  },
});
