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
  const [testDb, setTestDb] = useState<Database | null>(null);
  const [pwdDb, setPwdDb] = useState<Database | null>(null);

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

  async function openAdminer(d: Database) {
    // Abrir la pestaña ANTES del await para no chocar con el bloqueador de
    // pop-ups; luego se le fija la URL de login 1-clic que devuelve la API.
    const win = window.open("", "_blank");
    setBusy(d.id);
    setError(null);
    try {
      const { url } = await api<{ url: string }>(`/portal/databases/${d.id}/adminer-login`, { method: "POST" });
      if (win) win.location.href = url;
      else window.location.href = url;
    } catch (err) {
      if (win) win.close();
      setError(err instanceof Error ? err.message : "No se pudo abrir el gestor de BD");
    } finally {
      setBusy(null);
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
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => openAdminer(d)}
                      disabled={busy === d.id}
                      className="text-sm text-blue-600 hover:text-blue-700 mr-3 disabled:opacity-50"
                    >
                      {busy === d.id ? "Abriendo…" : "Abrir gestor"}
                    </button>
                    <button
                      onClick={() => setTestDb(d)}
                      className="text-sm text-blue-600 hover:text-blue-700 mr-3"
                    >
                      Probar / SQL
                    </button>
                    <button
                      onClick={() => setPwdDb(d)}
                      className="text-sm text-gray-600 hover:text-gray-800 mr-3"
                    >
                      Contraseña
                    </button>
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

      {testDb && <SqlModal db={testDb} onClose={() => setTestDb(null)} />}
      {pwdDb && <PasswordModal db={pwdDb} onClose={() => setPwdDb(null)} />}
    </PortalLayout>
  );
}

function PasswordModal({ db, onClose }: { db: Database; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function change() {
    if (password && password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ ok: boolean; password: string }>(`/portal/databases/${db.id}/password`, {
        method: "POST",
        body: JSON.stringify({ password: password || undefined }),
      });
      setNewPassword(res.password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar la contraseña");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            Cambiar contraseña — <span className="font-mono text-sm">{db.dbUser}</span>
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>

        <div className="p-5 space-y-4">
          {newPassword ? (
            <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-2">
              <p className="text-sm font-medium text-green-800">
                ✅ Contraseña actualizada. Guárdala — no se vuelve a mostrar.
              </p>
              <Row label="Nueva contraseña" value={newPassword} />
              <p className="text-xs text-green-700">
                Actualiza esta contraseña en la configuración de tu app (wp-config.php, .env, etc.).
              </p>
              <button onClick={onClose} className="text-xs text-green-700 hover:underline">Listo</button>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nueva contraseña</label>
                <input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Déjalo vacío para generar una segura"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-400">Mínimo 8 caracteres. Si lo dejas vacío, se genera una aleatoria.</p>
              </div>
              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
              )}
              <button
                onClick={change}
                disabled={saving}
                className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Cambiando…" : "Cambiar contraseña"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type QueryResult = {
  ok: boolean;
  error?: string;
  message?: string;
  columns?: string[];
  rows?: string[][];
};

function SqlModal({ db, onClose }: { db: Database; onClose: () => void }) {
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [running, setRunning] = useState(false);

  async function run(testOnly: boolean) {
    setRunning(true);
    setResult(null);
    try {
      const res = await api<QueryResult>(`/portal/databases/${db.id}/query`, {
        method: "POST",
        body: JSON.stringify({ sql: testOnly ? "" : sql }),
      });
      setResult(res);
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : "Error" });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            Probar conexión — <span className="font-mono text-sm">{db.dbName}</span>
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => run(true)}
              disabled={running}
              className="bg-green-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {running ? "Probando…" : "Probar conexión"}
            </button>
            <span className="text-xs text-gray-400">
              Conecta como <code className="font-mono">{db.dbUser}</code> y corre una consulta de prueba.
            </span>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">…o ejecuta tu propio SQL</label>
            <textarea
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              rows={3}
              placeholder="SELECT * FROM mi_tabla LIMIT 10;"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={() => run(false)}
              disabled={running || !sql.trim()}
              className="mt-2 bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {running ? "Ejecutando…" : "Ejecutar SQL"}
            </button>
          </div>

          {result && (
            <div>
              {result.ok ? (
                result.columns ? (
                  <div className="border border-gray-200 rounded-lg overflow-auto max-h-72">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          {result.columns.map((col) => (
                            <th key={col} className="text-left px-3 py-2 font-medium text-gray-600 whitespace-nowrap">{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {(result.rows ?? []).map((row, i) => (
                          <tr key={i}>
                            {row.map((cell, j) => (
                              <td key={j} className="px-3 py-1.5 font-mono text-gray-800 whitespace-nowrap">{cell}</td>
                            ))}
                          </tr>
                        ))}
                        {(result.rows ?? []).length === 0 && (
                          <tr><td className="px-3 py-3 text-gray-400" colSpan={result.columns.length}>0 filas</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                    ✅ {result.message ?? "Conexión correcta"}
                  </div>
                )
              ) : (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 font-mono whitespace-pre-wrap">
                  {result.error}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
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
