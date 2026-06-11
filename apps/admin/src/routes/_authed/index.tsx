import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { authClient } from "../../lib/auth";

export const Route = createFileRoute("/_authed/")({
  component: AdminDashboard,
});

const stats = [
  { label: "Nodes activos", value: "0", href: "/_authed/nodes/" },
  { label: "Clientes", value: "0", href: "/_authed/clients/" },
  { label: "Planes", value: "0", href: "/_authed/plans/" },
  { label: "Dominios", value: "0", href: "#" },
];

function AdminDashboard() {
  return (
    <AdminLayout>
      <div className="space-y-6">
        <h1 className="text-xl font-semibold text-gray-900">Dashboard</h1>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {stats.map((s) => (
            <Link key={s.label} to={s.href as never}
              className="bg-white border border-gray-200 rounded-xl p-5 hover:border-blue-300 transition-colors">
              <p className="text-2xl font-bold text-gray-900">{s.value}</p>
              <p className="text-sm text-gray-500 mt-1">{s.label}</p>
            </Link>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    authClient.getSession().then(({ data }) => {
      setUserEmail(data?.user.email ?? null);
    });
  }, []);

  const nav = [
    { label: "Dashboard", to: "/_authed/" },
    { label: "Nodes",     to: "/_authed/nodes/" },
    { label: "Clientes",  to: "/_authed/clients/" },
    { label: "Planes",    to: "/_authed/plans/" },
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
          <span className="ml-2 text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">admin</span>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          {nav.map((item) => (
            <Link key={item.to} to={item.to as never}
              className="block px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 [&.active]:bg-blue-50 [&.active]:text-blue-700 [&.active]:font-medium">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-gray-200 space-y-1">
          {userEmail && <p className="px-3 py-1 text-xs text-gray-400 truncate">{userEmail}</p>}
          <button onClick={handleSignOut}
            className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50">
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
