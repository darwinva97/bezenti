package services

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

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
	if err := wp("config", "create",
		"--dbname="+o.DBName,
		"--dbuser="+o.DBUser,
		"--dbpass="+o.DBPassword,
		"--dbhost=localhost",
		"--skip-check",
	); err != nil {
		return err
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

	// Los archivos quedan de root al correr con --allow-root; devolverlos al
	// usuario para que Unit (que corre como ese user) pueda escribir uploads.
	return run("chown", "-R", o.LinuxUser+":"+o.LinuxUser,
		"/var/www/"+o.LinuxUser+"/"+o.DocPath)
}
