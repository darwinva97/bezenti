import { defineConfig } from "drizzle-kit";

// drizzle-kit usa este archivo para generar migraciones y correr studio.
// Apunta al archivo SQLite que wrangler crea automáticamente al correr
// `wrangler dev` con un binding D1 configurado.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    // wrangler dev crea este archivo cuando tiene un binding D1
    url: "../../.wrangler/state/v3/d1/miniflare-D1DatabaseObject/<DB_ID>.sqlite",
  },
});
