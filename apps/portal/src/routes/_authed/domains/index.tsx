import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { PortalLayout } from "../index";

const API = import.meta.env["VITE_API_URL"] ?? "http://localhost:8787";

export const Route = createFileRoute("/_authed/domains/")({
  component: DomainsPage,
});

type DnsRecord = {
  id: string;
  type: string;
  name: string;
  value: string;
  ttl: number;
  priority: number | null;
};

type Zone = {
  id: string;
  zone: string;
  ns1: string | null;
  ns2: string | null;
  status: "pending" | "active";
  records: DnsRecord[];
};

const RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "CAA", "SRV"] as const;

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

function DomainsPage() {
  const [zones, setZones]   = useState<Zone[] | null>(null);
  const [error, setError]   = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy]     = useState(false);
  const [open, setOpen]     = useState<string | null>(null); // zona expandida
  const [confirmDel, setConfirmDel] = useState<Zone | null>(null);

  const noHosting = error === "no hosting found";

  const load = useCallback(async () => {
    try {
      const rows = await api<Zone[]>("/portal/dns/zones");
      setZones(rows);
      setError("");
    } catch (e) {
      setZones([]);
      setError(e instanceof Error ? e.message : "Error cargando dominios");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    fn()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => { setBusy(false); void load(); });
  }

  if (noHosting) {
    return (
      <PortalLayout>
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500">
          Aún no tienes un hosting activo.
        </div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-gray-900">Dominios</h1>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex justify-between">
            <span>{error}</span>
            <button onClick={() => setError("")} className="text-red-400 hover:text-red-600 ml-3">✕</button>
          </div>
        )}
        {notice && (
          <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{notice}</div>
        )}

        <NewZoneForm busy={busy} onCreate={(zone) => run(async () => {
          const created = await api<{ id: string }>(`/portal/dns/zones`, {
            method: "POST",
            body:   JSON.stringify({ zone }),
          });
          setNotice(`Zona ${zone} creada — configura los nameservers en tu registrador`);
          setOpen(created.id);
        })} />

        {zones === null ? (
          <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-400">Cargando…</div>
        ) : zones.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-gray-400">
            Agrega tu primer dominio para gestionar sus DNS aquí
          </div>
        ) : (
          zones.map((z) => (
            <ZoneCard
              key={z.id}
              zone={z}
              expanded={open === z.id}
              busy={busy}
              onToggle={() => setOpen(open === z.id ? null : z.id)}
              onVerify={() => run(async () => {
                await api(`/portal/dns/zones/${z.id}/verify`, { method: "POST" });
                setNotice(`${z.zone} verificado y publicado — tus DNS ya están sirviendo`);
              })}
              onDelete={() => setConfirmDel(z)}
              onNotice={setNotice}
              run={run}
            />
          ))
        )}

        <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 text-sm text-gray-600 space-y-1">
          <p className="font-medium text-gray-800">¿Cómo funciona?</p>
          <p>1. Agrega tu dominio — te asignamos un par de nameservers exclusivo para tu cuenta.</p>
          <p>2. En tu registrador (Namecheap, GoDaddy, NIC…) cambia los nameservers del dominio por los asignados.</p>
          <p>3. Pulsa <strong>Verificar</strong>: cuando la delegación coincida, tus registros se publican automáticamente.</p>
        </div>
      </div>

      {confirmDel && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmDel(null); }}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4">
            <h2 className="text-sm font-medium text-gray-900">Eliminar zona</h2>
            <p className="text-sm text-gray-600">
              Vas a eliminar <strong>{confirmDel.zone}</strong> con todos sus registros.
              Si el dominio sigue delegado a Bezenti dejará de resolver.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDel(null)} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">Cancelar</button>
              <button
                onClick={() => { const z = confirmDel; setConfirmDel(null); run(async () => {
                  await api(`/portal/dns/zones/${z.id}`, { method: "DELETE" });
                  setNotice(`${z.zone} eliminada`);
                }); }}
                className="bg-red-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-red-700">
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}

function NewZoneForm({ busy, onCreate }: { busy: boolean; onCreate: (zone: string) => void }) {
  const [open, setOpen] = useState(false);
  const [zone, setZone] = useState("");

  if (!open) {
    return (
      <div>
        <button onClick={() => setOpen(true)}
          className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
          + Agregar dominio
        </button>
      </div>
    );
  }
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (zone.trim()) { onCreate(zone.trim().toLowerCase()); setZone(""); setOpen(false); } }}
      className="bg-white border border-gray-200 rounded-xl p-5 flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-60">
        <label className="block text-sm font-medium text-gray-700 mb-1">Dominio</label>
        <input value={zone} onChange={(e) => setZone(e.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, ""))}
          required autoFocus placeholder="miempresa.com"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <button type="submit" disabled={busy || !zone.trim()}
        className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
        Agregar
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-500 hover:text-gray-700 px-2 py-2">
        Cancelar
      </button>
    </form>
  );
}

