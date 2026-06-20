import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { AdminLayout } from "../index";

export const Route = createFileRoute("/_authed/providers/")({
  component: ProvidersPage,
});

const API = import.meta.env["VITE_API_URL"] ?? "http://localhost:8787";

type Provider = {
  id: string;
  name: string;
  kind: "hetzner" | "custom";
  hasToken: boolean;
  isActive: boolean;
};

const CUSTOM_EXAMPLE = `{
  "create": {
    "url": "https://api.tuproveedor.com/v1/servers",
    "method": "POST",
    "headers": { "Authorization": "Bearer {{token}}", "Content-Type": "application/json" },
    "body": "{\\"name\\":\\"{{name}}\\",\\"image\\":\\"debian-12\\",\\"user_data\\":{{user_data_json}}}",
    "ipPath": "server.ip",
    "idPath": "server.id"
  },
  "delete": {
    "urlTemplate": "https://api.tuproveedor.com/v1/servers/{{id}}",
    "method": "DELETE",
    "headers": { "Authorization": "Bearer {{token}}" }
  }
}`;

function ProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [createOn, setCreateOn] = useState<Provider | null>(null);

  async function load() {
    const res = await fetch(`${API}/admin/providers`, { credentials: "include" });
    if (res.ok) setProviders(await res.json());
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function remove(p: Provider) {
    if (!confirm(`¿Eliminar el proveedor "${p.name}"?`)) return;
    const res = await fetch(`${API}/admin/providers/${p.id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) load();
    else {
      const b = (await res.json().catch(() => null)) as { error?: string } | null;
      alert(b?.error ?? "No se pudo eliminar");
    }
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">Proveedores</h1>
          <button onClick={() => setShowAdd(true)}
            className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700">
            + Conectar proveedor
          </button>
        </div>

        <p className="text-sm text-gray-500">
          Conecta una cuenta de proveedor cloud para crear VPS desde el panel. El servidor se
          aprovisiona vía API y arranca el agente solo (cloud-init, sin SSH).
        </p>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {["Nombre", "Tipo", "Token", "Acciones"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">Cargando…</td></tr>
              ) : providers.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                  Conecta tu primer proveedor (ej. Hetzner Cloud) para crear VPS automáticamente
                </td></tr>
              ) : providers.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 text-gray-900">{p.name}</td>
                  <td className="px-4 py-3 text-gray-600 capitalize">{p.kind}</td>
                  <td className="px-4 py-3">
                    {p.hasToken
                      ? <span className="text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full">configurado</span>
                      : <span className="text-xs text-red-700 bg-red-100 px-2 py-0.5 rounded-full">falta</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-3">
                      <button onClick={() => setCreateOn(p)} className="text-xs font-medium text-blue-600 hover:underline">
                        Crear VPS
                      </button>
                      <button onClick={() => remove(p)} className="text-xs font-medium text-red-600 hover:underline">
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && <AddProviderModal onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); load(); }} />}
      {createOn && <CreateVpsModal provider={createOn} onClose={() => setCreateOn(null)} />}
    </AdminLayout>
  );
}

function AddProviderModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<"hetzner" | "custom">("hetzner");
  const [name, setName] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [config, setConfig] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API}/admin/providers`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind, apiToken, config: kind === "custom" ? config : undefined }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(b?.error ?? `Error ${res.status}`);
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Conectar proveedor" onClose={onClose}>
      <div className="space-y-4">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
            <select value={kind} onChange={(e) => setKind(e.target.value as "hetzner" | "custom")}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="hetzner">Hetzner Cloud</option>
              <option value="custom">Personalizado (API genérica)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Hetzner principal"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {kind === "hetzner" ? "API token de Hetzner Cloud" : "Token / API key"}
          </label>
          <input type="password" value={apiToken} onChange={(e) => setApiToken(e.target.value)}
            placeholder="••••••••" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono" />
          {kind === "hetzner" && (
            <p className="mt-1 text-xs text-gray-400">
              Hetzner Cloud Console → tu proyecto → Security → API Tokens (permiso Read &amp; Write).
            </p>
          )}
        </div>
        {kind === "custom" && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Config del adaptador (JSON)</label>
            <textarea value={config} onChange={(e) => setConfig(e.target.value)} rows={12}
              placeholder={CUSTOM_EXAMPLE}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono" />
            <p className="mt-1 text-xs text-gray-400">
              Placeholders disponibles: <code>{"{{token}}"}</code>, <code>{"{{name}}"}</code>,{" "}
              <code>{"{{bootstrap_url}}"}</code>, <code>{"{{user_data}}"}</code>,{" "}
              <code>{"{{user_data_json}}"}</code>. <code>ipPath</code>/<code>idPath</code> extraen datos
              de la respuesta (notación con puntos).
            </p>
          </div>
        )}
        <button onClick={save} disabled={saving || !name.trim() || !apiToken.trim()}
          className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {saving ? "Guardando…" : "Guardar proveedor"}
        </button>
      </div>
    </Modal>
  );
}

