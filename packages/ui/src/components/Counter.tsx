import { useState } from "react";
import { Button } from "./Button";
import { Card } from "./Card";

export interface CounterProps {
  title?: string;
  description?: string;
  initial?: number;
}

/**
 * Componente INTERACTIVO compartido y agnóstico del motor.
 *
 * `useState` se importa desde "react", pero en tiempo de ejecución cada app
 * decide el motor: en una app React resuelve a React; en una app Preact, el
 * alias `react` -> `preact/compat` lo resuelve a los hooks de Preact. El mismo
 * archivo funciona en ambos sin cambios.
 */
export function Counter({
  title = "Contador interactivo",
  description = "Renderizado y manejado 100% en el cliente.",
  initial = 0,
}: CounterProps) {
  const [count, setCount] = useState(initial);

  return (
    <Card className="max-w-md">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
      <div className="mt-4 flex items-center gap-4">
        <Button onClick={() => setCount((c) => c + 1)}>Sumar</Button>
        <Button variant="ghost" onClick={() => setCount(initial)}>
          Reiniciar
        </Button>
        <span className="text-2xl font-bold tabular-nums text-brand-600">
          {count}
        </span>
      </div>
    </Card>
  );
}
