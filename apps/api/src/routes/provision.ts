import { Hono } from "hono";
import { createDb, nodes } from "@bezenti/db";
import { eq } from "drizzle-orm";
import type { Env } from "../env";
import { sshRun } from "../lib/ssh";

// Puerto del agente. DEBE ser un puerto que Cloudflare Workers permita en
// peticiones de salida (80, 8080, 8880, 2052, 2082, 2086, 2095); de lo
// contrario el fetch del control plane al agente devuelve error 1003.
export const AGENT_PORT = 8080;

export const provisionRouter = new Hono<{ Bindings: Env }>();

// ── POST /admin/nodes/provision ───────────────────────────────────────────────
// Crea el nodo en D1, genera el token del agente y lanza el bootstrap via SSH.
// Si SSH falla por cualquier motivo devuelve el comando para ejecución manual.
provisionRouter.post("/", async (c) => {
  const body = await c.req.json<{
    name:        string;
    provider:    string;
    region?:     string;
    host:        string;
    port?:       number;
    sshUser:     string;
    sshPassword: string;
  }>();

  const nodeId     = crypto.randomUUID();
  const agentToken = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash  = await sha256(agentToken);
  const agentPort  = AGENT_PORT;

  const db = createDb(c.env.DB);
  await db.insert(nodes).values({
    id:             nodeId,
    name:           body.name,
    provider:       body.provider,
    region:         body.region,
    ipPublic:       body.host,
    agentUrl:       `http://${body.host}:${agentPort}`,
    agentTokenHash: tokenHash,
    agentToken,
    status:         "provisioning",
    createdAt:      new Date(),
  });

  const apiUrl      = c.env.BETTER_AUTH_URL;
  const bootstrapUrl = `${apiUrl}/bootstrap/${nodeId}?t=${agentToken}`;
  // nohup + disown so the install continues after this SSH session closes.
  const sshCmd      = `nohup bash -c "curl -fsSL '${bootstrapUrl}' | bash" > /var/log/bezenti-install.log 2>&1 & disown`;
  const manualCmd   = `curl -fsSL '${bootstrapUrl}' | bash`;

  let sshTriggered = false;
  let sshError: string | null = null;

  try {
    await sshRun(
      { host: body.host, port: body.port ?? 22, username: body.sshUser, password: body.sshPassword },
      sshCmd,
    );
    sshTriggered = true;
  } catch (err) {
    sshError = err instanceof Error ? err.message : String(err);
  }

  return c.json({ nodeId, sshTriggered, sshError, manualCmd }, 201);
});

