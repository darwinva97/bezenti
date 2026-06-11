import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { PortalLayout } from "../index";

const API = import.meta.env["VITE_API_URL"] ?? "http://localhost:8787";

export const Route = createFileRoute("/_authed/projects/")({
  component: ProjectsPage,
});

type Project = {
  id: string;
  name: string;
  domain: string;
  subdomain: string | null;
  phpVersion: string;
  status: string;
};

type Account = {
  accountSlug: string;
  pagesDomain: string;
  dbHost: string | null;
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

function slugifyLocal(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function ProjectsPage() {
  const [account, setAccount] = useState<Account | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noHosting, setNoHosting] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [acc, rows] = await Promise.all([
        api<Account>("/portal/account"),
        api<Project[]>("/portal/projects"),
      ]);
      setAccount(acc);
      setProjects(rows);
    } catch (err) {
      if (err instanceof Error && err.message === "no hosting found") {
        setNoHosting(true);
      } else {
        setError(err instanceof Error ? err.message : "Error cargando proyectos");
      }
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <PortalLayout>
      <div className="space-y-6">
        <h1 className="text-xl font-semibold text-gray-900">Proyectos</h1>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {noHosting ? (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400 text-sm">
            Aún no tienes un hosting activo. Contrata un plan para crear proyectos.
          </div>
        ) : account && projects ? (
          <>
            <AccountSlugCard account={account} hasProjects={projects.length > 0} onChanged={reload} />
            <NewProjectForm account={account} onCreated={reload} />
            <ProjectsTable account={account} projects={projects} onChanged={reload} />
          </>
        ) : (
          !error && <p className="text-sm text-gray-400">Cargando…</p>
        )}
      </div>
    </PortalLayout>
  );
}

function AccountSlugCard({
  account,
  hasProjects,
  onChanged,
}: {
  account: Account;
  hasProjects: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(account.accountSlug);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api("/portal/account/slug", {
        method: "PATCH",
        body: JSON.stringify({ slug: value.trim() }),
      });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-900">Slug de tu cuenta</h2>
        {!editing && (
          <button
            onClick={() => {
              setValue(account.accountSlug);
              setEditing(true);
            }}
            className="text-sm text-blue-600 hover:text-blue-700"
          >
            Editar
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              value={value}
              onChange={(e) => setValue(slugifyLocal(e.target.value))}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={save}
              disabled={saving || !value.trim()}
              className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Guardando…" : "Guardar"}
            </button>
            <button onClick={() => setEditing(false)} className="text-sm text-gray-500 hover:text-gray-700 px-2">
              Cancelar
            </button>
          </div>
          {hasProjects && (
            <p className="text-xs text-amber-600">
              Cambiar el slug renombra las direcciones de TODOS tus proyectos.
            </p>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="text-sm text-gray-600">
          Tus proyectos viven bajo{" "}
          <code className="bg-gray-50 border border-gray-200 rounded px-1.5 py-0.5 font-mono text-xs text-gray-800">
            &lt;proyecto&gt;--{account.accountSlug}.{account.pagesDomain}
          </code>
        </div>
      )}
    </div>
  );
}

function NewProjectForm({ account, onCreated }: { account: Account; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [subdomainTouched, setSubdomainTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveSubdomain = subdomainTouched ? subdomain : slugifyLocal(name);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api("/portal/projects", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), subdomain: effectiveSubdomain }),
      });
      setOpen(false);
      setName("");
      setSubdomain("");
      setSubdomainTouched(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el proyecto");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div>
        <button
          onClick={() => setOpen(true)}
          className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          + Nuevo proyecto
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={create} className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
      <h2 className="text-sm font-medium text-gray-900">Nuevo proyecto</h2>
      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Mi tienda"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Subdominio</label>
          <input
            value={effectiveSubdomain}
            onChange={(e) => {
              setSubdomainTouched(true);
              setSubdomain(slugifyLocal(e.target.value));
            }}
            required
            placeholder="mi-tienda"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
      {effectiveSubdomain && (
        <p className="text-xs text-gray-500">
          Tu sitio:{" "}
          <code className="font-mono text-gray-800">
            {effectiveSubdomain}--{account.accountSlug}.{account.pagesDomain}
          </code>
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || !name.trim() || !effectiveSubdomain}
          className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Creando…" : "Crear proyecto"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-500 hover:text-gray-700 px-2">
          Cancelar
        </button>
      </div>
    </form>
  );
}

function ProjectsTable({
  account,
  projects,
  onChanged,
}: {
  account: Account;
  projects: Project[];
  onChanged: () => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function rename(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api(`/portal/projects/${id}/subdomain`, {
        method: "PATCH",
        body: JSON.stringify({ subdomain: value.trim() }),
      });
      setRenaming(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo renombrar");
    } finally {
      setBusy(null);
    }
  }

  async function remove(p: Project) {
    if (!confirm(`¿Eliminar el proyecto "${p.name}"? Sus archivos se conservan en el servidor.`)) return;
    setBusy(p.id);
    setError(null);
    try {
      await api(`/portal/projects/${p.id}`, { method: "DELETE" });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Proyecto</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Dirección</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">PHP</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {projects.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                  Aún no tienes proyectos — crea el primero
                </td>
              </tr>
            )}
            {projects.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3 text-gray-900">{p.name}</td>
                <td className="px-4 py-3">
                  {renaming === p.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        value={value}
                        onChange={(e) => setValue(slugifyLocal(e.target.value))}
                        className="px-2 py-1 border border-gray-300 rounded-lg text-sm font-mono w-40 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-xs text-gray-400 font-mono">
                        --{account.accountSlug}.{account.pagesDomain}
                      </span>
                      <button
                        onClick={() => rename(p.id)}
                        disabled={busy === p.id || !value.trim()}
                        className="text-blue-600 hover:text-blue-700 text-sm disabled:opacity-50"
                      >
                        {busy === p.id ? "…" : "Guardar"}
                      </button>
                      <button onClick={() => setRenaming(null)} className="text-gray-400 hover:text-gray-600 text-sm">
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <code className="font-mono text-xs text-gray-800">{p.domain}</code>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600">{p.phpVersion}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {renaming !== p.id && (
                    <>
                      {p.subdomain && (
                        <button
                          onClick={() => {
                            setRenaming(p.id);
                            setValue(p.subdomain ?? "");
                          }}
                          className="text-sm text-blue-600 hover:text-blue-700 mr-3"
                        >
                          Renombrar
                        </button>
                      )}
                      <button
                        onClick={() => remove(p)}
                        disabled={busy === p.id}
                        className="text-sm text-red-500 hover:text-red-600 disabled:opacity-50"
                      >
                        {busy === p.id ? "…" : "Eliminar"}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
