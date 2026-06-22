import type { Env } from "../env";

// Mantiene los registros wildcard de infraestructura (`*.pages.<PAGES_DOMAIN>` y
// `*.db.<DB_DOMAIN>`) apuntando a la IP pública del node activo.
//
// El node sirve los proyectos en :80 y MariaDB en :3306 desde su IP pública. Esa
// IP la asigna el proveedor (Hetzner) y puede cambiar al recrear el VPS, así que
// no se puede fijar a mano: el agente la reporta en cada heartbeat y aquí
// reapuntamos el DNS cuando cambia.
//
// Idempotente y best-effort: sin token no hace nada, y cualquier fallo de la API
// de Cloudflare se traga (se reintenta en el próximo cambio/heartbeat). Pensado
// para correr en `executionCtx.waitUntil`, sin bloquear la respuesta.
export async function syncInfraWildcards(env: Env, ip: string): Promise<void> {
  if (!env.CF_DNS_TOKEN || !env.CF_ZONE_ID) return;
  if (!isIpv4(ip)) return;

  const names = [
    env.PAGES_DOMAIN ? `*.${env.PAGES_DOMAIN}` : null,
    env.DB_DOMAIN ? `*.${env.DB_DOMAIN}` : null,
  ].filter((n): n is string => !!n);

  for (const name of names) {
    try {
      await upsertARecord(env, name, ip);
    } catch (err) {
      console.error(`syncInfraWildcards: ${name} -> ${ip} falló:`, err);
    }
  }
}

function isIpv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  return !!m && m.slice(1).every((o) => Number(o) <= 255);
}

async function upsertARecord(env: Env, name: string, ip: string): Promise<void> {
  const base    = `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/dns_records`;
  const headers = { Authorization: `Bearer ${env.CF_DNS_TOKEN}`, "Content-Type": "application/json" };
  // Grey cloud (proxied:false): el TLS lo termina el node (Fase B). TTL bajo para
  // que un cambio de IP propague rápido.
  const record  = { type: "A", name, content: ip, ttl: 300, proxied: false, comment: "Bezenti infra — IP del node activo (auto)" };

  const listRes = await fetch(`${base}?type=A&name=${encodeURIComponent(name)}`, { headers });
  const list    = (await listRes.json<{ result?: { id: string; content: string }[] }>()).result ?? [];

  if (list.length === 0) {
    const res = await fetch(base, { method: "POST", headers, body: JSON.stringify(record) });
    if (!res.ok) throw new Error(`POST ${(await res.text()).slice(0, 200)}`);
    return;
  }

  // Ya existe: solo actualizar si la IP difiere (evita writes innecesarios).
  if (list[0]!.content === ip) return;
  const res = await fetch(`${base}/${list[0]!.id}`, { method: "PUT", headers, body: JSON.stringify(record) });
  if (!res.ok) throw new Error(`PUT ${(await res.text()).slice(0, 200)}`);
}
