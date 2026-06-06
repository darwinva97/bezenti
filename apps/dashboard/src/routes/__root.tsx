import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import type { ReactNode } from "react";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Bezenti · Dashboard" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
  component: AppLayout,
});

/** Shell HTML que se prerenderiza una vez; el resto vive en el cliente. */
function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className="h-full">
      <head>
        <HeadContent />
      </head>
      <body className="flex min-h-full flex-col bg-slate-50 text-slate-800 antialiased">
        {children}
        <TanStackRouterDevtools position="bottom-right" />
        <Scripts />
      </body>
    </html>
  );
}

const navLink =
  "rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900";
const navLinkActive = "bg-brand-50 text-brand-700 hover:bg-brand-50 hover:text-brand-700";

/** Layout de la app (cabecera + contenido enrutado). */
function AppLayout() {
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <nav className="mx-auto flex w-full max-w-5xl items-center gap-6 px-4 py-3">
          <Link to="/" className="flex items-baseline gap-2">
            <span className="text-lg font-bold tracking-tight text-slate-900">
              Bezenti
            </span>
            <span className="hidden text-xs font-medium text-slate-400 sm:inline">
              Dashboard
            </span>
          </Link>
          <div className="flex items-center gap-1">
            <Link
              to="/"
              className={navLink}
              activeProps={{ className: `${navLink} ${navLinkActive}` }}
              activeOptions={{ exact: true }}
            >
              Panel
            </Link>
            <Link
              to="/products"
              className={navLink}
              activeProps={{ className: `${navLink} ${navLinkActive}` }}
            >
              Productos
            </Link>
          </div>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <Outlet />
      </main>
    </>
  );
}
