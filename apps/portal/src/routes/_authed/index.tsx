import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { authClient } from "../../lib/auth";

export const Route = createFileRoute("/_authed/")({
  component: PortalDashboard,
});

function PortalDashboard() {
  return (
    <PortalLayout>
      <div className="space-y-6">
        <h1 className="text-xl font-semibold text-gray-900">Mi hosting</h1>

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Disco usado" value="— / 2 GB" />
          <StatCard label="Dominios" value="0 / 1" />
          <StatCard label="Bases de datos" value="0 / 1" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <InfoCard title="Acceso SFTP">
            <InfoRow label="Host" value="—" />
            <InfoRow label="Puerto" value="22" />
            <InfoRow label="Usuario" value="—" />
            <InfoRow label="Directorio" value="/public" />
          </InfoCard>

          <InfoCard title="PHP">
            <InfoRow label="Versión" value="8.3" />
            <InfoRow label="memory_limit" value="128 MB" />
            <InfoRow label="upload_max_filesize" value="32 MB" />
            <InfoRow label="max_execution_time" value="30s" />
          </InfoCard>
        </div>
      </div>
    </PortalLayout>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-xl font-semibold text-gray-900 mt-1">{value}</p>
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
      <h2 className="text-sm font-medium text-gray-900">{title}</h2>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 font-mono">{value}</span>
    </div>
  );
}

export function PortalLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [userName, setUserName] = useState<string | null>(null);

  useEffect(() => {
    authClient.getSession().then(({ data }) => {
      setUserName(data?.user.name || data?.user.email || null);
    });
  }, []);

  const nav = [
    { label: "Mi hosting",      to: "/" },
    { label: "Proyectos",       to: "/projects" },
    { label: "Dominios",        to: "/domains" },
    { label: "Bases de datos",  to: "/databases" },
    { label: "Archivos",        to: "/files" },
  ];

  async function handleSignOut() {
    await authClient.signOut();
    navigate({ to: "/login" });
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-5 border-b border-gray-200">
          <span className="font-semibold text-gray-900">Bezenti</span>
          <span className="ml-2 text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
            hosting
          </span>
        </div>

        <nav className="flex-1 p-3 space-y-0.5">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to as never}
              className="block px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 [&.active]:bg-blue-50 [&.active]:text-blue-700 [&.active]:font-medium"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-200 space-y-1">
          {userName && (
            <p className="px-3 py-1 text-xs text-gray-400 truncate">
              {userName}
            </p>
          )}
          <button
            onClick={handleSignOut}
            className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50"
          >
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
