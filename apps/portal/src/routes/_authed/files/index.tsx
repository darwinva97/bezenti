import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { PortalLayout } from "../index";

const API = import.meta.env["VITE_API_URL"] ?? "http://localhost:8787";

export const Route = createFileRoute("/_authed/files/")({
  component: FilesPage,
});

// ── Tipos y helpers ──────────────────────────────────────────────────────────

type Entry = {
  name: string;
  size: number;
  mtime: number;
  is_dir: boolean;
  mode: string;
  symlink: boolean;
};

type Account = { sftpHost: string | null; sftpUser: string | null };

type Clipboard = { mode: "copy" | "cut"; base: string; names: string[] };

type Upload = { name: string; pct: number; status: "uploading" | "done" | "error"; error?: string };

type SortKey = "name" | "size" | "mtime";

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

function joinPath(base: string, name: string): string {
  return base ? `${base}/${name}` : name;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = -1;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < units.length - 1);
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function fmtDate(unix: number): string {
  const d = new Date(unix * 1000);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "hace un momento";
  if (diff < 3_600_000) return `hace ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `hace ${Math.floor(diff / 3_600_000)} h`;
  return d.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" }) +
    " " + d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

const TEXT_EXTS = new Set([
  "txt", "md", "html", "htm", "css", "scss", "js", "mjs", "cjs", "ts", "tsx", "jsx", "json",
  "php", "py", "rb", "go", "rs", "java", "c", "h", "cpp", "sql", "sh", "bash", "zsh", "yml",
  "yaml", "toml", "ini", "conf", "cfg", "env", "xml", "svg", "csv", "log", "htaccess",
  "gitignore", "lock", "twig", "blade", "vue", "svelte", "astro", "graphql", "prisma",
]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "ico", "avif", "bmp"]);
const ARCHIVE_RE = /\.(zip|tar\.gz|tgz)$/i;
const MAX_EDIT_SIZE = 1.5 * 1024 * 1024;

function isTextFile(name: string): boolean {
  return TEXT_EXTS.has(ext(name)) || !name.includes(".") || name.startsWith(".");
}

// ── Iconos ───────────────────────────────────────────────────────────────────

function FileIcon({ entry }: { entry: Entry }) {
  const cls = "w-5 h-5 shrink-0";
  if (entry.is_dir) {
    return (
      <svg className={`${cls} text-amber-500`} viewBox="0 0 20 20" fill="currentColor">
        <path d="M2 5.5A1.5 1.5 0 013.5 4h4l2 2h7A1.5 1.5 0 0118 7.5v7A1.5 1.5 0 0116.5 16h-13A1.5 1.5 0 012 14.5v-9z" />
      </svg>
    );
  }
  const e = ext(entry.name);
  let color = "text-gray-400";
  if (IMAGE_EXTS.has(e)) color = "text-purple-500";
  else if (e === "php") color = "text-indigo-500";
  else if (["js", "mjs", "ts", "tsx", "jsx"].includes(e)) color = "text-yellow-500";
  else if (["html", "htm", "css", "scss"].includes(e)) color = "text-blue-500";
  else if (ARCHIVE_RE.test(entry.name)) color = "text-orange-500";
  return (
    <svg className={`${cls} ${color}`} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm6 0v3a1 1 0 001 1h3l-4-4z" clipRule="evenodd" />
    </svg>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────

function FilesPage() {
  const [path, setPath]           = useState("");
  const [entries, setEntries]     = useState<Entry[] | null>(null);
  const [error, setError]         = useState("");
  const [notice, setNotice]       = useState("");
  const [showHidden, setHidden]   = useState(false);
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [uploads, setUploads]     = useState<Upload[]>([]);
  const [sortKey, setSortKey]     = useState<SortKey>("name");
  const [sortAsc, setSortAsc]     = useState(true);
  const [dragOver, setDragOver]   = useState(false);
  const [account, setAccount]     = useState<Account | null>(null);
  const [busy, setBusy]           = useState(false);

  const [editor, setEditor]   = useState<{ path: string; name: string; content: string; isNew: boolean } | null>(null);
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  const [prompt, setPrompt]   = useState<{
    title: string; label: string; value: string; mono?: boolean;
    submitLabel: string; onSubmit: (value: string) => Promise<void>;
  } | null>(null);
  const [confirmDel, setConfirmDel] = useState<string[] | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const noHosting = error === "no hosting found";

  const load = useCallback(async (p: string) => {
    try {
      const data = await api<{ entries: Entry[] }>(`/portal/files/list?path=${encodeURIComponent(p)}`);
      setEntries(data.entries);
      setError("");
    } catch (e) {
      setEntries([]);
      setError(e instanceof Error ? e.message : "Error cargando archivos");
    }
  }, []);

  useEffect(() => {
    void load(path);
    setSelected(new Set());
  }, [path, load]);

  useEffect(() => {
    api<Account>("/portal/account").then(setAccount).catch(() => {});
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  const visible = useMemo(() => {
    if (!entries) return [];
    const rows = entries.filter((e) => showHidden || !e.name.startsWith("."));
    const dir = sortAsc ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      if (sortKey === "size") return (a.size - b.size) * dir;
      if (sortKey === "mtime") return (a.mtime - b.mtime) * dir;
      return a.name.localeCompare(b.name) * dir;
    });
  }, [entries, showHidden, sortKey, sortAsc]);

  const crumbs = path ? path.split("/") : [];

  function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    fn()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        setBusy(false);
        void load(path);
      });
  }

  // ── Operaciones ────────────────────────────────────────────────────────────

  function newFolder() {
    setPrompt({
      title: "Nueva carpeta", label: "Nombre", value: "", submitLabel: "Crear",
      onSubmit: async (name) => {
        await api(`/portal/files/mkdir`, { method: "POST", body: JSON.stringify({ path: joinPath(path, name) }) });
        setNotice(`Carpeta "${name}" creada`);
      },
    });
  }

  function newFile() {
    setPrompt({
      title: "Nuevo archivo", label: "Nombre (ej. index.php)", value: "", mono: true, submitLabel: "Crear y editar",
      onSubmit: async (name) => {
        setEditor({ path: joinPath(path, name), name, content: "", isNew: true });
      },
    });
  }

  function renameEntry(entry: Entry) {
    setPrompt({
      title: `Renombrar ${entry.is_dir ? "carpeta" : "archivo"}`, label: "Nuevo nombre",
      value: entry.name, mono: true, submitLabel: "Renombrar",
      onSubmit: async (name) => {
        if (name === entry.name) return;
        await api(`/portal/files/rename`, {
          method: "POST",
          body: JSON.stringify({ from: joinPath(path, entry.name), to: joinPath(path, name) }),
        });
        setNotice("Renombrado");
      },
    });
  }

  function chmodEntry(entry: Entry) {
    setPrompt({
      title: `Permisos de ${entry.name}`, label: "Modo octal (ej. 644, 755)",
      value: entry.mode, mono: true, submitLabel: "Aplicar",
      onSubmit: async (mode) => {
        await api(`/portal/files/chmod`, {
          method: "POST",
          body: JSON.stringify({ path: joinPath(path, entry.name), mode }),
        });
        setNotice(`Permisos de ${entry.name} → ${mode}`);
      },
    });
  }

  function extractEntry(entry: Entry) {
    run(async () => {
      await api(`/portal/files/extract`, {
        method: "POST",
        body: JSON.stringify({ path: joinPath(path, entry.name), dest: path }),
      });
      setNotice(`${entry.name} extraído aquí`);
    });
  }

  function deleteSelected(names: string[]) {
    setConfirmDel(names);
  }

  function doDelete(names: string[]) {
    setConfirmDel(null);
    run(async () => {
      await api(`/portal/files/delete`, {
        method: "POST",
        body: JSON.stringify({ paths: names.map((n) => joinPath(path, n)) }),
      });
      setNotice(names.length === 1 ? `"${names[0]}" eliminado` : `${names.length} elementos eliminados`);
      setSelected(new Set());
    });
  }

  function copyOrCut(mode: "copy" | "cut") {
    setClipboard({ mode, base: path, names: [...selected] });
    setNotice(`${selected.size} elemento(s) listos para ${mode === "copy" ? "copiar" : "mover"} — navega y pulsa Pegar`);
    setSelected(new Set());
  }

  function paste() {
    const clip = clipboard;
    if (!clip) return;
    run(async () => {
      for (const name of clip.names) {
        const from = joinPath(clip.base, name);
        const to   = joinPath(path, name);
        if (from === to) continue;
        await api(`/portal/files/${clip.mode === "copy" ? "copy" : "rename"}`, {
          method: "POST",
          body: JSON.stringify({ from, to }),
        });
      }
      setNotice(clip.mode === "copy" ? "Copiado" : "Movido");
      setClipboard(null);
    });
  }

  function downloadEntry(entry: Entry) {
    const p = encodeURIComponent(joinPath(path, entry.name));
    const url = entry.is_dir
      ? `${API}/portal/files/zip?path=${p}`
      : `${API}/portal/files/read?path=${p}&download=1`;
    const a = document.createElement("a");
    a.href = url;
    a.download = entry.name;
    a.click();
  }

  async function openEntry(entry: Entry) {
    if (entry.is_dir) {
      setPath(joinPath(path, entry.name));
      return;
    }
    const full = joinPath(path, entry.name);
    if (IMAGE_EXTS.has(ext(entry.name))) {
      const res = await fetch(`${API}/portal/files/read?path=${encodeURIComponent(full)}`, { credentials: "include" });
      if (!res.ok) { setError("No se pudo abrir la imagen"); return; }
      setPreview({ name: entry.name, url: URL.createObjectURL(await res.blob()) });
      return;
    }
    if (isTextFile(entry.name) && entry.size <= MAX_EDIT_SIZE) {
      const res = await fetch(`${API}/portal/files/read?path=${encodeURIComponent(full)}`, { credentials: "include" });
      if (!res.ok) { setError("No se pudo abrir el archivo"); return; }
      setEditor({ path: full, name: entry.name, content: await res.text(), isNew: false });
      return;
    }
    downloadEntry(entry);
  }

  // ── Subidas (XHR para barra de progreso real) ──────────────────────────────

  const uploadOne = useCallback((file: File, destPath: string) => {
    return new Promise<void>((resolve) => {
      const label = destPath;
      setUploads((u) => [...u, { name: label, pct: 0, status: "uploading" }]);
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", `${API}/portal/files/upload?path=${encodeURIComponent(destPath)}`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (ev) => {
        if (!ev.lengthComputable) return;
        const pct = Math.round((ev.loaded / ev.total) * 100);
        setUploads((u) => u.map((it) => (it.name === label ? { ...it, pct } : it)));
      };
      xhr.onload = () => {
        const ok = xhr.status >= 200 && xhr.status < 300;
        let err = "";
        if (!ok) {
          try { err = (JSON.parse(xhr.responseText) as { error?: string }).error ?? `Error ${xhr.status}`; }
          catch { err = `Error ${xhr.status}`; }
        }
        setUploads((u) => u.map((it) =>
          it.name === label ? { ...it, pct: 100, status: ok ? "done" : "error", error: err } : it,
        ));
        resolve();
      };
      xhr.onerror = () => {
        setUploads((u) => u.map((it) => (it.name === label ? { ...it, status: "error", error: "Error de red" } : it)));
        resolve();
      };
      xhr.send(file);
    });
  }, []);

  const uploadFiles = useCallback(async (items: { file: File; rel: string }[]) => {
    setUploads([]);
    for (const { file, rel } of items) {
      await uploadOne(file, joinPath(path, rel));
    }
    void load(path);
    setTimeout(() => setUploads((u) => (u.some((x) => x.status === "error") ? u : [])), 2500);
  }, [path, uploadOne, load]);

  function onInputFiles(list: FileList | null) {
    if (!list?.length) return;
    void uploadFiles([...list].map((f) => ({ file: f, rel: f.name })));
    if (fileInput.current) fileInput.current.value = "";
  }

  // Drag & drop con soporte de carpetas (webkitGetAsEntry)
  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const items = [...e.dataTransfer.items];
    const collected: { file: File; rel: string }[] = [];

    async function walk(entry: FileSystemEntry, prefix: string): Promise<void> {
      if (entry.isFile) {
        const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
        collected.push({ file, rel: prefix + entry.name });
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        let batch: FileSystemEntry[];
        do {
          batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
          for (const child of batch) await walk(child, prefix + entry.name + "/");
        } while (batch.length > 0);
      }
    }

    const toWalk = items
      .map((it) => (it.kind === "file" ? it.webkitGetAsEntry() : null))
      .filter((x): x is FileSystemEntry => x !== null);

    if (toWalk.length > 0) {
      for (const en of toWalk) await walk(en, "");
    } else {
      for (const f of [...e.dataTransfer.files]) collected.push({ file: f, rel: f.name });
    }
    if (collected.length) void uploadFiles(collected);
  }

  async function saveEditor() {
    const ed = editor;
    if (!ed) return;
    setBusy(true);
    try {
      const res = await fetch(`${API}/portal/files/upload?path=${encodeURIComponent(ed.path)}`, {
        method: "PUT",
        credentials: "include",
        body: ed.content,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data as { error?: string })?.error ?? `Error ${res.status}`);
      }
      setNotice(`${ed.name} guardado`);
      setEditor(null);
      void load(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (noHosting) {
    return (
      <PortalLayout>
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500">
          Aún no tienes un hosting activo.
        </div>
      </PortalLayout>
    );
  }

  const allSelected = visible.length > 0 && visible.every((e) => selected.has(e.name));
  const oneSelected = selected.size === 1 ? visible.find((e) => selected.has(e.name)) : undefined;

  return (
    <PortalLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-xl font-semibold text-gray-900">Archivos</h1>
          <div className="flex items-center gap-2 text-sm">
            <label className="flex items-center gap-1.5 text-gray-600 cursor-pointer select-none">
              <input type="checkbox" checked={showHidden} onChange={(e) => setHidden(e.target.checked)} className="rounded" />
              Ocultos
            </label>
            <button onClick={() => void load(path)} title="Refrescar"
              className="text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50">
              ⟳
            </button>
          </div>
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

        {/* Toolbar */}
        <div className="bg-white border border-gray-200 rounded-xl">
          <div className="flex items-center justify-between flex-wrap gap-2 px-4 py-2.5 border-b border-gray-100">
            {/* Breadcrumb */}
            <nav className="flex items-center gap-1 text-sm font-mono min-w-0 flex-wrap">
              <button onClick={() => setPath("")}
                className={`px-1.5 py-0.5 rounded hover:bg-gray-100 ${path === "" ? "text-gray-900 font-semibold" : "text-blue-600"}`}>
                /
              </button>
              {crumbs.map((seg, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <span className="text-gray-300">/</span>}
                  <button onClick={() => setPath(crumbs.slice(0, i + 1).join("/"))}
                    className={`px-1.5 py-0.5 rounded hover:bg-gray-100 truncate max-w-40 ${i === crumbs.length - 1 ? "text-gray-900 font-semibold" : "text-blue-600"}`}>
                    {seg}
                  </button>
                </span>
              ))}
            </nav>

            <div className="flex items-center gap-1.5 flex-wrap">
              {selected.size > 0 ? (
                <>
                  <span className="text-xs text-gray-500 mr-1">{selected.size} sel.</span>
                  {oneSelected && (
                    <ToolbarBtn onClick={() => renameEntry(oneSelected)}>Renombrar</ToolbarBtn>
                  )}
                  <ToolbarBtn onClick={() => copyOrCut("copy")}>Copiar</ToolbarBtn>
                  <ToolbarBtn onClick={() => copyOrCut("cut")}>Cortar</ToolbarBtn>
                  <ToolbarBtn danger onClick={() => deleteSelected([...selected])}>Eliminar</ToolbarBtn>
                </>
              ) : (
                <>
                  {clipboard && (
                    <ToolbarBtn primary onClick={paste}>
                      Pegar ({clipboard.names.length})
                    </ToolbarBtn>
                  )}
                  <ToolbarBtn onClick={newFolder}>+ Carpeta</ToolbarBtn>
                  <ToolbarBtn onClick={newFile}>+ Archivo</ToolbarBtn>
                  <ToolbarBtn primary onClick={() => fileInput.current?.click()}>↑ Subir</ToolbarBtn>
                  <input ref={fileInput} type="file" multiple className="hidden"
                    onChange={(e) => onInputFiles(e.target.files)} />
                </>
              )}
            </div>
          </div>

          {/* Tabla / dropzone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
            onDrop={onDrop}
            className={`relative ${dragOver ? "ring-2 ring-blue-400 ring-inset rounded-b-xl" : ""}`}
          >
            {dragOver && (
              <div className="absolute inset-0 z-10 bg-blue-50/80 flex items-center justify-center rounded-b-xl pointer-events-none">
                <p className="text-blue-700 font-medium text-sm">Suelta para subir aquí</p>
              </div>
            )}

            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  <th className="pl-4 py-2 w-8">
                    <input type="checkbox" checked={allSelected} className="rounded"
                      onChange={(e) => setSelected(e.target.checked ? new Set(visible.map((x) => x.name)) : new Set())} />
                  </th>
                  <SortHeader label="Nombre" k="name" sortKey={sortKey} asc={sortAsc} onSort={(k, a) => { setSortKey(k); setSortAsc(a); }} />
                  <SortHeader label="Tamaño" k="size" sortKey={sortKey} asc={sortAsc} onSort={(k, a) => { setSortKey(k); setSortAsc(a); }} className="w-24" />
                  <SortHeader label="Modificado" k="mtime" sortKey={sortKey} asc={sortAsc} onSort={(k, a) => { setSortKey(k); setSortAsc(a); }} className="w-44 hidden sm:table-cell" />
                  <th className="py-2 w-20 hidden md:table-cell font-medium">Permisos</th>
                  <th className="py-2 pr-4 w-44"></th>
                </tr>
              </thead>
              <tbody>
                {path !== "" && (
                  <tr className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                    onClick={() => setPath(crumbs.slice(0, -1).join("/"))}>
                    <td className="pl-4 py-2"></td>
                    <td className="py-2 text-gray-500" colSpan={5}>
                      <span className="font-mono">..</span>
                    </td>
                  </tr>
                )}
                {entries === null ? (
                  <tr><td colSpan={6} className="py-10 text-center text-gray-400">Cargando…</td></tr>
                ) : visible.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-gray-400">
                      Carpeta vacía — arrastra archivos aquí o usa “Subir”
                    </td>
                  </tr>
                ) : (
                  visible.map((entry) => (
                    <tr key={entry.name} className={`border-b border-gray-50 hover:bg-gray-50 group ${selected.has(entry.name) ? "bg-blue-50/60" : ""}`}>
                      <td className="pl-4 py-2">
                        <input type="checkbox" checked={selected.has(entry.name)} className="rounded"
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(entry.name); else next.delete(entry.name);
                            setSelected(next);
                          }} />
                      </td>
                      <td className="py-2">
                        <button onClick={() => void openEntry(entry)} className="flex items-center gap-2 text-left min-w-0 max-w-full">
                          <FileIcon entry={entry} />
                          <span className={`truncate font-mono text-[13px] ${entry.is_dir ? "text-gray-900 font-medium" : "text-gray-700"} group-hover:text-blue-700`}>
                            {entry.name}{entry.symlink && <span className="text-gray-400"> ↪</span>}
                          </span>
                        </button>
                      </td>
                      <td className="py-2 text-gray-500 tabular-nums">{entry.is_dir ? "—" : humanSize(entry.size)}</td>
                      <td className="py-2 text-gray-500 hidden sm:table-cell">{fmtDate(entry.mtime)}</td>
                      <td className="py-2 hidden md:table-cell">
                        <button onClick={() => chmodEntry(entry)} title="Cambiar permisos"
                          className="font-mono text-xs text-gray-400 hover:text-gray-700 hover:underline">
                          {entry.mode}
                        </button>
                      </td>
                      <td className="py-2 pr-4">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs">
                          {ARCHIVE_RE.test(entry.name) && (
                            <button onClick={() => extractEntry(entry)} className="text-orange-600 hover:text-orange-800">Extraer</button>
                          )}
                          <button onClick={() => downloadEntry(entry)} className="text-blue-600 hover:text-blue-800">
                            {entry.is_dir ? "Zip" : "Descargar"}
                          </button>
                          <button onClick={() => renameEntry(entry)} className="text-gray-500 hover:text-gray-800">Renombrar</button>
                          <button onClick={() => deleteSelected([entry.name])} className="text-red-500 hover:text-red-700">Eliminar</button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Progreso de subidas */}
        {uploads.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
            <p className="text-sm font-medium text-gray-800">Subiendo {uploads.length} archivo(s)</p>
            {uploads.map((u) => (
              <div key={u.name} className="text-xs">
                <div className="flex justify-between text-gray-600 mb-0.5">
                  <span className="font-mono truncate">{u.name}</span>
                  <span>{u.status === "error" ? <span className="text-red-600">{u.error}</span> : u.status === "done" ? "✓" : `${u.pct}%`}</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full transition-all ${u.status === "error" ? "bg-red-400" : "bg-blue-500"}`} style={{ width: `${u.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* SFTP */}
        {account?.sftpHost && (
          <details className="bg-gray-50 border border-gray-200 rounded-xl px-5 py-4 text-sm">
            <summary className="font-medium text-gray-800 cursor-pointer select-none">Acceso SFTP (avanzado)</summary>
            <div className="grid sm:grid-cols-3 gap-3 mt-3 text-gray-700">
              <div><p className="text-xs text-gray-500">Host</p><code className="font-mono">{account.sftpHost}</code></div>
              <div><p className="text-xs text-gray-500">Puerto</p><code className="font-mono">22</code></div>
              <div><p className="text-xs text-gray-500">Usuario</p><code className="font-mono">{account.sftpUser}</code></div>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              La contraseña SFTP se te entregó al activar tu hosting. Clientes recomendados: FileZilla, Cyberduck, WinSCP.
            </p>
          </details>
        )}
      </div>

      {/* Modales */}
      {prompt && (
        <Modal onClose={() => setPrompt(null)} title={prompt.title}>
          <form onSubmit={(e) => {
            e.preventDefault();
            const value = prompt.value.trim();
            if (!value) return;
            const fn = prompt.onSubmit;
            setPrompt(null);
            run(() => fn(value));
          }} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">{prompt.label}</label>
              <input autoFocus value={prompt.value}
                onChange={(e) => setPrompt({ ...prompt, value: e.target.value })}
                className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${prompt.mono ? "font-mono" : ""}`} />
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setPrompt(null)} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">Cancelar</button>
              <button type="submit" disabled={busy || !prompt.value.trim()}
                className="bg-blue-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {prompt.submitLabel}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmDel && (
        <Modal onClose={() => setConfirmDel(null)} title="Confirmar eliminación">
          <p className="text-sm text-gray-600">
            Vas a eliminar <strong>{confirmDel.length === 1 ? `"${confirmDel[0]}"` : `${confirmDel.length} elementos`}</strong>.
            Las carpetas se eliminan con todo su contenido. Esta acción no se puede deshacer.
          </p>
          <div className="flex gap-2 justify-end mt-4">
            <button onClick={() => setConfirmDel(null)} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">Cancelar</button>
            <button onClick={() => doDelete(confirmDel)} disabled={busy}
              className="bg-red-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-red-700 disabled:opacity-50">
              Eliminar
            </button>
          </div>
        </Modal>
      )}

      {preview && (
        <Modal onClose={() => { URL.revokeObjectURL(preview.url); setPreview(null); }} title={preview.name} wide>
          <img src={preview.url} alt={preview.name} className="max-h-[70vh] mx-auto rounded-lg" />
        </Modal>
      )}

      {editor && (
        <Modal onClose={() => setEditor(null)} title={`${editor.isNew ? "Nuevo: " : ""}${editor.path}`} wide>
          <textarea
            autoFocus
            value={editor.content}
            spellCheck={false}
            onChange={(e) => setEditor({ ...editor, content: e.target.value })}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); void saveEditor(); }
              if (e.key === "Tab") {
                e.preventDefault();
                const el = e.currentTarget;
                const { selectionStart: s, selectionEnd: en } = el;
                const next = editor.content.slice(0, s) + "  " + editor.content.slice(en);
                setEditor({ ...editor, content: next });
                requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; });
              }
            }}
            className="w-full h-[60vh] font-mono text-[13px] leading-5 border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none bg-gray-50"
          />
          <div className="flex items-center justify-between mt-3">
            <p className="text-xs text-gray-400">{editor.content.length.toLocaleString()} caracteres · Ctrl+S para guardar</p>
            <div className="flex gap-2">
              <button onClick={() => setEditor(null)} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">Cancelar</button>
              <button onClick={() => void saveEditor()} disabled={busy}
                className="bg-blue-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {busy ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </PortalLayout>
  );
}