function ZoneCard({ zone, expanded, busy, onToggle, onVerify, onDelete, onNotice, run }: {
  zone: Zone; expanded: boolean; busy: boolean;
  onToggle: () => void; onVerify: () => void; onDelete: () => void;
  onNotice: (n: string) => void;
  run: (fn: () => Promise<void>) => void;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm text-gray-900">{zone.zone}</span>
          {zone.status === "active" ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">Activo</span>
          ) : (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Pendiente de verificación</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span>{zone.records.length} registro(s)</span>
          <span>{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-4">
          {zone.status === "pending" && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm space-y-2">
              <p className="font-medium text-amber-900">Configura estos nameservers en tu registrador</p>
              <p className="text-amber-800 text-xs">
                Este par es exclusivo de tu cuenta — la zona solo se activará si el dominio apunta exactamente a estos dos:
              </p>
              <div className="flex flex-wrap gap-2">
                {[zone.ns1, zone.ns2].map((ns) => ns && (
                  <code key={ns} className="font-mono text-xs bg-white border border-amber-200 rounded-lg px-3 py-1.5 text-gray-800">
                    {ns}
                  </code>
                ))}
                <button
                  onClick={() => { void navigator.clipboard.writeText(`${zone.ns1}\n${zone.ns2}`); onNotice("Nameservers copiados"); }}
                  className="text-xs text-blue-600 hover:text-blue-800 px-2">
                  Copiar
                </button>
              </div>
              <button onClick={onVerify} disabled={busy}
                className="mt-1 bg-amber-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-amber-700 disabled:opacity-50">
                {busy ? "Verificando…" : "Verificar delegación"}
              </button>
            </div>
          )}

          {zone.status === "active" && zone.ns1 && (
            <p className="text-xs text-gray-400">
              Sirviendo en <code className="font-mono">{zone.ns1}</code> y <code className="font-mono">{zone.ns2}</code>
            </p>
          )}

          <RecordsTable zone={zone} busy={busy} run={run} onNotice={onNotice} />

          <div className="pt-2 border-t border-gray-100 flex justify-end">
            <button onClick={onDelete} className="text-xs text-red-500 hover:text-red-700">
              Eliminar zona
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RecordsTable({ zone, busy, run, onNotice }: {
  zone: Zone; busy: boolean;
  run: (fn: () => Promise<void>) => void;
  onNotice: (n: string) => void;
}) {
  const [draft, setDraft] = useState({ type: "A", name: "", value: "", ttl: 3600, priority: 10 });
  const [editing, setEditing] = useState<DnsRecord | null>(null);

  const needsPriority = draft.type === "MX" || draft.type === "SRV";

  function submitNew(e: React.FormEvent) {
    e.preventDefault();
    const payload = { ...draft, name: draft.name.trim() || "@", priority: needsPriority ? draft.priority : undefined };
    run(async () => {
      await api(`/portal/dns/zones/${zone.id}/records`, { method: "POST", body: JSON.stringify(payload) });
      onNotice(`Registro ${payload.type} ${payload.name} guardado${zone.status === "active" ? " y publicado" : ""}`);
      setDraft({ ...draft, name: "", value: "" });
    });
  }

  return (
    <div className="space-y-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
            <th className="py-1.5 font-medium w-20">Tipo</th>
            <th className="py-1.5 font-medium w-40">Nombre</th>
            <th className="py-1.5 font-medium">Valor</th>
            <th className="py-1.5 font-medium w-20">TTL</th>
            <th className="py-1.5 font-medium w-16">Prio</th>
            <th className="py-1.5 w-28"></th>
          </tr>
        </thead>
        <tbody>
          {zone.records.length === 0 && (
            <tr><td colSpan={6} className="py-5 text-center text-gray-400 text-xs">Sin registros</td></tr>
          )}
          {zone.records.map((r) => (
            editing?.id === r.id ? (
              <RecordEditRow key={r.id} record={editing} busy={busy}
                onChange={setEditing}
                onCancel={() => setEditing(null)}
                onSave={() => run(async () => {
                  await api(`/portal/dns/zones/${zone.id}/records/${r.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({
                      type: editing.type, name: editing.name, value: editing.value,
                      ttl: editing.ttl,
                      priority: (editing.type === "MX" || editing.type === "SRV") ? (editing.priority ?? 10) : undefined,
                    }),
                  });
                  onNotice("Registro actualizado");
                  setEditing(null);
                })} />
            ) : (
              <tr key={r.id} className="border-b border-gray-50 group">
                <td className="py-2 font-mono text-xs text-gray-700">{r.type}</td>
                <td className="py-2 font-mono text-xs text-gray-700">{r.name}</td>
                <td className="py-2 font-mono text-xs text-gray-700 break-all pr-3">{r.value}</td>
                <td className="py-2 text-xs text-gray-500">{r.ttl}</td>
                <td className="py-2 text-xs text-gray-500">{r.priority ?? "—"}</td>
                <td className="py-2 text-right">
                  <div className="flex justify-end gap-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setEditing(r)} className="text-blue-600 hover:text-blue-800">Editar</button>
                    <button onClick={() => run(async () => {
                      await api(`/portal/dns/zones/${zone.id}/records/${r.id}`, { method: "DELETE" });
                      onNotice("Registro eliminado");
                    })} className="text-red-500 hover:text-red-700">Eliminar</button>
                  </div>
                </td>
              </tr>
            )
          ))}
        </tbody>
      </table>

      {/* Alta de registro */}
      <form onSubmit={submitNew} className="flex flex-wrap items-end gap-2 bg-gray-50 border border-gray-200 rounded-lg p-3">
        <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}
          className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs font-mono bg-white">
          {RECORD_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value.toLowerCase() })}
          placeholder="@ o www" className="w-28 px-2 py-1.5 border border-gray-300 rounded-lg text-xs font-mono" />
        <input value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })}
          placeholder="valor (IP, host, texto…)" required
          className="flex-1 min-w-40 px-2 py-1.5 border border-gray-300 rounded-lg text-xs font-mono" />
        <input type="number" value={draft.ttl} min={60} max={86400}
          onChange={(e) => setDraft({ ...draft, ttl: Number(e.target.value) })}
          title="TTL" className="w-20 px-2 py-1.5 border border-gray-300 rounded-lg text-xs" />
        {needsPriority && (
          <input type="number" value={draft.priority} min={0} max={65535}
            onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })}
            title="Prioridad" className="w-16 px-2 py-1.5 border border-gray-300 rounded-lg text-xs" />
        )}
        <button type="submit" disabled={busy || !draft.value.trim()}
          className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">
          + Agregar registro
        </button>
      </form>
    </div>
  );
}

function RecordEditRow({ record, busy, onChange, onCancel, onSave }: {
  record: DnsRecord; busy: boolean;
  onChange: (r: DnsRecord) => void; onCancel: () => void; onSave: () => void;
}) {
  const needsPriority = record.type === "MX" || record.type === "SRV";
  return (
    <tr className="border-b border-gray-50 bg-blue-50/40">
      <td className="py-2 pr-1">
        <select value={record.type} onChange={(e) => onChange({ ...record, type: e.target.value })}
          className="w-full px-1 py-1 border border-gray-300 rounded text-xs font-mono bg-white">
          {RECORD_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
      </td>
      <td className="py-2 pr-1">
        <input value={record.name} onChange={(e) => onChange({ ...record, name: e.target.value.toLowerCase() })}
          className="w-full px-1.5 py-1 border border-gray-300 rounded text-xs font-mono" />
      </td>
      <td className="py-2 pr-1">
        <input value={record.value} onChange={(e) => onChange({ ...record, value: e.target.value })}
          className="w-full px-1.5 py-1 border border-gray-300 rounded text-xs font-mono" />
      </td>
      <td className="py-2 pr-1">
        <input type="number" value={record.ttl} onChange={(e) => onChange({ ...record, ttl: Number(e.target.value) })}
          className="w-full px-1 py-1 border border-gray-300 rounded text-xs" />
      </td>
      <td className="py-2 pr-1">
        {needsPriority ? (
          <input type="number" value={record.priority ?? 10}
            onChange={(e) => onChange({ ...record, priority: Number(e.target.value) })}
            className="w-full px-1 py-1 border border-gray-300 rounded text-xs" />
        ) : <span className="text-xs text-gray-400">—</span>}
      </td>
      <td className="py-2 text-right">
        <div className="flex justify-end gap-2 text-xs">
          <button onClick={onSave} disabled={busy} className="text-green-600 hover:text-green-800 disabled:opacity-50">Guardar</button>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">Cancelar</button>
        </div>
      </td>
    </tr>
  );
}
