import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { authClient } from "../../lib/auth";
import { apiFetch } from "../../lib/api";

export const Route = createFileRoute("/_authed/")({
  component: PortalDashboard,
});

type Usage = {
  recordedAt: number | null;
  plan: { id: string; name: string; diskMb: number } | null;
  disk: {
    usedMb: number;
    totalMb: number | null;
    breakdown: { filesMb: number; mysqlMb: number; pgMb: number; emailMb: number };
  };
  web: { used: number; max: number | null };
  databases: { used: number; max: number | null };
  email: { used: number; max: number | null; usedMb: number };
  processes: { used: number; max: number | null };
};

type Account = {
  accountSlug: string | null;
  dbHost: string | null;
  sftpHost: string | null;
  sftpUser: string | null;
  plan: { id: string; name: string } | null;
};

function fmtSize(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB`;
  return `${Math.round(mb)} MB`;
}

function pct(used: number, max: number | null): number {
  if (!max || max <= 0) return 0;
  return Math.min(100, Math.round((used / max) * 100));
}

function barColor(p: number): string {
  if (p >= 90) return "bg-red-500";
  if (p >= 75) return "bg-amber-500";
  return "bg-blue-600";
}

function PortalDashboard() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch<Usage>("/portal/metrics/usage"),
      apiFetch<Account>("/portal/account").catch(() => null),
    ])
      .then(([u, a]) => {
        setUsage(u);
        setAccount(a);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar tu hosting"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Mi hosting</h1>
          <p className="mt-1 text-sm text-gray-500">
            {usage?.plan ? `Plan ${usage.plan.name}` : "Resumen de consumo"}
            {usage?.recordedAt
              ? ` · actualizado ${new Date(usage.recordedAt).toLocaleString("es-PE")}`
              : usage && " · aún sin métricas recogidas"}
          </p>
        </div>

        {loading && <p className="text-sm text-gray-500">Cargando consumo…</p>}

        {error && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error}
          </div>
        )}

        {usage && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <UsageCard
                label="Disco usado"
                used={usage.disk.usedMb}
                max={usage.disk.totalMb}
                render={fmtSize}
                hint={`Archivos ${fmtSize(usage.disk.breakdown.filesMb)} · BD ${fmtSize(
                  usage.disk.breakdown.mysqlMb + usage.disk.breakdown.pgMb,
                )} · Correo ${fmtSize(usage.disk.breakdown.emailMb)}`}
              />
              <UsageCard label="Webs / proyectos" used={usage.web.used} max={usage.web.max} />
              <UsageCard label="Bases de datos" used={usage.databases.used} max={usage.databases.max} />
              <UsageCard
                label="Cuentas de correo"
                used={usage.email.used}
                max={usage.email.max}
                hint={`${fmtSize(usage.email.usedMb)} usados en buzones`}
              />
              <UsageCard label="Procesos PHP" used={usage.processes.used} max={usage.processes.max} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <InfoCard title="Acceso SFTP">
                <InfoRow label="Host" value={account?.sftpHost ?? "—"} />
                <InfoRow label="Puerto" value="22" />
                <InfoRow label="Usuario" value={account?.sftpUser ?? "—"} />
                <InfoRow label="Directorio" value="/public" />
              </InfoCard>

              <InfoCard title="Base de datos">
                <InfoRow label="Host" value={account?.dbHost ?? "—"} />
                <InfoRow label="Puerto" value="3306" />
                <InfoRow label="Motor" value="MariaDB / MySQL" />
                <InfoRow label="Gestión" value="phpMyAdmin" />
              </InfoCard>
            </div>
          </>
        )}
      </div>
    </PortalLayout>
  );
}

function UsageCard(props: {
  label: string;
  used: number;
  max: number | null;
  render?: (n: number) => string;
  hint?: string;
}) {
  const { label, used, max, render = (n) => String(n), hint } = props;
  const p = pct(used, max);
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-gray-500">{label}</p>
        {max !== null && <span className="text-xs text-gray-400">{p}%</span>}
      </div>
      <p className="text-xl font-semibold text-gray-900 mt-1">
        {render(used)}
        {max !== null && <span className="text-base font-normal text-gray-400"> / {render(max)}</span>}
      </p>
      {max !== null && (
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100">
          <div className={`h-full rounded-full ${barColor(p)}`} style={{ width: `${p}%` }} />
        </div>
      )}
      {hint && <p className="mt-2 text-xs text-gray-400">{hint}</p>}
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
    { label: "Correos",         to: "/email" },
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
