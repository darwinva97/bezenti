package services

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"os/user"
	"strconv"
	"strings"
	"time"
)

// Adminer instala y sirve Adminer (un único archivo PHP que habla MySQL y
// PostgreSQL) como gestor web de bases de datos compartido del nodo. Se publica
// en dbadmin.<PAGES_DOMAIN> (reusa el wildcard TLS y DNS). El login es 1-clic:
// el portal pide una URL con un token de un solo uso; el wrapper auto-envía el
// form de login de Adminer con esas credenciales (sin que el usuario teclee nada).
type Adminer struct{}

const (
	adminerDir = "/opt/bezenti/adminer"
	// Los tokens NO pueden ir bajo /var/lib/bezenti-agent (0700 root): la app PHP
	// corre como www-data y no podría atravesar ese dir para leerlos. Dir propio
	// bajo /var/lib (0755, atravesable) y con owner www-data.
	adminerTokens  = "/var/lib/bezenti-adminer"
	adminerAppKey  = "bzadminer"
	adminerSrcURL  = "https://github.com/vrana/adminer/releases/download/v4.8.1/adminer-4.8.1.php"
	adminerRunUser = "www-data"
)

// adminerHost computa el hostname público del gestor bajo PAGES_DOMAIN, de modo
// que el cert wildcard de autocert y el wildcard DNS *.pages.bezenti.com lo
// cubran sin pasos manuales.
func adminerHost() string {
	d := os.Getenv("PAGES_DOMAIN")
	if d == "" {
		d = "pages.bezenti.com"
	}
	return "dbadmin." + d
}

// Ensure deja Adminer instalado, configurado en Unit y ruteado. Idempotente:
// se puede llamar al arrancar el agente y en cada login.
func (Adminer) Ensure() error {
	if err := os.MkdirAll(adminerDir, 0o755); err != nil {
		return err
	}

	// El binario PHP de Adminer se descarga una sola vez.
	bin := adminerDir + "/adminer.php"
	if _, err := os.Stat(bin); err != nil {
		if err := run("curl", "-fsSL", adminerSrcURL, "-o", bin); err != nil {
			return fmt.Errorf("descargando adminer: %w", err)
		}
	}

	// El wrapper SSO siempre se reescribe (así se actualiza con el agente).
	if err := os.WriteFile(adminerDir+"/index.php", []byte(adminerWrapper), 0o644); err != nil {
		return err
	}

	// Carpeta de tokens de un solo uso, legible por el usuario de la app PHP
	// (owner www-data; el padre /var/lib es 0755, atravesable).
	if err := os.MkdirAll(adminerTokens, 0o750); err != nil {
		return err
	}
	chownTo(adminerTokens, adminerRunUser)

	// php-pgsql para que Adminer pueda hablar Postgres. Best-effort y sin
	// reiniciar Unit (cortaría los sitios): Postgres aún no se provisiona, así
	// que basta dejar el paquete instalado para cuando llegue esa fase.
	if !havePHPExt("pgsql") {
		_ = run("apt-get", "install", "-y", "php-pgsql")
	}

	// App PHP dedicada en Unit. Dos targets (direct/index) como las apps de
	// proyecto, para que SetHostRoute rutee los .php a `direct` y el resto a
	// `index` (Adminer es un único index.php).
	app := map[string]any{
		"type":  "php",
		"user":  adminerRunUser,
		"group": adminerRunUser,
		"targets": map[string]any{
			"direct": map[string]any{"root": adminerDir},
			"index":  map[string]any{"root": adminerDir, "script": "index.php"},
		},
		"options": map[string]any{
			"admin": map[string]string{"memory_limit": "256M"},
		},
		"processes": map[string]any{"max": 2, "idle_timeout": 30, "spare": 0},
	}
	if err := unitPut("/config/applications/"+adminerAppKey, app); err != nil {
		return err
	}
	return NginxUnit{}.SetHostRoute(adminerHost(), adminerAppKey)
}