// ── GET /bootstrap/:nodeId ─────────────────────────────────────────────────────
// Endpoint PÚBLICO — sirve el script bash de instalación.
// El token de un solo uso (t=) es parte de la URL firmada que se le da al VPS.
export async function bootstrapScriptHandler(
  c: { req: { param: (k: string) => string; query: (k: string) => string | undefined }; env: Env },
): Promise<Response> {
  const nodeId     = c.req.param("nodeId");
  const agentToken = c.req.query("t");
  if (!agentToken) return new Response("missing token", { status: 400 });

  const db   = createDb(c.env.DB);
  const node = await db.query.nodes.findFirst({ where: eq(nodes.id, nodeId) });
  if (!node) return new Response("node not found", { status: 404 });

  const script = generateBootstrapScript({
    nodeId,
    agentToken,
    apiUrl:         c.env.BETTER_AUTH_URL,
    agentPort:      AGENT_PORT,
    agentBinaryUrl: c.env.AGENT_BINARY_URL,
  });

  return new Response(script, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

// ── Bootstrap script ──────────────────────────────────────────────────────────

function generateBootstrapScript(opts: {
  nodeId:         string;
  agentToken:     string;
  apiUrl:         string;
  agentPort:      number;
  agentBinaryUrl: string;
}): string {
  return `#!/bin/bash
# Bezenti Node Bootstrap — generado automáticamente
# Sin 'set -e': un servicio que falle NO debe abortar el bootstrap (el agente
# debe instalarse igual para que el nodo quede registrado y observable).
set -uo pipefail

NODE_ID="${opts.nodeId}"
AGENT_TOKEN="${opts.agentToken}"
API_URL="${opts.apiUrl}"
AGENT_PORT="${opts.agentPort}"
AGENT_BINARY_URL="${opts.agentBinaryUrl}"

log()  { echo "[bezenti] $*"; }
err()  { echo "[bezenti][ERROR] $*" >&2; exit 1; }
warn() { echo "[bezenti][WARN] $*" >&2; }

# Servicios que fallaron (resumen final). Un servicio caído NO brickea el nodo.
FAILED=""
mark_fail() { FAILED="$FAILED $1"; warn "$1 no se pudo instalar/configurar — el nodo sigue"; }

# Espera el lock de apt/dpkg: en el primer arranque, unattended-upgrades/apt-daily
# suele tenerlo y hace fallar el preinst de paquetes (p.ej. mariadb-server).
apt_wait() {
  local i=0
  while pgrep -x apt >/dev/null 2>&1 || pgrep -x apt-get >/dev/null 2>&1 \\
     || pgrep -x dpkg >/dev/null 2>&1 || pgrep -f unattended-upgr >/dev/null 2>&1; do
    [ "$i" -ge 120 ] && break
    sleep 3; i=$((i+1))
  done
}
apt_install() { apt_wait; DEBIAN_FRONTEND=noninteractive apt-get install -y -q "$@"; }

log "=== Bezenti Node Bootstrap ==="
log "Node: $NODE_ID"

# Verificar que corremos como root
[[ $EUID -ne 0 ]] && err "Debe ejecutarse como root"

# ─── 1. Actualizar sistema ───────────────────────────────────────────────────
log "Actualizando paquetes..."
export DEBIAN_FRONTEND=noninteractive
# Parar las actualizaciones automáticas del primer arranque (contención dpkg).
systemctl stop apt-daily.timer apt-daily-upgrade.timer unattended-upgrades 2>/dev/null || true
systemctl stop apt-daily.service apt-daily-upgrade.service 2>/dev/null || true
apt_wait
apt-get update -y -q || { sleep 5; apt_wait; apt-get update -y -q || true; }
apt_install curl wget gnupg2 ca-certificates lsb-release apt-transport-https procps \\
  || err "No se pudieron instalar paquetes base"

# ─── 2. NGINX Unit + PHP 8.3 ────────────────────────────────────────────────
log "Instalando NGINX Unit + PHP 8.3..."
if curl -fsSL https://unit.nginx.org/keys/nginx-keyring.gpg | gpg --dearmor > /usr/share/keyrings/nginx-keyring.gpg; then
  echo "deb [signed-by=/usr/share/keyrings/nginx-keyring.gpg] https://packages.nginx.org/unit/debian/ $(lsb_release -cs) unit" > /etc/apt/sources.list.d/unit.list
  apt_wait; apt-get update -y -q || true
fi
if apt_install unit unit-php; then
  # PHP extensions para aplicaciones web típicas
  apt_install php8.3-cli php8.3-mysql php8.3-curl php8.3-gd \\
    php8.3-mbstring php8.3-xml php8.3-zip php8.3-intl 2>/dev/null || \\
  apt_install php-cli php-mysql php-curl php-gd php-mbstring php-xml php-zip || true
  systemctl enable unit 2>/dev/null || true
  # Reiniciar (no solo enable --now): si Unit ya estaba corriendo cuando se
  # instaló unit-php, el módulo PHP no se carga hasta reiniciar el daemon.
  systemctl restart unit || mark_fail "unit"
  log "✓ NGINX Unit instalado"
else
  mark_fail "unit"
fi

# ─── 3. MariaDB ─────────────────────────────────────────────────────────────
log "Instalando MariaDB..."
if ! apt_install mariadb-server; then
  warn "MariaDB falló; recuperando dpkg y reintentando..."
  dpkg --configure -a || true
  apt-get -f install -y -q || true
  apt_wait
  apt_install mariadb-server || mark_fail "mariadb"
fi
if [[ "$FAILED" != *mariadb* ]]; then
  # Acceso externo: los clientes se conectan por internet (usuario @'%' creado
  # por el agente). El default empaquetado es bind-address=127.0.0.1.
  cat > /etc/mysql/mariadb.conf.d/99-bezenti.cnf << 'MARIADBEOF'
[mysqld]
bind-address = 0.0.0.0
MARIADBEOF
  systemctl enable mariadb 2>/dev/null || true
  systemctl restart mariadb || systemctl start mariadb || mark_fail "mariadb"
  # Evitar que clientes vean bases de datos de otros clientes
  mysql -e "SET GLOBAL skip_show_database = ON;" 2>/dev/null || true
  if command -v ufw > /dev/null && ufw status | grep -q "Status: active"; then
    ufw allow 3306/tcp || true
  fi
  log "✓ MariaDB instalado (acceso externo habilitado)"
fi

# ─── 3b. PowerDNS autoritativo (zonas DNS de clientes) ──────────────────────
log "Instalando PowerDNS..."
if apt_install pdns-server pdns-backend-sqlite3 sqlite3; then
PDNS_API_KEY=$(head -c 24 /dev/urandom | xxd -p)
cat > /etc/powerdns/pdns.d/bezenti.conf << PDNSEOF
launch=gsqlite3
gsqlite3-database=/var/lib/powerdns/pdns.sqlite3
api=yes
api-key=$PDNS_API_KEY
webserver=yes
webserver-address=127.0.0.1
webserver-port=8081
local-address=0.0.0.0:53, [::]:53
default-soa-content=ns1.bezenti.com. hostmaster.@ 0 10800 3600 604800 300
PDNSEOF
# El paquete trae launch= vacío en pdns.conf — quitarlo para no duplicar
grep -v '^launch=' /etc/powerdns/pdns.conf > /tmp/pdns.conf && mv /tmp/pdns.conf /etc/powerdns/pdns.conf
mkdir -p /var/lib/powerdns
test -s /var/lib/powerdns/pdns.sqlite3 || sqlite3 /var/lib/powerdns/pdns.sqlite3 < /usr/share/pdns-backend-sqlite3/schema/schema.sqlite3.sql
chown -R pdns:pdns /var/lib/powerdns
systemctl enable pdns 2>/dev/null || true
systemctl restart pdns || mark_fail "powerdns"
if command -v ufw > /dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 53/udp || true
  ufw allow 53/tcp || true
fi
log "✓ PowerDNS instalado (API local en :8081)"
else
  mark_fail "powerdns"
fi

# ─── 4. SFTP via OpenSSH ────────────────────────────────────────────────────
log "Configurando SFTP..."
groupadd -f sftp-clients
if ! grep -q "Match Group sftp-clients" /etc/ssh/sshd_config; then
  cat >> /etc/ssh/sshd_config << 'SSHEOF'

Match Group sftp-clients
    ChrootDirectory %h
    ForceCommand internal-sftp -l VERBOSE
    AllowTcpForwarding no
    X11Forwarding no
SSHEOF
  systemctl reload sshd 2>/dev/null || systemctl reload ssh
fi
log "✓ SFTP configurado"

# ─── 5. Estructura de directorios ───────────────────────────────────────────
log "Creando estructura base..."
mkdir -p /var/www
chmod 755 /var/www
log "✓ Directorios listos"

# ─── 6. Instalar agente Bezenti ─────────────────────────────────────────────
log "Instalando agente Bezenti..."
ARCH=$(uname -m)
case $ARCH in
  x86_64)  ARCH_TAG="amd64" ;;
  aarch64) ARCH_TAG="arm64" ;;
  *) err "Arquitectura no soportada: $ARCH" ;;
esac
AGENT_BIN="/usr/local/bin/bezenti-agent"

[[ -z "$AGENT_BINARY_URL" ]] && err "AGENT_BINARY_URL no configurado — sube el binario y vuelve a intentar"

# Detener el agente si ya estaba corriendo — no se puede sobrescribir un
# binario en ejecución (ETXTBSY); descargamos a un temporal y renombramos.
systemctl stop bezenti-agent 2>/dev/null || true
curl -fsSL "$AGENT_BINARY_URL/bezenti-agent-linux-$ARCH_TAG" -o "$AGENT_BIN.new" \\
  || err "No se pudo descargar el agente desde $AGENT_BINARY_URL"
chmod +x "$AGENT_BIN.new"
mv -f "$AGENT_BIN.new" "$AGENT_BIN"
log "✓ Agente descargado"

# ─── 6.5 Cloudflare Tunnel ──────────────────────────────────────────────────
# Un Cloudflare Worker no puede hacer fetch a una IP cruda (error 1003), así
# que el agente se expone vía un quick tunnel de cloudflared. El agente
# descubre la URL pública por el endpoint de métricas y la reporta en cada
# heartbeat, de modo que la BD sigue al tunnel aunque su URL cambie.
log "Instalando Cloudflare Tunnel..."
CF_BIN="/usr/local/bin/cloudflared"
case $ARCH_TAG in
  amd64) CF_ARCH="amd64" ;;
  arm64) CF_ARCH="arm64" ;;
esac
if [[ ! -x "$CF_BIN" ]]; then
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$CF_ARCH" -o "$CF_BIN" \\
    || err "No se pudo descargar cloudflared"
  chmod +x "$CF_BIN"
fi
cat > /etc/systemd/system/cf-tunnel.service << CFSVC
[Unit]
Description=Cloudflare Tunnel (Bezenti agent)
After=network.target bezenti-agent.service

[Service]
ExecStart=$CF_BIN tunnel --no-autoupdate --metrics localhost:9091 --url http://localhost:$AGENT_PORT
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
CFSVC
systemctl daemon-reload
systemctl enable cf-tunnel
systemctl restart cf-tunnel
log "✓ Cloudflare Tunnel activo"

# ─── 7. Servicio systemd ────────────────────────────────────────────────────
log "Configurando systemd..."
cat > /etc/systemd/system/bezenti-agent.service << SYSD
[Unit]
Description=Bezenti Node Agent
After=network.target unit.service mariadb.service cf-tunnel.service
Wants=unit.service mariadb.service

[Service]
Environment=AGENT_TOKEN=$AGENT_TOKEN
Environment=NODE_ID=$NODE_ID
Environment=CONTROL_PLANE_URL=$API_URL
Environment=AGENT_PORT=$AGENT_PORT
Environment=CF_METRICS_ADDR=localhost:9091
ExecStart=$AGENT_BIN
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SYSD
systemctl daemon-reload
systemctl enable bezenti-agent
systemctl start bezenti-agent
log "✓ Servicio bezenti-agent activo"

# ─── 8. Verificación ────────────────────────────────────────────────────────
sleep 3
if curl -sf "http://localhost:$AGENT_PORT/health" > /dev/null; then
  log "✅ Agente operativo — el nodo aparecerá como 'listo' en el panel en ~30s"
else
  log "⚠️  El agente tardó más en iniciar. Verifica con: journalctl -u bezenti-agent -f"
fi
if [[ -n "$FAILED" ]]; then
  warn "Servicios con problemas:$FAILED — el nodo está registrado igual; revisa /var/log/bezenti-install.log"
else
  log "✅ Todos los servicios instalados correctamente."
fi
`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return bytesToHex(new Uint8Array(buf));
}
