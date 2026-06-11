import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { AdminLayout } from "../index";

export const Route = createFileRoute("/_authed/clients/")({
  component: ClientsPage,
});

const API = import.meta.env["VITE_API_URL"] ?? "http://localhost:8787";

// ── Types ────────────────────────────────────────────────────────────────────

type ClientRow = {
  id: string;
  userId: string;
  linuxUser: string;
  status: "active" | "suspended" | "deleted";
  createdAt: string;
  plan: { id: string; name: string } | null;
  node: { id: string; name: string; ipPublic: string } | null;
};

type UserRow = { id: string; email: string; name: string | null; role: string | null };
type NodeRow = { id: string; name: string; ipPublic: string; status: string };
type PlanRow = { id: string; name: string; diskMb: number; pricePen: number };

type CreateResult = {
  id: string;
  linuxUser: string;
  sftp: { host: string; port: number; user: string; password: string };
  database: { name: string; user: string; password: string; host: string };
};

const STATUS: Record<string, { label: string; cls: string }> = {
  active:    { label: "Activo",     cls: "bg-green-100 text-green-700" },
  suspended: { label: "Suspendido", cls: "bg-orange-100 text-orange-700" },
  deleted:   { label: "Eliminado",  cls: "bg-gray-100 text-gray-500" },
};

// ── Main page ─────────────────────────────────────────────────────────────────

function ClientsPage() {
  const [clients, setClients]     = useState<ClientRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showModal, setShowModal] = useState(false);

  async function fetchClients() {
    const res = await fetch(`${API}/admin/clients`, { credentials: "include" });
    if (res.ok) setClients(await res.json());
    setLoading(false);
  }

  useEffect(() => { fetchClients(); }, []);

  async function handleDelete(client: ClientRow) {
    const ok = window.confirm(
      `¿Eliminar el cliente "${client.linuxUser}"? Se borrará su usuario, archivos y base de datos en el VPS.`,
    );
    if (!ok) return;
    const res = await fetch(`${API}/admin/clients/${client.id}`, {
      method:      "DELETE",
      credentials: "include",
    });
    if (res.ok) fetchClients();
    else alert("No se pudo eliminar el cliente");
  }

  const visible = clients.filter((c) => c.status !== "deleted");

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">Clientes</h1>
          <button
            onClick={() => setShowModal(true)}
            className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            + Nuevo cliente
          </button>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {["Cliente", "Plan", "Node", "Estado", "Acciones"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    Cargando...
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    Aún no hay clientes registrados
                  </td>
                </tr>
              ) : (
                visible.map((cl) => {
                  const st = STATUS[cl.status] ?? STATUS["active"]!;
                  return (
                    <tr key={cl.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-gray-900">{cl.linuxUser}</td>
                      <td className="px-4 py-3 text-gray-600">{cl.plan?.name ?? "—"}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {cl.node ? `${cl.node.name} (${cl.node.ipPublic})` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-1 rounded-full ${st.cls}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleDelete(cl)}
                          className="text-xs font-medium text-red-600 hover:underline"
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <NewClientModal
          onClose={() => setShowModal(false)}
          onCreated={fetchClients}
        />
      )}
    </AdminLayout>
  );
}

// ── New client modal ──────────────────────────────────────────────────────────

function NewClientModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [users, setUsers]   = useState<UserRow[]>([]);
  const [nodes, setNodes]   = useState<NodeRow[]>([]);
  const [plans, setPlans]   = useState<PlanRow[]>([]);
  const [form, setForm]     = useState({ userId: "", nodeId: "", planId: "" });
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);

  useEffect(() => {
    (async () => {
      const [u, n, p] = await Promise.all([
        fetch(`${API}/admin/users`, { credentials: "include" }).then((r) => r.json()),
        fetch(`${API}/admin/nodes`, { credentials: "include" }).then((r) => r.json()),
        fetch(`${API}/admin/plans`, { credentials: "include" }).then((r) => r.json()),
      ]);
      setUsers(u);
      const ready = (n as NodeRow[]).filter((x) => x.status === "ready");
      setNodes(ready);
      setPlans(p);
      setForm((f) => ({
        userId: f.userId || (u[0]?.id ?? ""),
        nodeId: f.nodeId || (ready[0]?.id ?? ""),
        planId: f.planId || (p[0]?.id ?? ""),
      }));
    })();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/admin/clients`, {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `Error ${res.status}`);
      setResult(body as CreateResult);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function set(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">

        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {result ? "Cliente creado" : "Nuevo cliente"}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>

        <div className="p-6">
          {!result ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Select label="Usuario" value={form.userId} onChange={set("userId")}>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.email}{u.name ? ` — ${u.name}` : ""}</option>
                ))}
              </Select>

              <Select label="Node" value={form.nodeId} onChange={set("nodeId")}>
                {nodes.length === 0 && <option value="">No hay nodes listos</option>}
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>{n.name} ({n.ipPublic})</option>
                ))}
              </Select>

              <Select label="Plan" value={form.planId} onChange={set("planId")}>
                {plans.length === 0 && <option value="">No hay planes</option>}
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {Math.round(p.diskMb / 1024)} GB — S/ {p.pricePen}
                  </option>
                ))}
              </Select>

              {error && (
                <div className="border border-red-200 bg-red-50 text-red-800 rounded-lg px-4 py-3 text-sm">
                  <span className="font-medium">Error:</span> {error}
                </div>
              )}

              <button
                type="submit"
                disabled={busy || !form.userId || !form.nodeId || !form.planId}
                className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {busy ? "Creando en el VPS..." : "Crear cliente"}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="border border-green-200 bg-green-50 text-green-800 rounded-lg px-4 py-3 text-sm">
                Cliente <strong className="font-mono">{result.linuxUser}</strong> creado en el VPS.
                Guarda estas credenciales — <strong>no se volverán a mostrar</strong>.
              </div>

              <CredsBlock title="SFTP" rows={[
                ["Host",       result.sftp.host],
                ["Puerto",     String(result.sftp.port)],
                ["Usuario",    result.sftp.user],
                ["Contraseña", result.sftp.password],
              ]} />

              <CredsBlock title="Base de datos (MariaDB)" rows={[
                ["Host",       result.database.host],
                ["Base",       result.database.name],
                ["Usuario",    result.database.user],
                ["Contraseña", result.database.password],
              ]} />

              <button
                onClick={onClose}
                className="w-full bg-gray-900 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
              >
                Listo, ya las guardé
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Small components ──────────────────────────────────────────────────────────

function Select({ label, value, onChange, children }: {
  label: string; value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <select value={value} onChange={onChange} className="input">{children}</select>
    </div>
  );
}

function CredsBlock({ title, rows }: { title: string; rows: [string, string][] }) {
  const text = rows.map(([k, v]) => `${k}: ${v}`).join("\n");
  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-400">{title}</p>
        <button
          onClick={() => navigator.clipboard.writeText(text)}
          className="text-xs text-gray-400 hover:text-white"
        >
          Copiar
        </button>
      </div>
      <dl className="space-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2 text-xs font-mono">
            <dt className="text-gray-500 w-24 shrink-0">{k}</dt>
            <dd className="text-green-300 break-all">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
