import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "../lib/auth";

export const Route = createFileRoute("/reset-password")({
  // better-auth redirige aquí con ?token=... (o ?error=INVALID_TOKEN si caducó).
  validateSearch: (search: Record<string, unknown>): { token?: string; error?: string } => ({
    token: typeof search["token"] === "string" ? search["token"] : undefined,
    error: typeof search["error"] === "string" ? search["error"] : undefined,
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const { token, error: tokenError } = Route.useSearch();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const linkInvalid = !token || !!tokenError;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres");
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden");
      return;
    }
    setLoading(true);
    const { error: err } = await authClient.resetPassword({ newPassword: password, token: token! });
    setLoading(false);
    if (err) {
      setError(err.message ?? "No se pudo cambiar la contraseña. Solicita un enlace nuevo.");
      return;
    }
    setDone(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-gray-900">Bezenti</h1>
          <p className="text-sm text-gray-500 mt-1">Nueva contraseña</p>
        </div>

        {done ? (
          <div className="space-y-4">
            <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              Tu contraseña se actualizó correctamente.
            </div>
            <button onClick={() => navigate({ to: "/login" })}
              className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
              Iniciar sesión
            </button>
          </div>
        ) : linkInvalid ? (
          <div className="space-y-4">
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              El enlace no es válido o caducó. Solicita uno nuevo.
            </div>
            <Link to="/forgot-password" className="block text-center text-sm text-blue-600 font-medium hover:underline">
              Pedir un enlace nuevo
            </Link>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={handleSubmit}>
            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nueva contraseña</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="••••••••" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Repite la contraseña</label>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="••••••••" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50">
              {loading ? "Guardando..." : "Cambiar contraseña"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
