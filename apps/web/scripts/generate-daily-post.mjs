#!/usr/bin/env node
/**
 * Bot de post diario. Toma el siguiente tema de post-queue.json, escribe el
 * artículo (es + en) con Workers AI (Llama), genera la portada con Flux, crea
 * los .md y las imágenes, y mueve el tema a `used`.
 *
 * Env: CF_ACCOUNT_ID, CF_API_TOKEN. Opcional: GITHUB_OUTPUT, POST_OUT.
 * Corre desde la raíz del repo. Imagen recortada con ImageMagick (`convert`).
 */
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ACC = process.env.CF_ACCOUNT_ID;
const TOK = process.env.CF_API_TOKEN;
const BASE = "apps/web";
const QUEUE = `${BASE}/scripts/post-queue.json`;
const TEXT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const IMG_MODEL = "@cf/black-forest-labs/flux-1-schnell";

if (!ACC || !TOK) {
  console.error("Faltan CF_ACCOUNT_ID / CF_API_TOKEN");
  process.exit(1);
}

const SYS = {
  es: "Eres el redactor de Bezenti, una agencia digital. Voz: precisa, solvente, cercana. Escribes claro y concreto, sin palabras de marketing huecas (prohibido: potenciar, revolucionar, llave en mano, sinergia, soluciones, ecosistema). Sin guiones largos. Segunda persona ('tu negocio'). Público: dueños de pymes. Optimizas para SEO de forma natural, con encabezados ## útiles, alguna lista, y una conclusión con llamada a la accion suave para escribir a Bezenti. Entre 650 y 900 palabras. No inventes cifras ni estudios.",
  en: "You are the copywriter for Bezenti, a digital agency. Voice: precise, solid, close. You write clearly and concretely, no hollow marketing words (banned: leverage, supercharge, turnkey, synergy, seamless, world-class). No em dashes. Second person ('your business'). Audience: small business owners. You optimize for SEO naturally, with useful ## headings, the occasional list, and a closing with a soft call to action to write to Bezenti. Between 650 and 900 words. Do not invent figures or studies.",
};

const ask = {
  es: (t) => `Escribe un artículo de blog titulado "${t}".\nDevuelve EXACTAMENTE este formato:\nDESCRIPCION: <una frase de máximo 150 caracteres para meta description SEO>\n---\n<cuerpo del artículo en Markdown, empezando por un párrafo de entrada, SIN repetir el título como H1>`,
  en: (t) => `Write a blog article titled "${t}".\nReturn EXACTLY this format:\nDESCRIPCION: <one sentence, max 150 characters, for the SEO meta description>\n---\n<the article body in Markdown, starting with a lead paragraph, WITHOUT repeating the title as an H1>`,
};

function imBin() {
  for (const b of ["magick", "convert"]) {
    try {
      execFileSync(b, ["-version"], { stdio: "ignore" });
      return b;
    } catch {}
  }
  throw new Error("ImageMagick (magick/convert) no encontrado");
}
const IM = imBin();

const slugify = (s) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function aiRun(model, body, attempt = 0) {
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACC}/ai/run/${model}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOK}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    if (!j.success) throw new Error(JSON.stringify(j.errors || j));
    return j.result;
  } catch (e) {
    if (attempt < 3) {
      await sleep(8000 * (attempt + 1));
      return aiRun(model, body, attempt + 1);
    }
    throw e;
  }
}

function cleanBody(text) {
  let body = text;
  const parts = text.split(/\n-{3,}\n/);
  if (parts.length > 1 && /DESCRIPCION|DESCRIPTION/i.test(parts[0])) body = parts.slice(1).join("\n---\n");
  body = body.replace(/```(markdown)?/gi, "").replace(/^#\s+.*\n+/m, "").replace(/—/g, ", ").trim();
  return body;
}

function extractDescription(text, body, max = 155) {
  const m = text.match(/DESCRIPCION:\s*(.+)/i) || text.match(/DESCRIPTION:\s*(.+)/i);
  let d = m ? m[1].trim() : "";
  if (!d) d = (body.replace(/[#*_>`\-]/g, "").split(/(?<=[.!?])\s/)[0] || "").trim();
  if (d.length > max) d = d.slice(0, max).replace(/\s+\S*$/, "") + "…";
  return d.replace(/"/g, "'");
}