type ServerType = { name: string; cores: number; memory: number; disk: number; priceMonthly: string | null };
type Location = { name: string; city: string; country: string };

function CreateVpsModal({ provider, onClose }: { provider: Provider; onClose: () => void }) {
  const [name, setName] = useState("");
  const [serverType, setServerType] = useState("");
  const [location, setLocation] = useState("");
  const [opts, setOpts] = useState<{ serverTypes: ServerType[]; locations: Location[] } | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ ip: string } | null>(null);

  useEffect(() => {
    if (provider.kind !== "hetzner") return;
    fetch(`${API}/admin/providers/${provider.id}/options`, { credentials: "include" })
      .then((r) => r.json())
      .then((o: { serverTypes?: ServerType[]; locations?: Location[]; error?: string }) => {
        if (o.error) { setError(o.error); return; }
        setOpts({ serverTypes: o.serverTypes ?? [], locations: o.locations ?? [] });
        setServerType(o.serverTypes?.[0]?.name ?? "cx22");
        setLocation(o.locations?.[0]?.name ?? "nbg1");
      })
      .catch(() => setError("No se pudieron cargar las opciones de Hetzner"));
  }, [provider]);

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`${API}/admin/providers/${provider.id}/nodes`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, serverType, location }),
      });
      const b = await res.json().catch(() => null);
      if (!res.ok) throw new Error((b as { error?: string })?.error ?? `Error ${res.status}`);
      setDone({ ip: (b as { ip: string }).ip });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el VPS");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal title={`Crear VPS — ${provider.name}`} onClose={onClose}>
      {done ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            ✅ VPS creado en <code className="font-mono">{done.ip}</code>. Está instalando el agente
            (cloud-init); aparecerá como <strong>Listo</strong> en Nodes en ~2 min.
          </div>
          <button onClick={onClose} className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700">
            Entendido
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del servidor</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="bezenti-nbg-02"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>

          {provider.kind === "hetzner" ? (
            !opts ? (
              <p className="text-sm text-gray-400">Cargando opciones de Hetzner…</p>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de servidor</label>
                  <select value={serverType} onChange={(e) => setServerType(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                    {opts.serverTypes.map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.name} — {t.cores} vCPU, {t.memory} GB RAM, {t.disk} GB{t.priceMonthly ? ` (€${t.priceMonthly}/mes)` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ubicación</label>
                  <select value={location} onChange={(e) => setLocation(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                    {opts.locations.map((l) => (
                      <option key={l.name} value={l.name}>{l.name} — {l.city}, {l.country}</option>
                    ))}
                  </select>
                </div>
              </div>
            )
          ) : (
            <p className="text-xs text-gray-500">
              Se usará el adaptador configurado de este proveedor. La imagen debe ser Debian/Ubuntu
              y el adaptador debe pasar <code>user_data</code> (cloud-init) para arrancar el agente.
            </p>
          )}

          <button onClick={create} disabled={creating || !name.trim()}
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {creating ? "Creando VPS…" : "Crear VPS"}
          </button>
        </div>
      )}
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
