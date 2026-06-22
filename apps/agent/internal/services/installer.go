package services

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// wpSSLSnippet va dentro de wp-config.php. El proxy TLS del nodo reenvía el
// esquema en X-Forwarded-Proto; Unit además expone REQUEST_SCHEME. WordPress
// is_ssl() sólo mira $_SERVER['HTTPS'], así que lo derivamos aquí. El comentario
// final "Bezenti SSL forwarded" sirve de marcador de idempotencia.
const wpSSLSnippet = `if ( ( isset( $_SERVER['HTTP_X_FORWARDED_PROTO'] ) && 'https' === $_SERVER['HTTP_X_FORWARDED_PROTO'] ) || ( isset( $_SERVER['REQUEST_SCHEME'] ) && 'https' === $_SERVER['REQUEST_SCHEME'] ) ) { $_SERVER['HTTPS'] = 'on'; } /* Bezenti SSL forwarded */`

const wpSSLMarker = "Bezenti SSL forwarded"

// EnsureWpConfigSSL inserta wpSSLSnippet en un wp-config.php si falta. Idempotente.
// Devuelve true si lo modificó.
func EnsureWpConfigSSL(path string) (bool, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return false, err
	}
	if bytes.Contains(data, []byte(wpSSLMarker)) {
		return false, nil
	}
	s := string(data)
	idx := strings.Index(s, "<?php")
	if idx < 0 {
		return false, nil // no parece PHP; no tocar
	}
	insertAt := idx + len("<?php")
	if nl := strings.IndexByte(s[insertAt:], '\n'); nl >= 0 {
		insertAt += nl + 1
	}
	block := "\n/* Bezenti: detectar https reenviado por el proxy TLS del nodo. */\n" + wpSSLSnippet + "\n"
	out := s[:insertAt] + block + s[insertAt:]
	// WriteFile sobre un archivo existente conserva dueño y permisos (sólo
	// trunca y reescribe); el agente corre como root y puede escribirlo.
	if err := os.WriteFile(path, []byte(out), 0o644); err != nil {
		return false, err
	}
	return true, nil
}

// ssoMuPlugin valida un token de un solo uso (?bezenti_sso=…) guardado como
// transient por el agente y loguea al admin, para el acceso 1-clic desde el
// panel. Va como must-use plugin (se carga siempre, no se puede desactivar).
const ssoMuPlugin = `<?php
/**
 * Plugin Name: Bezenti SSO
 * Description: Login 1-clic desde el panel Bezenti. Generado automáticamente — no editar.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }
add_action( 'plugins_loaded', function () {
	if ( empty( $_GET['bezenti_sso'] ) || is_user_logged_in() ) {
		return;
	}
	$token = (string) $_GET['bezenti_sso'];
	if ( strlen( $token ) < 24 ) {
		return;
	}
	$key = 'bezenti_sso_' . hash( 'sha256', $token );
	$uid = get_transient( $key );
	if ( false === $uid ) {
		return; // inválido o expirado
	}
	delete_transient( $key ); // un solo uso
	$uid = (int) $uid;
	if ( $uid <= 0 || ! get_user_by( 'id', $uid ) ) {
		return;
	}
	wp_set_auth_cookie( $uid, false, true );
	wp_set_current_user( $uid );
	wp_safe_redirect( admin_url() );
	exit;
}, 1 );
`

// EnsureSSOMuPlugin instala/actualiza el mu-plugin de SSO en el docroot.
func EnsureSSOMuPlugin(docRoot string) error {
	dir := docRoot + "/wp-content/mu-plugins"
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(dir+"/bezenti-sso.php", []byte(ssoMuPlugin), 0o644)
}

// GenerateSSOToken crea un token de un solo uso (90 s) para login 1-clic: guarda
// su hash como transient asociado al primer admin y devuelve el token en claro.
// El control plane arma la URL https://<dominio>/?bezenti_sso=<token>.
func (Installer) GenerateSSOToken(docRoot string) (string, error) {
	if err := ensureWpCli(); err != nil {
		return "", err
	}
	if _, err := os.Stat(docRoot + "/wp-load.php"); err != nil {
		return "", fmt.Errorf("no hay WordPress en este proyecto")
	}
	if err := EnsureSSOMuPlugin(docRoot); err != nil {
		return "", err
	}

	out, err := exec.Command(wpCliPath, "--path="+docRoot, "--allow-root",
		"user", "list", "--role=administrator", "--field=ID", "--format=ids").CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("wp user list: %s", strings.TrimSpace(string(out)))
	}
	ids := strings.Fields(strings.TrimSpace(string(out)))
	if len(ids) == 0 {
		return "", fmt.Errorf("el sitio no tiene usuario administrador")
	}

	token := randHex(32)
	sum := sha256.Sum256([]byte(token))
	if out, err := exec.Command(wpCliPath, "--path="+docRoot, "--allow-root",
		"transient", "set", "bezenti_sso_"+hex.EncodeToString(sum[:]), ids[0], "90").CombinedOutput(); err != nil {
		return "", fmt.Errorf("wp transient set: %s", strings.TrimSpace(string(out)))
	}
	return token, nil
}

