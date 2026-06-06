/**
 * Genera portadas abstractas de marca (SVG) para los servicios sin foto.
 * Fondo navy oscuro + motivo geométrico único por servicio en el color de su
 * categoría. Pensadas para verse bien oscurecidas en el hero (object-cover,
 * opacity-50 bajo un degradado slate-950) y como miniatura al hover.
 * Salida: scripts/.covers/<key>.svg  (luego se rasteriza a /images/services/<key>.jpg)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, ".covers");
mkdirSync(OUT, { recursive: true });

const W = 1600, H = 1000;

// PRNG determinista por semilla (mulberry32).
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Paletas por categoría: acento + acento claro.
const PAL = {
  brand: { a: "#2e74ee", b: "#84a8f7" },
  coral: { a: "#f26a5a", b: "#f9a193" },
  amber: { a: "#ffc247", b: "#ffd98a" },
  teal:  { a: "#2bb7a6", b: "#7fded1" },
};

const f = (n) => Number(n.toFixed(1));

// --- Motivos (devuelven <g> con trazos en color `c`) ---
function rings(c, r) {
  const cx = f(W * (0.62 + r() * 0.2)), cy = f(H * (0.4 + r() * 0.2));
  let s = "";
  for (let i = 12; i >= 1; i--)
    s += `<circle cx="${cx}" cy="${cy}" r="${i * 70}" fill="none" stroke="${c}" stroke-width="2" opacity="${f(0.05 + (12 - i) * 0.016)}"/>`;
  return s;
}
function grid(c) {
  let s = "";
  for (let x = 120; x < W; x += 120) s += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${c}" stroke-width="1.5" opacity="0.10"/>`;
  for (let y = 120; y < H; y += 120) s += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${c}" stroke-width="1.5" opacity="0.10"/>`;
  for (let x = 120; x < W; x += 120) for (let y = 120; y < H; y += 120)
    s += `<circle cx="${x}" cy="${y}" r="3.5" fill="${c}" opacity="0.30"/>`;
  return s;
}
function diagonal(c) {
  let s = "";
  for (let i = -10; i < 26; i++) {
    const x = i * 90;
    s += `<line x1="${x}" y1="0" x2="${x + H}" y2="${H}" stroke="${c}" stroke-width="${i % 3 === 0 ? 6 : 2}" opacity="${i % 3 === 0 ? 0.16 : 0.08}"/>`;
  }
  return s;
}
function arches(c) {
  let s = "";
  for (let i = 14; i >= 1; i--)
    s += `<circle cx="0" cy="${H}" r="${i * 130}" fill="none" stroke="${c}" stroke-width="2.5" opacity="${f(0.05 + (14 - i) * 0.013)}"/>`;
  return s;
}
function dots(c, r) {
  let s = "";
  for (let i = 0; i < 90; i++) {
    const x = f(r() * W), y = f(r() * H), rad = f(3 + r() * 16);
    s += `<circle cx="${x}" cy="${y}" r="${rad}" fill="${c}" opacity="${f(0.06 + r() * 0.22)}"/>`;
  }
  return s;
}
function orbit(c, r) {
  const cx = f(W * 0.66), cy = f(H * 0.5);
  let s = "";
  for (let i = 1; i <= 5; i++) {
    const rot = f(r() * 180);
    s += `<ellipse cx="${cx}" cy="${cy}" rx="${i * 130}" ry="${i * 56}" fill="none" stroke="${c}" stroke-width="2" opacity="0.16" transform="rotate(${rot} ${cx} ${cy})"/>`;
  }
  s += `<circle cx="${cx}" cy="${cy}" r="22" fill="${c}" opacity="0.9"/>`;
  for (let i = 0; i < 5; i++) {
    const ang = r() * Math.PI * 2, rr = 130 + r() * 520;
    s += `<circle cx="${f(cx + Math.cos(ang) * rr)}" cy="${f(cy + Math.sin(ang) * rr * 0.45)}" r="9" fill="${c}" opacity="0.7"/>`;
  }
  return s;
}
function nodes(c, r) {
  const pts = Array.from({ length: 11 }, () => ({ x: f(120 + r() * (W - 240)), y: f(120 + r() * (H - 240)) }));
  let s = "";
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (d < 460) s += `<line x1="${pts[i].x}" y1="${pts[i].y}" x2="${pts[j].x}" y2="${pts[j].y}" stroke="${c}" stroke-width="1.5" opacity="${f(0.04 + (460 - d) / 460 * 0.16)}"/>`;
    }
  for (const p of pts) s += `<circle cx="${p.x}" cy="${p.y}" r="8" fill="${c}" opacity="0.75"/>`;
  return s;
}
function bars(c, r) {
  let s = "";
  const n = 16, bw = f(W / n);
  for (let i = 0; i < n; i++) {
    const h = f(120 + r() * 620), x = f(i * bw + bw * 0.2), w = f(bw * 0.6);
    s += `<rect x="${x}" y="${H - h}" width="${w}" height="${h}" rx="${f(w / 2)}" fill="${c}" opacity="${f(0.08 + r() * 0.16)}"/>`;
  }
  return s;
}
function waves(c, r) {
  let s = "";
  for (let k = 0; k < 7; k++) {
    const base = f(140 + k * 120), amp = f(40 + r() * 60);
    let d = `M -50 ${base}`;
    for (let x = 0; x <= W + 100; x += 100)
      d += ` Q ${x + 50} ${f(base + (Math.sin(x / 160 + k) > 0 ? -amp : amp))} ${x + 100} ${base}`;
    s += `<path d="${d}" fill="none" stroke="${c}" stroke-width="2.5" opacity="0.13"/>`;
  }
  return s;
}

const MOTIF = { rings, grid, diagonal, arches, dots, orbit, nodes, bars, waves };

// Servicio -> categoría visual + motivo. (15 nuevos, todos distintos.)
const SERVICES = [
  { key: "web-wordpress",      pal: "brand", motif: "grid" },
  { key: "web-corporate",      pal: "brand", motif: "rings" },
  { key: "web-custom",         pal: "brand", motif: "diagonal" },
  { key: "web-institutional",  pal: "brand", motif: "arches" },
  { key: "ecommerce-design",   pal: "coral", motif: "rings" },
  { key: "ecommerce-wordpress",pal: "coral", motif: "grid" },
  { key: "ecommerce-shopify",  pal: "coral", motif: "dots" },
  { key: "sem",                pal: "amber", motif: "diagonal" },
  { key: "google-ads",         pal: "amber", motif: "rings" },
  { key: "meta-ads",           pal: "amber", motif: "dots" },
  { key: "seo-wordpress",      pal: "amber", motif: "grid" },
  { key: "geo-ai-seo",         pal: "amber", motif: "orbit" },
  { key: "crm",                pal: "teal",  motif: "nodes" },
  { key: "erp",                pal: "teal",  motif: "bars" },
  { key: "logistics",          pal: "teal",  motif: "waves" },
];

SERVICES.forEach((sv, i) => {
  const { a, b } = PAL[sv.pal];
  const r = rng(i * 2654435761 + 1013904223);
  const glowX = f(W * (0.55 + r() * 0.35)), glowY = f(H * (0.25 + r() * 0.4));
  const motif = MOTIF[sv.motif](a, r);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0a1120"/>
      <stop offset="1" stop-color="#0e1c30"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="${a}" stop-opacity="0.30"/>
      <stop offset="1" stop-color="${a}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vig" cx="50%" cy="48%" r="75%">
      <stop offset="0.55" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#04060c" stop-opacity="0.55"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <circle cx="${glowX}" cy="${glowY}" r="640" fill="url(#glow)"/>
  <g>${motif}</g>
  <circle cx="${f(W * 0.3)}" cy="${f(H * 0.62)}" r="${f(180 + r() * 120)}" fill="none" stroke="${b}" stroke-width="2" opacity="0.10"/>
  <rect width="${W}" height="${H}" fill="url(#vig)"/>
</svg>`;
  writeFileSync(resolve(OUT, `${sv.key}.svg`), svg);
  console.log("svg", sv.key);
});
console.log(`\n${SERVICES.length} covers generated in ${OUT}`);
