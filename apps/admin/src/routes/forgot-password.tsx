import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "../lib/auth";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    // redirectTo: página donde aterriza el usuario tras validar el token.
    const { error: err } = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (err) {
      setError(err.message ?? "No se pudo enviar el correo");
      return;
    }
    // No revelamos si el email existe o no: siempre mostramos éxito.
    setSent(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-gray-900">Bezenti</h1>
          <p className="text-sm text-gray-500 mt-1">Recupera tu contraseña</p>
        </div>

        {sent ? (
          <div className="space-y-4">
            <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              Si <strong>{email}</strong> tiene una cuenta, te enviamos un correo con el enlace para
              restablecer tu contraseña. Revisa tu bandeja (y spam). El enlace caduca en 1 hora.
            </div>
            <Link to="/login" className="block text-center text-sm text-blue-600 font-medium hover:underline">
              Volver a iniciar sesión
            </Link>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={handleSubmit}>
            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </div>
            )}
            <p className="text-sm text-gray-600">
              Ingresa tu email y te enviaremos un enlace para crear una nueva contraseña.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="tu@email.com" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50">
              {loading ? "Enviando..." : "Enviar enlace"}
            </button>
            <p className="text-sm text-gray-500 text-center">
              <Link to="/login" className="text-blue-600 font-medium hover:underline">
                Volver a iniciar sesión
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