// RepairWpConfigsSSL recorre los WordPress de los proyectos y se asegura de que
// tengan el snippet de https en wp-config.php y el mu-plugin de SSO. Best-effort;
// se llama al arrancar el agente para curar instalaciones previas a estos fixes.
func RepairWpConfigsSSL() {
	for _, pat := range []string{
		"/var/www/*/*/public/wp-config.php",
		"/var/www/*/public/wp-config.php",
	} {
		matches, _ := filepath.Glob(pat)
		for _, p := range matches {
			if changed, err := EnsureWpConfigSSL(p); err != nil {
				slog.Warn("repair wp-config ssl", "path", p, "err", err)
			} else if changed {
				slog.Info("wp-config ssl reparado", "path", p)
			}
			if err := EnsureSSOMuPlugin(filepath.Dir(p)); err != nil {
				slog.Warn("repair sso mu-plugin", "path", p, "err", err)
			}
		}
	}
}

// Installer instala aplicaciones PHP "1-clic" (tipo Softaculous) en el docroot
// de un proyecto. Hoy soporta WordPress; el diseño es extensible a otras apps.
type Installer struct{}

const wpCliPath = "/usr/local/bin/wp"

// ensureWpCli descarga wp-cli si no está presente. Requiere php-cli (instalado
// por el bootstrap del nodo).
func ensureWpCli() error {
	if _, err := os.Stat(wpCliPath); err == nil {
		return nil
	}
	tmp := wpCliPath + ".new"
	if err := run("curl", "-fsSL",
		"https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar",
		"-o", tmp); err != nil {
		return fmt.Errorf("descargando wp-cli: %w", err)
	}
	if err := run("chmod", "+x", tmp); err != nil {
		return err
	}
	return os.Rename(tmp, wpCliPath)
}

// WordPressOpts agrupa todo lo necesario para instalar WordPress.
type WordPressOpts struct {
	LinuxUser     string
	DocPath       string // ruta del proyecto relativa al home (sin /public)
	SiteURL       string // ej: https://blog--cuenta.pages.bezenti.com
	Title         string
	AdminUser     string
	AdminPassword string
	AdminEmail    string
	Locale        string // ej: es_ES (default si vacío)
	DBName        string
	DBUser        string
	DBPassword    string
}

// InstallWordPress descarga el core, escribe wp-config e instala el sitio.
// wp-cli corre como root (--allow-root) y al final se ajusta la propiedad de
// los archivos al usuario del cliente (NGINX Unit corre la app como ese user).
// La BD debe existir ya (créala con Database.CreateNamedDatabase antes).
func (Installer) InstallWordPress(o WordPressOpts) error {
	if err := ensureWpCli(); err != nil {
		return err
	}

	docRoot := "/var/www/" + o.LinuxUser + "/" + o.DocPath + "/public"
	if err := run("mkdir", "-p", docRoot); err != nil {
		return err
	}

	// Si ya hay un WordPress instalado, no sobrescribir.
	if _, err := os.Stat(docRoot + "/wp-load.php"); err == nil {
		return fmt.Errorf("ya hay un WordPress instalado en este proyecto")
	}

	locale := o.Locale
	if locale == "" {
		locale = "es_ES"
	}

	wp := func(args ...string) error {
		full := append([]string{"--path=" + docRoot, "--allow-root"}, args...)
		out, err := exec.Command(wpCliPath, full...).CombinedOutput()
		if err != nil {
			return fmt.Errorf("wp %s: %s", strings.Join(args, " "), strings.TrimSpace(string(out)))
		}
		return nil
	}

	if err := wp("core", "download", "--locale="+locale); err != nil {
		return err
	}
	// config create con --extra-php: inyecta el snippet de detección de https
	// (lee de stdin). Así el wp-config nace listo para servir tras el proxy TLS.
	{
		cmd := exec.Command(wpCliPath, "--path="+docRoot, "--allow-root", "config", "create",
			"--dbname="+o.DBName, "--dbuser="+o.DBUser, "--dbpass="+o.DBPassword,
			"--dbhost=localhost", "--skip-check", "--extra-php")
		cmd.Stdin = strings.NewReader(wpSSLSnippet + "\n")
		if out, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("wp config create: %s", strings.TrimSpace(string(out)))
		}
	}
	if err := wp("core", "install",
		"--url="+o.SiteURL,
		"--title="+o.Title,
		"--admin_user="+o.AdminUser,
		"--admin_password="+o.AdminPassword,
		"--admin_email="+o.AdminEmail,
		"--skip-email",
	); err != nil {
		return err
	}

	// mu-plugin de SSO para el login 1-clic desde el panel.
	if err := EnsureSSOMuPlugin(docRoot); err != nil {
		return fmt.Errorf("instalando mu-plugin SSO: %w", err)
	}

	// Los archivos quedan de root al correr con --allow-root; devolverlos al
	// usuario para que Unit (que corre como ese user) pueda escribir uploads.
	return run("chown", "-R", o.LinuxUser+":"+o.LinuxUser,
		"/var/www/"+o.LinuxUser+"/"+o.DocPath)
}
