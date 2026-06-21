import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { PortalLayout } from "../index";

const API = import.meta.env["VITE_API_URL"] ?? "http://localhost:8787";

export const Route = createFileRoute("/_authed/databases/")({
  component: DatabasesPage,
});

type Database = {
  id: string;
  dbName: string;
  dbUser: string;
  engine: string;
  projectId: string | null;
  createdAt: number;
};

type Account = { dbHost: string | null };

type CreatedDb = { id: string; dbName: string; dbUser: string; password: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? `Error ${res.status}`);
  return data as T;
}

function DatabasesPage() {
  const [dbs, setDbs] = useState<Database[] | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<CreatedDb | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [rows, acc] = await Promise.all([
        api<Database[]>("/portal/databases"),
        api<Account>("/portal/account").catch(() => ({ dbHost: null })),
      ]);
      setDbs(rows);
      setAccount(acc);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando bases de datos");
      setDbs([]);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const res = await api<CreatedDb>("/portal/databases", {
        method: "POST",
        body: JSON.stringify({ engine: "mysql" }),
      });
      setJustCreated(res);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la base de datos");
    } finally {
      setCreating(false);
    }
  }

  async function remove(d: Database) {
    if (!confirm(`¿Eliminar la base de datos "${d.dbName}"? Se borra con todos sus datos.`)) return;
    setBusy(d.id);
    setError(null);
    try {
      await api(`/portal/databases/${d.id}`, { method: "DELETE" });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar");
    } finally {
      setBusy(null);
    }
  }

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">Bases de datos</h1>
          <button
            onClick={create}
            disabled={creating}
            className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {creating ? "Creando…" : "+ Nueva base de datos"}
          </button>
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
        )}

        {justCreated && (
          <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-2">
            <p className="text-sm font-medium text-green-800">
              ✅ Base de datos creada. Guarda la contraseña — no se vuelve a mostrar.
            </p>
            <div className="grid gap-1 text-sm">
              <Row label="Base" value={justCreated.dbName} />
              <Row label="Usuario" value={justCreated.dbUser} />
              <Row label="Contraseña" value={justCreated.password} />
            </div>
            <button onClick={() => setJustCreated(null)} className="text-xs text-green-700 hover:underline">
              Ocultar
            </button>
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Nombre</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Usuario</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Motor</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {dbs === null ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">Cargando…</td></tr>
              ) : dbs.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">Aún no tienes bases de datos</td></tr>
              ) : dbs.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-3 font-mono text-gray-800">{d.dbName}</td>
                  <td className="px-4 py-3 font-mono text-gray-600">{d.dbUser}</td>
                  <td className="px-4 py-3 text-gray-600 capitalize">{d.engine}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => remove(d)}
                      disabled={busy === d.id}
                      className="text-sm text-red-500 hover:text-red-600 disabled:opacity-50"
                    >
                      {busy === d.id ? "…" : "Eliminar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-medium text-gray-900">Datos de conexión</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-gray-500 mb-1">Host</p>
              <code className="font-mono text-gray-800">{account?.dbHost ?? "—"}</code>
            </div>
            <div>
              <p className="text-gray-500 mb-1">Puerto</p>
              <code className="font-mono text-gray-800">3306</code>
            </div>
          </div>
          <p className="text-xs text-gray-400">
            Conéctate desde tu app PHP (host <code>localhost</code>) o externamente con el host de arriba.
          </p>
        </div>
      </div>
    </PortalLayout>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded bg-white border border-green-200 px-3 py-1.5">
      <span className="text-gray-500">{label}</span>
      <code className="font-mono text-xs text-gray-900 break-all">{value}</code>
    </div>
  );
}
