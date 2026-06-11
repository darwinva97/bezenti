import { createFileRoute } from "@tanstack/react-router";
import { PortalLayout } from "../index";

export const Route = createFileRoute("/_authed/files/")({
  component: FilesPage,
});

function FilesPage() {
  return (
    <PortalLayout>
      <div className="space-y-6">
        <h1 className="text-xl font-semibold text-gray-900">Archivos</h1>

        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
          <h2 className="text-sm font-medium text-gray-900">Acceso SFTP</h2>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Host" value="—" />
            <Field label="Puerto" value="22" />
            <Field label="Usuario" value="—" />
            <Field label="Contraseña" value="••••••••" masked />
          </div>

          <div className="pt-2 border-t border-gray-100">
            <p className="text-sm font-medium text-gray-700 mb-1">Directorio raíz</p>
            <code className="text-sm font-mono text-gray-800 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-lg block">
              /public
            </code>
            <p className="text-xs text-gray-400 mt-1">
              Sube tus archivos PHP aquí. El servidor web apunta a este directorio.
            </p>
          </div>

          <button className="text-sm text-blue-600 hover:text-blue-700 border border-blue-200 rounded-lg px-4 py-1.5 hover:bg-blue-50 transition-colors">
            Cambiar contraseña SFTP
          </button>
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 text-sm space-y-2">
          <p className="font-medium text-gray-800">Clientes SFTP recomendados</p>
          <ul className="text-gray-600 space-y-1">
            <li>• FileZilla (Windows, Mac, Linux) — gratuito</li>
            <li>• Cyberduck (Mac) — gratuito</li>
            <li>• WinSCP (Windows) — gratuito</li>
          </ul>
        </div>
      </div>
    </PortalLayout>
  );
}

function Field({ label, value, masked }: { label: string; value: string; masked?: boolean }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-sm font-mono text-gray-800 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-lg">
          {value}
        </code>
        {!masked && (
          <button
            className="text-xs text-gray-400 hover:text-gray-600"
            onClick={() => navigator.clipboard.writeText(value)}
          >
            copiar
          </button>
        )}
      </div>
    </div>
  );
}
