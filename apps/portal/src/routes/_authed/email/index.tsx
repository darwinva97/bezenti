import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { PortalLayout } from "../index";

const API = import.meta.env["VITE_API_URL"] ?? "http://localhost:8787";

export const Route = createFileRoute("/_authed/email/")({
  component: EmailPage,
});

type Mailbox = {
  id: string;
  email: string;
  quotaMb: number;
  usedMb: number;
  status: string;
  createdAt: string;
};

type EmailData = {
  domain: string;
  mailHost: string;
  accounts: Mailbox[];
};

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

const QUOTAS = [
  { mb: 512,   label: "512 MB" },
  { mb: 1024,  label: "1 GB" },
  { mb: 2048,  label: "2 GB" },
  { mb: 5120,  label: "5 GB" },
  { mb: 10240, label: "10 GB" },
];

function humanMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`;
}

function EmailPage() {
  const [data, setData]       = useState<EmailData | null>(null);
  const [error, setError]     = useState("");
  const [notice, setNotice]   = useState("");
  const [busy, setBusy]       = useState(false);
  const [secret, setSecret]   = useState<{ email: string; password: string; isNew: boolean } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; body: string; action: () => void; danger?: boolean } | null>(null);
  const [quotaFor, setQuotaFor] = useState<Mailbox | null>(null);

  const noHosting = error === "no hosting found";

  const load = useCallback(async () => {
    try {
      setData(await api<EmailData>("/portal/email"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando correos");
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

  function changePassword(box: Mailbox) {
    setConfirm({
      title:  "Regenerar contraseña",
      body:   `Se generará una contraseña nueva para ${box.email}. La actual dejará de funcionar inmediatamente en todos los dispositivos.`,
      action: () => run(async () => {
        const res = await api<{ email: string; password: string }>(`/portal/email/${box.id}/password`, { method: "POST" });
        setSecret({ email: res.email, password: res.password, isNew: false });
      }),
    });
  }

  function deleteBox(box: Mailbox) {
    setConfirm({
      title:  "Eliminar buzón",
      body:   `Vas a eliminar ${box.email} con todos sus mensajes. Esta acción no se puede deshacer.`,
      danger: true,
      action: () => run(async () => {
        await api(`/portal/email/${box.id}`, { method: "DELETE" });
        setNotice(`${box.email} eliminado`);
      }),
    });
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
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-xl font-semibold text-gray-900">Correos corporativos</h1>
          {data && (
            <code className="text-sm font-mono text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1">
              @{data.domain}
            </code>
          )}
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex justify-between">
            <span>{error}</span>
            <button onClick={() => setError("")} className="text-red-400 hover:text-red-600 ml-3">✕</button>
          </div>
        )}
        {notice && (
          <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{notice}</div>
        )}

        {data && (
          <NewMailboxForm
            domain={data.domain}
            busy={busy}
            onCreate={(local, quotaMb) => run(async () => {
              const res = await api<{ email: string; password: string }>(`/portal/email`, {
                method: "POST",
                body:   JSON.stringify({ local, quotaMb }),
              });
              setSecret({ email: res.email, password: res.password, isNew: true });
            })}
          />
        )}

        {/* Lista de buzones */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                <th className="pl-4 py-2.5 font-medium">Buzón</th>
                <th className="py-2.5 font-medium w-52">Almacenamiento</th>
                <th className="py-2.5 font-medium w-36 hidden sm:table-cell">Creado</th>
                <th className="py-2.5 pr-4 w-56"></th>
              </tr>
            </thead>
            <tbody>
              {data === null ? (
                <tr><td colSpan={4} className="py-10 text-center text-gray-400">Cargando…</td></tr>
              ) : data.accounts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-gray-400">
                    Aún no tienes buzones — crea el primero arriba
                  </td>
                </tr>
              ) : (
                data.accounts.map((box) => {
                  const pct = Math.min(100, Math.round((box.usedMb / box.quotaMb) * 100));
                  return (
                    <tr key={box.id} className="border-b border-gray-50 hover:bg-gray-50 group">
                      <td className="pl-4 py-3">
                        <span className="font-mono text-[13px] text-gray-800">{box.email}</span>
                      </td>
                      <td className="py-3 pr-6">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full ${pct > 90 ? "bg-red-400" : pct > 70 ? "bg-amber-400" : "bg-blue-500"}`}
                              style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-gray-500 tabular-nums whitespace-nowrap">
                            {humanMb(box.usedMb)} / {humanMb(box.quotaMb)}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 text-gray-500 hidden sm:table-cell">
                        {new Date(box.createdAt).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center justify-end gap-3 text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => changePassword(box)} className="text-blue-600 hover:text-blue-800">Contraseña</button>
                          <button onClick={() => setQuotaFor(box)} className="text-gray-500 hover:text-gray-800">Cuota</button>
                          <button onClick={() => deleteBox(box)} className="text-red-500 hover:text-red-700">Eliminar</button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Datos de conexión */}
        {data && data.accounts.length > 0 && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-5 py-4 text-sm space-y-3">
            <p className="font-medium text-gray-800">Configura tu cliente de correo (Thunderbird, Outlook, móvil)</p>
            <div className="grid sm:grid-cols-2 gap-3 text-gray-700">
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Entrante — IMAP (SSL/TLS)</p>
                <code className="font-mono text-xs">{data.mailHost} : 993</code>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Saliente — SMTP (SSL/TLS)</p>
                <code className="font-mono text-xs">{data.mailHost} : 465</code>
              </div>
            </div>
            <p className="text-xs text-gray-400">
              Usuario: la dirección de correo completa. Contraseña: la generada al crear el buzón.
            </p>
          </div>
        )}
      </div>

      {/* Contraseña generada — visible UNA sola vez */}
      {secret && (
        <Modal onClose={() => setSecret(null)} title={secret.isNew ? "Buzón creado" : "Contraseña regenerada"}>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Guarda esta contraseña ahora — <strong>no se volverá a mostrar</strong>.
            </p>
            <div>
              <p className="text-xs text-gray-500 mb-1">Buzón</p>
              <code className="block font-mono text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{secret.email}</code>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Contraseña</p>
              <div className="flex gap-2">
                <code className="flex-1 font-mono text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 select-all">
                  {secret.password}
                </code>
                <button
                  onClick={() => { void navigator.clipboard.writeText(secret.password); setNotice("Contraseña copiada"); }}
                  className="text-sm text-blue-600 hover:text-blue-800 border border-blue-200 rounded-lg px-3 hover:bg-blue-50">
                  Copiar
                </button>
              </div>
            </div>
            <div className="flex justify-end pt-1">
              <button onClick={() => setSecret(null)}
                className="bg-blue-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-blue-700">
                Listo, la guardé
              </button>
            </div>
          </div>
        </Modal>
      )}

      {confirm && (
        <Modal onClose={() => setConfirm(null)} title={confirm.title}>
          <p className="text-sm text-gray-600">{confirm.body}</p>
          <div className="flex gap-2 justify-end mt-4">
            <button onClick={() => setConfirm(null)} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">Cancelar</button>
            <button
              onClick={() => { const a = confirm.action; setConfirm(null); a(); }}
              disabled={busy}
              className={`text-white text-sm px-4 py-1.5 rounded-lg disabled:opacity-50 ${confirm.danger ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"}`}>
              Continuar
            </button>
          </div>
        </Modal>
      )}

      {quotaFor && (
        <Modal onClose={() => setQuotaFor(null)} title={`Cuota de ${quotaFor.email}`}>
          <div className="space-y-2">
            {QUOTAS.map((q) => (
              <button key={q.mb}
                onClick={() => {
                  const box = quotaFor;
                  setQuotaFor(null);
                  run(async () => {
                    await api(`/portal/email/${box.id}/quota`, { method: "PATCH", body: JSON.stringify({ quotaMb: q.mb }) });
                    setNotice(`Cuota de ${box.email} → ${q.label}`);
                  });
                }}
                className={`w-full text-left text-sm px-3 py-2 rounded-lg border transition-colors ${q.mb === quotaFor.quotaMb ? "border-blue-400 bg-blue-50 text-blue-800" : "border-gray-200 hover:bg-gray-50 text-gray-700"}`}>
                {q.label}{q.mb === quotaFor.quotaMb && " (actual)"}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </PortalLayout>
  );
}

function NewMailboxForm({ domain, busy, onCreate }: {
  domain: string; busy: boolean; onCreate: (local: string, quotaMb: number) => void;
}) {
  const [open, setOpen]   = useState(false);
  const [local, setLocal] = useState("");
  const [quota, setQuota] = useState(1024);

  if (!open) {
    return (
      <div>
        <button onClick={() => setOpen(true)}
          className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
          + Nuevo buzón
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (local.trim()) { onCreate(local.trim(), quota); setLocal(""); setOpen(false); } }}
      className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
      <h2 className="text-sm font-medium text-gray-900">Nuevo buzón</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Dirección</label>
          <div className="flex items-center">
            <input
              value={local}
              onChange={(e) => setLocal(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""))}
              required
              autoFocus
              placeholder="contacto"
              className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-l-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="px-3 py-2 border border-l-0 border-gray-300 rounded-r-lg bg-gray-50 text-sm font-mono text-gray-500 whitespace-nowrap">
              @{domain}
            </span>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Espacio</label>
          <select value={quota} onChange={(e) => setQuota(Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            {QUOTAS.map((q) => <option key={q.mb} value={q.mb}>{q.label}</option>)}
          </select>
        </div>
      </div>
      <p className="text-xs text-gray-500">
        La contraseña se genera automáticamente y se muestra una sola vez al crear el buzón.
      </p>
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !local.trim()}
          className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {busy ? "Creando…" : "Crear buzón"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-500 hover:text-gray-700 px-2">
          Cancelar
        </button>
      </div>
    </form>
  );
}

function Modal({ children, onClose, title }: {
  children: React.ReactNode; onClose: () => void; title: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-gray-900 truncate pr-4">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
