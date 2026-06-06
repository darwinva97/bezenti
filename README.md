# Bezenti

**Monorepo** gestionado con **pnpm workspaces** + **Turborepo**.

```
bezenti/
├── apps/
│   ├── web/         # Astro (SSG) + PREACT + Tailwind v4, i18n y edge en Cloudflare
│   └── dashboard/   # TanStack Start SPA/CSR (React 19) + Tailwind v4
├── packages/
│   └── ui/          # @repo/ui — componentes React/Preact agnósticos + tema Tailwind
├── turbo.json       # orquestación de tareas (build, dev, typecheck…)
└── pnpm-workspace.yaml
```

- **`apps/web`** — la web pública: Astro estático, multiidioma con rutas
  traducidas (`/es/carrito`, `/en/cart`) y detección de idioma en el edge.
  Renderiza con **Preact** (`@astrojs/preact` con `compat: true`): consume
  `@repo/ui` con render estático (cero JS por defecto) e islas hidratadas con
  Preact mediante `client:*`.
- **`apps/dashboard`** — panel interno: **TanStack Start** configurado en modo
  **SPA (CSR)** (`spa.enabled`), React 19 con enrutado por ficheros en
  `src/routes/`. Consume `@repo/ui` directamente.
- **`packages/ui`** (`@repo/ui`) — librería de UI compartida y **agnóstica del
  motor**: componentes (`Button`, `Card`, `Counter`) escritos contra la API de
  React que funcionan **igual con React o con Preact**. El mismo `<Counter>` se
  hidrata con React en el dashboard y con Preact en la web. Incluye `styles.css`
  con `@import "tailwindcss"` + tokens del tema (`@theme`) y un `@source` que
  asegura el escaneo de sus clases desde cualquier app.

### ¿Cómo es agnóstica del motor `@repo/ui`?

- Es un paquete **source-only** (exporta `.ts/.tsx`): el bundler de cada app lo
  transpila con **su** JSX runtime → HMR instantáneo en todo el workspace.
- Los componentes **no importan React en runtime**: los tipos son `import type`
  (se borran al compilar) y los hooks llegan desde `react`, que en una app
  Preact se resuelve vía el alias **`preact/compat`**.
- Por eso `react`/`react-dom` son *peer dependencies* **opcionales**: una app
  React las aporta; una app Preact las satisface con `preact/compat` y no las
  instala (ver `apps/web`, que no depende de `react`).

## Comandos (desde la raíz)

```bash
pnpm install       # instalar dependencias de todo el workspace
pnpm dev           # turbo: dev de todas las apps en paralelo
pnpm build         # turbo: build de todas las apps (respeta dependencias)
pnpm typecheck     # turbo: typecheck de apps y paquetes
```

Para una sola app, usa el filtro de pnpm/turbo:

```bash
pnpm --filter web dev          # Astro          → http://localhost:4321
pnpm --filter dashboard dev    # TanStack (CSR)  → http://localhost:3000
```

> pnpm está configurado en `pnpm-workspace.yaml` con `minimumReleaseAge: 2880`
> (2 días): solo instala versiones publicadas hace ≥48 h, como mitigación de
> ataques de cadena de suministro.

## Desarrollo offline y despliegue

**Desarrollo 100% local / offline.** Una vez instaladas las dependencias
(`pnpm install`, único paso que requiere red), **ambas apps corren sin internet**:
`dev`, `build` y `typecheck` no hacen ninguna llamada de red. No hay fuentes ni
CDNs externos; la i18n, el tema y los componentes son locales. (Verificado
ejecutando los dev servers y el build dentro de un namespace de red aislado.)
Para evitar incluso la telemetría opcional, exporta
`ASTRO_TELEMETRY_DISABLED=1` y `TURBO_TELEMETRY_DISABLED=1`.

**Despliegue: ambas apps van a Cloudflare.**

```bash
pnpm --filter web deploy        # → Cloudflare Workers + Static Assets (SSG + Worker i18n)
pnpm --filter dashboard deploy  # → Cloudflare Workers Static Assets (SPA/CSR)
# Previsualización local con el runtime de Cloudflare (workerd):
pnpm --filter web cf:dev
pnpm --filter dashboard cf:dev
```

| App         | Salida build         | Cloudflare                                                        |
| ----------- | -------------------- | ----------------------------------------------------------------- |
| `web`       | `dist/` (estático)   | Workers + Static Assets; un Worker resuelve el idioma en `/`      |
| `dashboard` | `dist/client/` (SPA) | Workers Static Assets, `not_found_handling: single-page-application` |

El dashboard es CSR puro: **no** despliega Worker, solo assets estáticos. El
build copia el shell a `index.html` para que Cloudflare lo sirva como *fallback*
de cualquier ruta (p. ej. `/products`) y el router de TanStack resuelva en el
cliente. Config en cada `apps/<app>/wrangler.jsonc`.

---

# App `web` (Astro)

Sitio de **agencia digital** hecho con **Astro** (SSG) y **Tailwind CSS v4**,
multiidioma con **rutas traducidas y prefijo de idioma**. El contenido
(servicios, proyectos, blog) vive en **Astro Content Collections**. El idioma se
detecta en el **edge de Cloudflare** (Workers + Static Assets) leyendo el header
`Accept-Language`, manteniendo el sitio 100% estático. Las rutas de archivos de
esta sección son relativas a `apps/web/`.

