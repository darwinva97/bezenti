import { createFileRoute } from "@tanstack/react-router";
import { AdminLayout } from "../index";

export const Route = createFileRoute("/_authed/plans/")({
  component: PlansPage,
});

function PlansPage() {
  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">Planes</h1>
          <button className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
            + Nuevo plan
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <PlanCard
            name="Starter"
            price="—"
            limits={[
              "2 GB disco",
              "1 dominio",
              "1 base de datos",
              "PHP 8.3",
              "128 MB memory_limit",
              "3 workers PHP",
            ]}
          />
          <PlanCard
            name="Pro"
            price="—"
            limits={[
              "10 GB disco",
              "5 dominios",
              "5 bases de datos",
              "PHP 8.1 / 8.2 / 8.3",
              "256 MB memory_limit",
              "8 workers PHP",
            ]}
          />
          <PlanCard
            name="Business"
            price="—"
            limits={[
              "30 GB disco",
              "20 dominios",
              "20 bases de datos",
              "PHP 8.1 / 8.2 / 8.3",
              "512 MB memory_limit",
              "15 workers PHP",
            ]}
          />
        </div>
      </div>
    </AdminLayout>
  );
}

function PlanCard({ name, price, limits }: { name: string; price: string; limits: string[] }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">{name}</h2>
        <span className="text-sm text-gray-500">S/ {price}/mes</span>
      </div>
      <ul className="space-y-1.5">
        {limits.map((l) => (
          <li key={l} className="flex items-center gap-2 text-sm text-gray-600">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
            {l}
          </li>
        ))}
      </ul>
      <button className="w-full text-sm text-blue-600 hover:text-blue-700 border border-blue-200 rounded-lg py-1.5 hover:bg-blue-50 transition-colors">
        Editar
      </button>
    </div>
  );
}