async function genArticle(locale, title) {
  const r = await aiRun(TEXT_MODEL, {
    messages: [
      { role: "system", content: SYS[locale] },
      { role: "user", content: ask[locale](title) },
    ],
    max_tokens: 2048,
    temperature: 0.7,
  });
  const text = (r.response || "").trim();
  const body = cleanBody(text);
  const description = extractDescription(text, body);
  return { description, body };
}

async function genImage(item) {
  const prompt =
    "Flat minimalist vector illustration, deep navy background (#0f172a), a few large clean outlined geometric symbols centered with lots of empty space, accents in blue (#1f6feb) coral (#f26a5a) and teal (#2bb7a6), calm and professional. ABSOLUTELY NO text, no letters, no numbers, no people. Simple conceptual symbol about: " +
    item.en;
  const r = await aiRun(IMG_MODEL, { prompt, steps: 6 });
  const b64 = r.image;
  if (!b64) throw new Error("Flux no devolvió imagen");
  const src = `/tmp/cover-${item.key}.jpg`;
  writeFileSync(src, Buffer.from(b64, "base64"));
  const dir = `${BASE}/public/images/posts`;
  mkdirSync(dir, { recursive: true });
  const cover = `${dir}/${item.key}-cover.jpg`;
  const card = `${dir}/${item.key}-card.jpg`;
  execFileSync(IM, [src, "-resize", "1600x900^", "-gravity", "center", "-extent", "1600x900", "-quality", "86", cover]);
  execFileSync(IM, [src, "-resize", "800x800^", "-gravity", "center", "-extent", "800x800", "-quality", "86", card]);
  return { cover: `/images/posts/${item.key}-cover.jpg`, card: `/images/posts/${item.key}-card.jpg` };
}

function writePost(locale, item, title, description, body, images) {
  const slug = slugify(title);
  const today = new Date().toISOString().slice(0, 10);
  const fm = [
    "---",
    `locale: ${locale}`,
    `key: ${item.key}`,
    `topics: [${item.topics.join(", ")}]`,
    `category: ${item.category}`,
    `image: ${images.cover}`,
    `cardImage: ${images.card}`,
    `imageAlt: "${title.replace(/"/g, "'")}"`,
    `slug: ${slug}`,
    `title: "${title.replace(/"/g, "'")}"`,
    `description: "${description}"`,
    `pubDate: ${today}`,
    "---",
    "",
    body,
    "",
  ].join("\n");
  writeFileSync(`${BASE}/src/content/posts/${locale}/${item.key}.md`, fm);
  return { slug, title, description };
}

async function main() {
  const queue = JSON.parse(readFileSync(QUEUE, "utf8"));
  const item = (queue.pending || [])[0];
  const out = process.env.GITHUB_OUTPUT;
  if (!item) {
    console.log("Cola vacía: no hay tema pendiente. Añade items a post-queue.json.");
    if (out) appendFileSync(out, "generated=false\n");
    return;
  }
  console.log(`Generando post: ${item.key} (${item.category})`);

  const images = await genImage(item);
  const es = await genArticle("es", item.es);
  const en = await genArticle("en", item.en);
  const pes = writePost("es", item, item.es, es.description, es.body, images);
  const pen = writePost("en", item, item.en, en.description, en.body, images);

  queue.pending.shift();
  queue.used = queue.used || [];
  queue.used.push({ ...item, publishedAt: new Date().toISOString().slice(0, 10) });
  writeFileSync(QUEUE, JSON.stringify(queue, null, 2) + "\n");

  const payload = { post: { es: pes, en: pen } };
  if (process.env.POST_OUT) writeFileSync(process.env.POST_OUT, JSON.stringify(payload));
  if (out) {
    appendFileSync(out, "generated=true\n");
    appendFileSync(out, `key=${item.key}\n`);
    appendFileSync(out, `title=${item.es.replace(/\n/g, " ")}\n`);
  }
  console.log(`OK: ${item.key} — es:"${pes.title}" / en:"${pen.title}"`);
}

main().catch((e) => {
  console.error("FALLO:", e);
  process.exit(1);
});
