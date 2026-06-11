import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { AdminLayout } from "../index";
import { authClient } from "../../../../lib/auth";

export const Route = createFileRoute("/_authed/admin/nodes/")({
  component: NodesPage,
});

const API = import.meta.env["VITE_API_URL"] ?? "http://localhost:8787";

// ── Types ────────────────────────────────────────────────────────────────────

type NodeRow = {
  id: string;
  name: string;
  provider: string;
  region: string | null;
  ipPublic: string;
  status: "provisioning" | "ready" | "degraded" | "offline";
  diskGbTotal: number | null;
  ramMbTotal: number | null;
  lastHeartbeatAt: string | null;
};

type ProvisionResult = {
  nodeId: string;
  sshTriggered: boolean;
  sshError: string | null;
  manualCmd: string;
};

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS: Record<string, { label: string; cls: string }> = {
  ready:        { label: "Listo",        cls: "bg-green-100 text-green-700" },
  provisioning: { label: "Instalando",   cls: "bg-yellow-100 text-yellow-700 animate-pulse" },
  degraded:     { label: "Degradado",    cls: "bg-orange-100 text-orange-700" },
  offline:      { label: "Offline",      cls: "bg-red-100 text-red-700" },
};

// ── Main page ─────────────────────────────────────────────────────────────────

