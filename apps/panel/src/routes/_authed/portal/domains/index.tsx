import { createFileRoute } from "@tanstack/react-router";
import { PortalLayout } from "../index";

export const Route = createFileRoute("/_authed/portal/domains/")({
  component: DomainsPage,
});

function DomainsPage() {
  return (
    <PortalLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">Dominios</h1>
          <button className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
            + Agregar dominio
          </button>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Dominio</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">SSL</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                  Aún no tienes dominios configurados
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 text-sm text-gray-600 space-y-2">
          <p className="font-medium text-gray-800">¿Cómo apuntar tu dominio?</p>
          <p>Agrega un registro CNAME en tu proveedor de DNS apuntando a:</p>
          <code className="block bg-white border border-gray-200 rounded-lg px-3 py-2 font-mono text-xs text-gray-800">
            hosting.bezenti.com
          </code>
          <p className="text-gray-500 text-xs">El SSL se activa automáticamente en minutos.</p>
        </div>
      </div>
    </PortalLayout>
  );
}
