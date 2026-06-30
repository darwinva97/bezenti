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
// el portal pide una URL con un token de un solo uso que inyecta las
// credenciales de la BD en la sesión PHP (sin que el usuario teclee nada).
type Adminer struct{}

const (
	adminerDir     = "/opt/bezenti/adminer"
	adminerTokens  = "/var/lib/bezenti-agent/adminer"
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

	// Secreto estable por nodo (cifra el "permanent login" de Adminer).
	secret := adminerDir + "/.secret"
	if _, err := os.Stat(secret); err != nil {
		if err := os.WriteFile(secret, []byte(randHex(32)), 0o640); err != nil {
			return err
		}
	}
	chownTo(secret, adminerRunUser)

	// Carpeta de tokens de un solo uso, legible por el usuario de la app PHP.
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

// adminerWrapper es el index.php que sirve Adminer con login 1-clic. Un token
// de un solo uso (?bz=) carga las credenciales en la sesión PHP; a partir de ahí
// Adminer queda autenticado para esa sesión sin pedir nada. Sin token, Adminer
// funciona normal (login manual con las credenciales de la BD).
const adminerWrapper = `<?php
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}
if (!empty($_GET['bz'])) {
    $tok = preg_replace('/[^a-f0-9]/', '', (string) $_GET['bz']);
    if ($tok !== '') {
        $f = '/var/lib/bezenti-agent/adminer/' . hash('sha256', $tok) . '.json';
        if (is_file($f)) {
            $data = json_decode(file_get_contents($f), true);
            @unlink($f); // un solo uso
            if (is_array($data) && ($data['exp'] ?? 0) >= time()) {
                $_SESSION['bz'] = $data;
            }
        }
    }
}
$BZ = $_SESSION['bz'] ?? null;

function adminer_object() {
    global $BZ;
    class AdminerBezenti extends Adminer {
        function name() {
            return 'Bezenti · Bases de datos';
        }
        function credentials() {
            global $BZ;
            if ($BZ) {
                return array($BZ['server'], $BZ['username'], $BZ['password']);
            }
            return parent::credentials();
        }
        function login($login, $password) {
            global $BZ;
            if ($BZ) {
                return true;
            }
            return parent::login($login, $password);
        }
        function database() {
            global $BZ;
            if ($BZ && !empty($BZ['db'])) {
                return $BZ['db'];
            }
            return parent::database();
        }
        function permanentLogin($create = false) {
            $s = @file_get_contents('/opt/bezenti/adminer/.secret');
            return $s !== false ? trim($s) : 'bezenti';
        }
    }
    return new AdminerBezenti;
}

include __DIR__ . '/adminer.php';
`
