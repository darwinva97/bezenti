import { createFileRoute } from "@tanstack/react-router";
import { PortalLayout } from "../index";

export const Route = createFileRoute("/_authed/portal/databases/")({
  component: DatabasesPage,
});

function DatabasesPage() {
  return (
    <PortalLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">Bases de datos</h1>
          <button className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
            + Nueva base de datos
          </button>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Nombre</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Usuario</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Tamaño</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                  Aún no tienes bases de datos
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-medium text-gray-900">Datos de conexión</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-gray-500 mb-1">Host</p>
              <code className="font-mono text-gray-800">127.0.0.1</code>
            </div>
            <div>
              <p className="text-gray-500 mb-1">Puerto</p>
              <code className="font-mono text-gray-800">3306</code>
            </div>
          </div>
          <p className="text-xs text-gray-400">La conexión es local al servidor. Usa phpMyAdmin para acceso web.</p>
        </div>
      </div>
    </PortalLayout>
  );
}
