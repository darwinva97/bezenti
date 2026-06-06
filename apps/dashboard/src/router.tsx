import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// TanStack Start descubre este archivo por convención (src/router.tsx) y exige
// que exporte `getRouter`. El plugin genera `routeTree.gen.ts` a partir de
// src/routes/ y, en su footer, registra el tipo del router para todo el árbol.
export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
  });
}
