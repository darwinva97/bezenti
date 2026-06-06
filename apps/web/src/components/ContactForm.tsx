import { useState } from "react";

export interface ContactLabels {
  name: string;
  email: string;
  message: string;
  send: string;
  sending: string;
  success: string;
  error: string;
}

type Status = "idle" | "sending" | "ok" | "error";

const field =
  "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 transition-colors placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500/30";

/**
 * Isla interactiva (client:load) con validación en cliente y envío por fetch a
 * la función del Worker `/api/contact`. Escrita con la API de React; en esta
 * app corre con Preact vía `preact/compat` (igual que @repo/ui).
 */
export function ContactForm({ labels }: { labels: ContactLabels }) {
  const [status, setStatus] = useState<Status>("idle");

  async function submit(form: HTMLFormElement) {
    const data = Object.fromEntries(new FormData(form));
    setStatus("sending");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus("ok");
      form.reset();
    } catch {
      setStatus("error");
    }
  }

  if (status === "ok") {
    return (
      <p
        role="status"
        className="flex items-start gap-3 rounded-lg border border-success-100 bg-success-50 px-4 py-3 text-success-700"
      >
        <span aria-hidden="true" className="mt-0.5 text-success-600">
          ✓
        </span>
        {labels.success}
      </p>
    );
  }

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit(e.currentTarget);
      }}
    >
      {/* honeypot anti-spam: invisible para humanos, lo rellenan los bots */}
      <input
        type="text"
        name="company"
        tabIndex={-1}
        autoComplete="off"
        className="hidden"
        aria-hidden="true"
      />
      <div>
        <label className="block text-sm font-medium text-slate-700" htmlFor="name">
          {labels.name}
        </label>
        <input id="name" name="name" type="text" required className={field} />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700" htmlFor="email">
          {labels.email}
        </label>
        <input id="email" name="email" type="email" required className={field} />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700" htmlFor="message">
          {labels.message}
        </label>
        <textarea id="message" name="message" rows={4} required className={field} />
      </div>
      <div aria-live="polite">
        {status === "error" && (
          <p
            role="alert"
            className="rounded-lg border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-700"
          >
            {labels.error}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={status === "sending"}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-6 py-3 font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "sending" && (
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
          />
        )}
        {status === "sending" ? labels.sending : labels.send}
      </button>
    </form>
  );
}
