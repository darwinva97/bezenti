import { Hono } from "hono";
import { createDb, nodes } from "@bezenti/db";
import { eq } from "drizzle-orm";
import type { Env } from "../env";
import { sshRun } from "../lib/ssh";

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
  const agentPort  = 9000;

  const db = createDb(c.env.DB);
  await db.insert(nodes).values({
    id:             nodeId,
    name:           body.name,
    provider:       body.provider,
    region:         body.region,
    ipPublic:       body.host,
    agentUrl:       `http://${body.host}:${agentPort}`,
    agentTokenHash: tokenHash,
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
    agentPort:      9000,
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
set -euo pipefail

NODE_ID="${opts.nodeId}"
AGENT_TOKEN="${opts.agentToken}"
API_URL="${opts.apiUrl}"
AGENT_PORT="${opts.agentPort}"
AGENT_BINARY_URL="${opts.agentBinaryUrl}"

log()  { echo "[bezenti] $*"; }
err()  { echo "[bezenti][ERROR] $*" >&2; exit 1; }

log "=== Bezenti Node Bootstrap ==="
log "Node: $NODE_ID"

# Verificar que corremos como root
[[ $EUID -ne 0 ]] && err "Debe ejecutarse como root"

# ─── 1. Actualizar sistema ───────────────────────────────────────────────────
log "Actualizando paquetes..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y -q
apt-get install -y -q curl wget gnupg2 ca-certificates lsb-release apt-transport-https

# ─── 2. NGINX Unit + PHP 8.3 ────────────────────────────────────────────────
log "Instalando NGINX Unit + PHP 8.3..."
curl -fsSL https://unit.nginx.org/keys/nginx-keyring.gpg \\
  | gpg --dearmor > /usr/share/keyrings/nginx-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/nginx-keyring.gpg] https://packages.nginx.org/unit/debian/ $(lsb_release -cs) unit" > /etc/apt/sources.list.d/unit.list
apt-get update -y -q
apt-get install -y -q unit unit-php
# PHP extensions para aplicaciones web típicas
apt-get install -y -q php8.3-cli php8.3-mysql php8.3-curl php8.3-gd \\
  php8.3-mbstring php8.3-xml php8.3-zip php8.3-intl 2>/dev/null || \\
apt-get install -y -q php-cli php-mysql php-curl php-gd php-mbstring php-xml php-zip
systemctl enable --now unit
log "✓ NGINX Unit instalado"

# ─── 3. MariaDB ─────────────────────────────────────────────────────────────
log "Instalando MariaDB..."
apt-get install -y -q mariadb-server
systemctl enable --now mariadb
# Evitar que clientes vean bases de datos de otros clientes
mysql -e "SET GLOBAL skip_show_database = ON;" 2>/dev/null || true
log "✓ MariaDB instalado"

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

if [[ -n "$AGENT_BINARY_URL" ]]; then
  curl -fsSL "$AGENT_BINARY_URL/bezenti-agent-linux-$ARCH_TAG" -o "$AGENT_BIN" \\
    || err "No se pudo descargar el agente desde $AGENT_BINARY_URL"
else
  err "AGENT_BINARY_URL no configurado — sube el binario y vuelve a intentar"
fi
chmod +x "$AGENT_BIN"
log "✓ Agente descargado"

# ─── 7. Servicio systemd ────────────────────────────────────────────────────
log "Configurando systemd..."
cat > /etc/systemd/system/bezenti-agent.service << SYSD
[Unit]
Description=Bezenti Node Agent
After=network.target unit.service mariadb.service
Wants=unit.service mariadb.service

[Service]
Environment=AGENT_TOKEN=$AGENT_TOKEN
Environment=NODE_ID=$NODE_ID
Environment=CONTROL_PLANE_URL=$API_URL
Environment=AGENT_PORT=$AGENT_PORT
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
`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return bytesToHex(new Uint8Array(buf));
}