// ── Componentes auxiliares ───────────────────────────────────────────────────

function ToolbarBtn({ children, onClick, primary, danger }: {
  children: React.ReactNode; onClick: () => void; primary?: boolean; danger?: boolean;
}) {
  const style = primary
    ? "bg-blue-600 border-blue-600 text-white hover:bg-blue-700"
    : danger
      ? "border-red-200 text-red-600 hover:bg-red-50"
      : "border-gray-200 text-gray-700 hover:bg-gray-50";
  return (
    <button onClick={onClick} className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${style}`}>
      {children}
    </button>
  );
}

function SortHeader({ label, k, sortKey, asc, onSort, className }: {
  label: string; k: SortKey; sortKey: SortKey; asc: boolean;
  onSort: (k: SortKey, asc: boolean) => void; className?: string;
}) {
  const active = sortKey === k;
  return (
    <th className={`py-2 font-medium ${className ?? ""}`}>
      <button onClick={() => onSort(k, active ? !asc : true)}
        className={`flex items-center gap-1 hover:text-gray-800 ${active ? "text-gray-800" : ""}`}>
        {label}{active && <span className="text-[10px]">{asc ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
}

function Modal({ children, onClose, title, wide }: {
  children: React.ReactNode; onClose: () => void; title: string; wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`bg-white rounded-xl shadow-xl w-full ${wide ? "max-w-4xl" : "max-w-md"} p-5`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-gray-900 font-mono truncate pr-4">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
