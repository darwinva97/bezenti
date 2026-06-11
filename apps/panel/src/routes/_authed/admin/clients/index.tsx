import { createFileRoute } from "@tanstack/react-router";
import { AdminLayout } from "../index";

export const Route = createFileRoute("/_authed/admin/clients/")({
  component: ClientsPage,
});

function ClientsPage() {
  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">Clientes</h1>
          <button className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
            + Nuevo cliente
          </button>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Cliente</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Plan</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Node</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Disco</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-100 last:border-0">
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  Aún no hay clientes registrados
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  );
}
