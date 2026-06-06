import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// App TanStack Start en modo SPA (CSR): `spa.enabled` hace que solo se
// prerenderice un "shell" HTML mínimo; toda la UI se renderiza en el cliente
// (client-side rendering) e hidrata desde ese shell. Sin SSR por ruta.
export default defineConfig({
  plugins: [
    tailwindcss(),
    tanstackStart({ spa: { enabled: true } }),
    viteReact(),
  ],
});