function NodesPage() {
  const [nodes, setNodes]         = useState<NodeRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showModal, setShowModal] = useState(false);

  async function fetchNodes() {
    const res = await fetch(`${API}/admin/nodes`, { credentials: "include" });
    if (res.ok) setNodes(await res.json());
    setLoading(false);
  }

  useEffect(() => { fetchNodes(); }, []);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">Nodes</h1>
          <button
            onClick={() => setShowModal(true)}
            className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            + Agregar VPS
          </button>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {["Node", "Proveedor", "IP", "RAM", "Disco", "Estado"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    Cargando...
                  </td>
                </tr>
              ) : nodes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    Agrega tu primer VPS para comenzar
                  </td>
                </tr>
              ) : (
                nodes.map((n) => {
                  const st = STATUS[n.status] ?? STATUS["offline"]!;
                  return (
                    <tr key={n.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{n.name}</td>
                      <td className="px-4 py-3 text-gray-600 capitalize">{n.provider}</td>
                      <td className="px-4 py-3 font-mono text-gray-600">{n.ipPublic}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {n.ramMbTotal ? `${Math.round(n.ramMbTotal / 1024)} GB` : "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {n.diskGbTotal ? `${n.diskGbTotal} GB` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-1 rounded-full ${st.cls}`}>
                          {st.label}
                        </span>
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
        <AddNodeModal
          onClose={() => setShowModal(false)}
          onSuccess={() => { setShowModal(false); fetchNodes(); }}
        />
      )}
    </AdminLayout>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

type ModalState = "form" | "connecting" | "provisioning" | "ready" | "error";

function AddNodeModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [state, setState]         = useState<ModalState>("form");
  const [error, setError]         = useState<string | null>(null);
  const [result, setResult]       = useState<ProvisionResult | null>(null);
  const [nodeStatus, setNodeStatus] = useState<string>("provisioning");
  const pollRef                   = useRef<ReturnType<typeof setInterval> | null>(null);

  const [form, setForm] = useState({
    name:        "",
    provider:    "hetzner",
    region:      "",
    host:        "",
    port:        "22",
    sshUser:     "root",
    sshPassword: "",
  });

  // Poll node status until ready
  function startPolling(nodeId: string) {
    pollRef.current = setInterval(async () => {
      const res = await fetch(`${API}/admin/nodes/${nodeId}`, { credentials: "include" });
      if (!res.ok) return;
      const node: NodeRow = await res.json();
      setNodeStatus(node.status);
      if (node.status === "ready" || node.status === "degraded") {
        clearInterval(pollRef.current!);
        if (node.status === "ready") {
          setState("ready");
          setTimeout(onSuccess, 1500);
        }
      }
    }, 4000);
  }

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("connecting");
    setError(null);

    try {
      const res = await fetch(`${API}/admin/nodes/provision`, {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:        form.name,
          provider:    form.provider,
          region:      form.region || undefined,
          host:        form.host,
          port:        parseInt(form.port, 10),
          sshUser:     form.sshUser,
          sshPassword: form.sshPassword,
        }),
      });

      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `Error ${res.status}`);
      }

      const data: ProvisionResult = await res.json();
      setResult(data);
      setState("provisioning");
      startPolling(data.nodeId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }

  function set(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Agregar VPS</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>

        <div className="p-6">

          {/* ── Form ── */}
          {state === "form" && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Nombre" required>
                  <input value={form.name} onChange={set("name")} required
                    placeholder="hetzner-nbg-01"
                    className="input" />
                </Field>
                <Field label="Proveedor">
                  <select value={form.provider} onChange={set("provider")} className="input">
                    {["hetzner", "digitalocean", "vultr", "aws", "linode", "otro"].map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field label="IP / Hostname" required>
                  <input value={form.host} onChange={set("host")} required
                    placeholder="1.2.3.4"
                    className="input" />
                </Field>
                <Field label="Región (opcional)">
                  <input value={form.region} onChange={set("region")}
                    placeholder="eu-central"
                    className="input" />
                </Field>
              </div>

              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide pt-2">
                Acceso SSH (solo para instalación inicial)
              </p>

              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <Field label="Usuario SSH" required>
                    <input value={form.sshUser} onChange={set("sshUser")} required
                      placeholder="root"
                      className="input" />
                  </Field>
                </div>
                <Field label="Puerto">
                  <input value={form.port} onChange={set("port")} type="number"
                    placeholder="22"
                    className="input" />
                </Field>
              </div>

              <Field label="Contraseña SSH" required>
                <input value={form.sshPassword} onChange={set("sshPassword")} required
                  type="password" placeholder="••••••••"
                  className="input" />
              </Field>

              <p className="text-xs text-gray-400">
                Las credenciales SSH solo se usan para lanzar el script de instalación.
                No se almacenan.
              </p>

              <button type="submit"
                className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
                Instalar agente
              </button>
            </form>
          )}

          {/* ── Connecting ── */}
          {state === "connecting" && (
            <div className="py-8 text-center space-y-3">
              <Spinner />
              <p className="text-sm text-gray-600">Conectando al VPS via SSH...</p>
            </div>
          )}

          {/* ── Provisioning ── */}
          {state === "provisioning" && result && (
            <div className="space-y-4">
              {result.sshTriggered ? (
                <StatusBanner color="blue">
                  <span className="font-medium">Instalación iniciada.</span>{" "}
                  El script está corriendo en tu VPS en segundo plano.
                  El nodo aparecerá como <strong>Listo</strong> en ~2 minutos.
                </StatusBanner>
              ) : (
                <StatusBanner color="yellow">
                  <span className="font-medium">No se pudo conectar via SSH:</span>{" "}
                  {result.sshError}
                  <br />
                  Copia el comando de abajo y ejecútalo en tu VPS como root.
                </StatusBanner>
              )}

              <div className="bg-gray-900 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-2">Ejecutar en el VPS como root:</p>
                <code className="text-xs text-green-300 font-mono break-all">
                  {result.manualCmd}
                </code>
                <button
                  onClick={() => navigator.clipboard.writeText(result.manualCmd)}
                  className="mt-3 text-xs text-gray-400 hover:text-white"
                >
                  Copiar
                </button>
              </div>

              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Spinner small />
                <span>
                  Esperando que el agente se registre
                  {nodeStatus === "provisioning" ? "..." : ` — estado: ${nodeStatus}`}
                </span>
              </div>
            </div>
          )}

          {/* ── Ready ── */}
          {state === "ready" && (
            <div className="py-8 text-center space-y-2">
              <p className="text-3xl">✅</p>
              <p className="text-base font-medium text-gray-900">Node listo</p>
              <p className="text-sm text-gray-500">Cerrando...</p>
            </div>
          )}

          {/* ── Error ── */}
          {state === "error" && (
            <div className="space-y-4">
              <StatusBanner color="red">
                <span className="font-medium">Error:</span> {error}
              </StatusBanner>
              <button onClick={() => setState("form")}
                className="text-sm text-blue-600 hover:underline">
                ← Volver al formulario
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Small components ──────────────────────────────────────────────────────────

function Field({ label, required, children }: {
  label: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function Spinner({ small }: { small?: boolean }) {
  return (
    <div className={`border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin ${small ? "w-4 h-4" : "w-8 h-8 mx-auto"}`} />
  );
}

function StatusBanner({ color, children }: {
  color: "blue" | "yellow" | "red"; children: React.ReactNode;
}) {
  const cls = {
    blue:   "bg-blue-50 border-blue-200 text-blue-800",
    yellow: "bg-yellow-50 border-yellow-200 text-yellow-800",
    red:    "bg-red-50 border-red-200 text-red-800",
  }[color];
  return (
    <div className={`border rounded-lg px-4 py-3 text-sm ${cls}`}>{children}</div>
  );
}
