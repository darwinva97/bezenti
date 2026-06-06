import { createFileRoute } from "@tanstack/react-router";
import { Button, Card } from "@repo/ui";

export const Route = createFileRoute("/products")({
  component: Products,
});

const PRODUCTS = [
  { id: "cuaderno", name: "Cuaderno artesanal", price: 12 },
  { id: "taza", name: "Taza de cerámica", price: 9 },
  { id: "bolsa", name: "Bolsa de algodón", price: 18 },
];

function Products() {
  const fmt = new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  });

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Productos
        </h1>
        <p className="mt-2 text-slate-600">
          Catálogo de ejemplo servido por el dashboard CSR.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PRODUCTS.map((p) => (
          <Card
            key={p.id}
            className="flex flex-col gap-4 transition-shadow hover:shadow-md"
          >
            <div>
              <h2 className="font-semibold text-slate-900">{p.name}</h2>
              <p className="mt-1 text-lg font-bold text-slate-900">
                {fmt.format(p.price)}
              </p>
            </div>
            <Button className="mt-auto w-full">Añadir al carrito</Button>
          </Card>
        ))}
      </div>
    </section>
  );
}
