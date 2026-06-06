import { createFileRoute } from "@tanstack/react-router";
import { Counter } from "@repo/ui";

export const Route = createFileRoute("/")({
  component: DashboardHome,
});

function DashboardHome() {
  return (
    <section className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Panel de control
        </h1>
        <p className="mt-2 text-slate-600">
          App TanStack Start en modo CSR (SPA) usando los componentes de{" "}
          <code className="rounded bg-slate-200 px-1.5 py-0.5 text-sm">
            @repo/ui
          </code>
          .
        </p>
      </div>

      {/* Mismo <Counter> de @repo/ui que la web Astro, aquí con React. */}
      <Counter title="Contador (React)" />
    </section>
  );
}