## Arquitectura de URLs (decisión SEO)

- **Servicios: PLANOS y con keyword + geo** (como landings) → `/es/diseno-web-barcelona`, `/en/seo-agency-barcelona`.
- **Portafolio: ANIDADO por categoría** (hubs que rankean) → `/es/proyectos/web/omegastore`, `/en/projects/ecommerce/fastbuy`.
- **Blog: plano bajo `/blog`** → `/es/blog/seo-para-ecommerce`.

| Sección   | Español (es)                   | Inglés (en)                  |
| --------- | ------------------------------ | ---------------------------- |
| Inicio    | `/es`                          | `/en`                        |
| Servicios | `/es/servicios` (+ planas)     | `/en/services` (+ flat)      |
| Proyectos | `/es/proyectos/{cat}/{slug}`   | `/en/projects/{cat}/{slug}`  |
| Blog      | `/es/blog/{slug}`              | `/en/blog/{slug}`            |
| Contacto  | `/es/contacto`                 | `/en/contact`                |

La raíz `/` **no es una página**: el Worker la redirige (302) a `/es` o `/en`.
**Si no se detecta un idioma soportado, el destino es `/en`** (inglés por
defecto, también el `hreflang="x-default"`).

## Contenido: Astro Content Collections (`src/content.config.ts`)

- `services`, `projects` y `posts`, con frontmatter tipado por Zod e i18n
  (`locale`, `key` para unir traducciones, `slug` localizado).
- **Topics (etiquetas) transversales** (`src/i18n/topics.ts`): cada entrada
  declara `topics: []` (validados). Relacionan servicios ↔ proyectos ↔ posts:
  bloque "Relacionado" en cada ficha y **páginas de archivo por tag**
  (`/es/temas/{slug}` ↔ `/en/topics/{slug}`) que listan los tres tipos.
- **OpenGraph/Twitter** en cada página (`og:*`, `twitter:*`, `og:locale` +
  alternates), con imagen por defecto `public/og-default.png` y `ogImage`
  opcional por entrada. `og:type=article` en proyectos y posts.
- **Formulario de contacto funcional**: isla Preact (`ContactForm.tsx`,
  `client:load`) con validación + envío `fetch` a la función del Worker
  `POST /api/contact` (validación + honeypot). Para entrega real de email,
  conectar un proveedor (Resend/MailChannels) con un secreto del Worker.
- Una sola ruta **catch-all** `src/pages/[...slug].astro` genera todas las
  páginas de contenido (servicios planos, hubs de categoría, proyectos
  anidados, artículos) en ambos idiomas. Los índices y páginas estáticas tienen
  prioridad sobre la catch-all.
- Añadir contenido = soltar un `.md` en `src/content/<colección>/<locale>/`.
  Cada glob usa `generateId` con la carpeta de idioma para evitar colisiones de
  id entre `es/` y `en/`.

## Detección de idioma en el edge (`worker/index.ts`)

El despliegue usa **Cloudflare Workers + Static Assets** (la plataforma
recomendada por Cloudflare; sustituye a Pages para proyectos nuevos):

- `dist/` (el build de Astro) se sirve como **assets estáticos** desde la CDN.
- El Worker solo interviene en `/`: lee la **cookie `locale`** (preferencia
  explícita, tiene prioridad) o, si no hay, el header **`Accept-Language`**, y
  hace `302` a `/es` o `/en`. Guarda la elección en la cookie.
- Respuesta del redirect: `302` (no 301, porque el destino depende del usuario),
  con `Vary: Accept-Language` y `Cache-Control: no-store` para no servir un
  idioma cacheado a otro usuario.

Configuración en `wrangler.jsonc` (`assets.directory = ./dist`, binding
`ASSETS`, `run_worker_first: ["/"]`).

### SEO

- Cada idioma es alcanzable por URL directa (estático) + `hreflang` recíprocos
  y un `hreflang="x-default"` (→ idioma por defecto) emitidos en cada página.
- Como las versiones directas son rastreables, el redirect de `/` no impide a
  los buscadores ver el resto de idiomas.

## Cómo funciona la i18n (código)

Todo vive en `src/i18n/`:

- **`config.ts`** — idiomas (`es`, `en`) e idioma por defecto.
- **`routes.ts`** — mapa *clave de ruta* → *slug* por idioma (`cart → carrito`/`cart`).
- **`ui.ts`** — diccionarios de cadenas de interfaz.
- **`utils.ts`** — `useTranslations(locale)`, `getPath(locale, key)` (todas las
  URLs llevan prefijo de idioma) y `getAlternateLinks(key)`.

Cada página en `src/pages/<locale>/` renderiza una *vista* de
`src/components/views/` con su `locale`; la vista usa el `Layout`, que pinta
cabecera, selector de idioma, pie y los `hreflang`.

### Añadir un idioma

1. Añádelo en `locales`/`localeNames` (`config.ts`), `LOCALES` (`worker/index.ts`).
2. Añade su columna de slugs en `routes.ts` y sus cadenas en `ui.ts`.
3. Crea las páginas bajo `src/pages/<locale>/` rendereando cada vista.

### Añadir una página

1. Añade la `RouteKey` y sus slugs en `routes.ts`.
2. Añade las cadenas en `ui.ts`.
3. Crea la vista en `src/components/views/` y los ficheros de página por idioma.
