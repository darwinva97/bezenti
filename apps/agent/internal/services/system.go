package services

import (
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"strings"
)

type System struct{}

func (System) CreateUser(username, password string, diskMB int) error {
	if err := run("useradd", "-m", "-d", "/var/www/"+username, "-s", "/usr/sbin/nologin", "-G", "sftp-clients", username); err != nil {
		return fmt.Errorf("useradd: %w", err)
	}

	// set password via chpasswd
	cmd := exec.Command("chpasswd")
	cmd.Stdin = strings.NewReader(username + ":" + password)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("chpasswd: %w", err)
	}

	// create directory structure
	for _, dir := range []string{"public", "logs", "tmp"} {
		path := "/var/www/" + username + "/" + dir
		if err := run("mkdir", "-p", path); err != nil {
			return err
		}
		if err := run("chown", username+":"+username, path); err != nil {
			return err
		}
	}

	// chroot dir must be owned by root
	if err := run("chown", "root:root", "/var/www/"+username); err != nil {
		return err
	}

	// La cuota de disco es best-effort: requiere quotas habilitadas en el
	// filesystem (no viene por defecto en los VPS).
	if err := setQuota(username, diskMB); err != nil {
		slog.Warn("setquota failed — continuando sin cuota de disco", "user", username, "err", err)
	}
	return nil
}

// EnsureDir crea el docroot de un proyecto (/var/www/<user>/<docPath>/public)
// y deja un index.php placeholder si el directorio estaba vacío.
func (System) EnsureDir(username, docPath string) error {
	if docPath == "" || strings.Contains(docPath, "..") || strings.ContainsAny(docPath, "/\\") {
		return fmt.Errorf("docPath inválido: %q", docPath)
	}
	dir := "/var/www/" + username + "/" + docPath
	pub := dir + "/public"
	if err := run("mkdir", "-p", pub); err != nil {
		return err
	}
	idx := pub + "/index.php"
	if _, err := os.Stat(idx); os.IsNotExist(err) {
		placeholder := `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>Sitio en construcción — Bezenti</title></head>
<body style="font-family:system-ui;display:grid;place-items:center;min-height:90vh;color:#374151">
<div style="text-align:center">
<h1 style="font-weight:600">Sitio en construcción</h1>
<p><code><?php echo htmlspecialchars($_SERVER['HTTP_HOST'] ?? ''); ?></code></p>
<p style="color:#9ca3af;font-size:14px">Sube tus archivos por SFTP a <code><?php echo htmlspecialchars(basename(dirname(__DIR__))); ?>/public</code></p>
</div>
</body>
</html>
`
		if err := os.WriteFile(idx, []byte(placeholder), 0o644); err != nil {
			return fmt.Errorf("placeholder index.php: %w", err)
		}
	}
	return run("chown", "-R", username+":"+username, dir)
}

func (System) DeleteUser(username string) error {
	run("userdel", "-r", username) //nolint — best effort
	return nil
}

func (System) UpdateQuota(username string, diskMB int) error {
	return setQuota(username, diskMB)
}

func setQuota(username string, diskMB int) error {
	blocks := diskMB * 1024 // 1 MB = 1024 blocks (1k)
	soft := fmt.Sprintf("%d", blocks)
	hard := fmt.Sprintf("%d", int(float64(blocks)*1.05)) // 5% grace
	return run("setquota", "-u", username, soft, hard, "0", "0", "/")
}

func run(name string, args ...string) error {
	out, err := exec.Command(name, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s: %s", name, out)
	}
	return nil
}