// LoginURL crea un token de un solo uso (90 s) que inyecta las credenciales de
// la BD en Adminer y devuelve la URL de login 1-clic. El driver lo elige Adminer
// por el nombre del parámetro: `server` = MySQL, `pgsql` = PostgreSQL.
func (Adminer) LoginURL(engine, server, dbName, dbUser, password string) (string, error) {
	if err := os.MkdirAll(adminerTokens, 0o750); err != nil {
		return "", err
	}
	token := randHex(32)
	sum := sha256.Sum256([]byte(token))

	rec, _ := json.Marshal(map[string]any{
		"server":   server,
		"username": dbUser,
		"password": password,
		"db":       dbName,
		"exp":      time.Now().Add(90 * time.Second).Unix(),
	})
	f := adminerTokens + "/" + hex.EncodeToString(sum[:]) + ".json"
	if err := os.WriteFile(f, rec, 0o640); err != nil {
		return "", err
	}
	chownTo(f, adminerRunUser)

	// Adminer toma el PRIMER parámetro de la query como driver (`server`=MySQL,
	// `pgsql`=PostgreSQL) y su valor como host. Por eso se arma a mano: no se
	// puede usar url.Values.Encode() (ordena alfabéticamente y `bz` quedaría
	// primero). El password NO viaja en la URL (lo inyecta credentials() desde
	// el token); aquí solo van driver/host/usuario/db + el token de un solo uso.
	driverKey := "server"
	if engine == "postgresql" || engine == "pgsql" {
		driverKey = "pgsql"
	}
	q := driverKey + "=" + url.QueryEscape(server) +
		"&username=" + url.QueryEscape(dbUser) +
		"&db=" + url.QueryEscape(dbName) +
		"&bz=" + token
	return "https://" + adminerHost() + "/?" + q, nil
}

func havePHPExt(ext string) bool {
	out, err := exec.Command("php", "-m").Output()
	if err != nil {
		return false
	}
	return strings.Contains(strings.ToLower(string(out)), strings.ToLower(ext))
}

func chownTo(path, username string) {
	u, err := user.Lookup(username)
	if err != nil {
		return
	}
	uid, _ := strconv.Atoi(u.Uid)
	gid, _ := strconv.Atoi(u.Gid)
	_ = os.Chown(path, uid, gid)
}

// adminerWrapper es el index.php que sirve Adminer con login 1-clic. Un token de
// un solo uso (?bz=) trae las credenciales de la BD; el wrapper AUTO-ENVÍA el
// formulario de login de Adminer (POST auth[...]) con el token CSRF de la sesión
// (mismo esquema que get_token() de Adminer), de modo que Adminer hace su login
// normal y queda autenticado. Inyectar credenciales por sesión + override de
// credentials() NO basta: Adminer solo autentica vía su POST de login. Sin
// token, Adminer funciona normal (login manual con las credenciales de la BD).
const adminerWrapper = `<?php
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}
$BZ = null;
if (!empty($_GET['bz'])) {
    $tok = preg_replace('/[^a-f0-9]/', '', (string) $_GET['bz']);
    if ($tok !== '') {
        $f = '/var/lib/bezenti-adminer/' . hash('sha256', $tok) . '.json';
        if (is_file($f)) {
            $data = json_decode(file_get_contents($f), true);
            @unlink($f); // un solo uso
            if (is_array($data) && ($data['exp'] ?? 0) >= time()) {
                $BZ = $data;
            }
        }
    }
}
if ($BZ && empty($_POST['auth'])) {
    $driver = !empty($_GET['pgsql']) ? 'pgsql' : 'server';
    // Mismo esquema que get_token() de Adminer: token aleatorio en la sesión.
    // Al llegar el POST, Adminer lee el mismo $_SESSION['token'] y verify_token pasa.
    if (empty($_SESSION['token'])) {
        $_SESSION['token'] = mt_rand(1, 1000000);
    }
    $csrf = $_SESSION['token'];
    $he = function ($s) { return htmlspecialchars((string) $s, ENT_QUOTES); };
    $action = '/?' . $driver . '=' . urlencode($BZ['server'])
        . '&username=' . urlencode($BZ['username'])
        . '&db=' . urlencode($BZ['db']);
    echo '<!doctype html><meta charset="utf-8"><title>Entrando…</title>';
    echo '<form id="l" method="post" action="' . $he($action) . '">';
    echo '<input type="hidden" name="auth[driver]" value="' . $driver . '">';
    echo '<input type="hidden" name="auth[server]" value="' . $he($BZ['server']) . '">';
    echo '<input type="hidden" name="auth[username]" value="' . $he($BZ['username']) . '">';
    echo '<input type="hidden" name="auth[password]" value="' . $he($BZ['password']) . '">';
    echo '<input type="hidden" name="auth[db]" value="' . $he($BZ['db']) . '">';
    echo '<input type="hidden" name="token" value="' . $he($csrf) . '">';
    echo '</form><script>document.getElementById("l").submit()</script>';
    echo '<noscript><button form="l">Entrar</button></noscript>';
    exit;
}
function adminer_object() {
    class AdminerBezenti extends Adminer {
        function name() {
            return 'Bezenti · Bases de datos';
        }
    }
    return new AdminerBezenti;
}
include __DIR__ . '/adminer.php';
`
