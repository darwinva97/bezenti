package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"golang.org/x/crypto/acme/autocert"

	"bezenti/agent/internal/handlers"
	agentmw "bezenti/agent/internal/middleware"
	"bezenti/agent/internal/services"
)

func main() {
	token := os.Getenv("AGENT_TOKEN")
	if token == "" {
		slog.Error("AGENT_TOKEN not set — exiting")
		os.Exit(1)
	}
	nodeID := os.Getenv("NODE_ID")
	if nodeID == "" {
		slog.Error("NODE_ID not set — exiting")
		os.Exit(1)
	}
	controlPlaneURL := os.Getenv("CONTROL_PLANE_URL")
	if controlPlaneURL == "" {
		slog.Error("CONTROL_PLANE_URL not set — exiting")
		os.Exit(1)
	}

	port := os.Getenv("AGENT_PORT")
	if port == "" {
		port = "9000"
	}

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	// /health es público — lo usa el health check del bootstrap (sin token)
	r.Get("/health", handlers.Health)

	r.Group(func(r chi.Router) {
		r.Use(agentmw.TokenAuth(token))

		// Auto-actualización: el control plane envía la URL del binario nuevo
		r.Post("/update", handlers.Update)

		// Consola web (admin): ver logs y ejecutar comandos en el nodo
		r.Get("/logs", handlers.Logs)
		r.Post("/exec", handlers.Exec)

		r.Route("/clients", func(r chi.Router) {
			r.Post("/", handlers.CreateClient)
			r.Delete("/{clientID}", handlers.DeleteClient)
			r.Post("/{clientID}/domains", handlers.AddDomain)
			r.Delete("/{clientID}/domains/{domain}", handlers.RemoveDomain)
			r.Post("/{clientID}/limits", handlers.UpdateLimits)
			r.Get("/{clientID}/metrics", handlers.GetMetrics)
		})

		r.Route("/projects", func(r chi.Router) {
			r.Post("/", handlers.CreateProject)
			r.Delete("/{projectID}", handlers.DeleteProject)
			r.Post("/{projectID}/hosts", handlers.SetProjectHosts)
			// Instalador 1-clic (WordPress y otras apps PHP)
			r.Post("/{projectID}/install", handlers.InstallApp)
			// Login 1-clic al admin de WordPress (token de un solo uso)
			r.Post("/{projectID}/sso", handlers.ProjectSSO)
			// Límites PHP de subida (upload_max_filesize/post_max_size)
			r.Post("/{projectID}/php-limits", handlers.SetProjectPhpLimits)
		})

		// Bases de datos independientes del cliente
		r.Route("/databases", func(r chi.Router) {
			r.Post("/", handlers.CreateDatabase)
			r.Post("/query", handlers.DatabaseQuery)
			r.Post("/password", handlers.SetDatabasePassword)
			// Login 1-clic al gestor web (Adminer) con token de un solo uso
			r.Post("/adminer-login", handlers.AdminerLogin)
			r.Delete("/{dbName}", handlers.DeleteDatabase)
		})

		// Zonas DNS de clientes (PowerDNS local)
		r.Route("/dns", func(r chi.Router) {
			r.Put("/zones/{zone}", handlers.SyncDnsZone)
			r.Delete("/zones/{zone}", handlers.DeleteDnsZone)
		})

		// Explorador de archivos del cliente (rutas relativas a /var/www/<user>)
		r.Route("/files", func(r chi.Router) {
			r.Get("/list", handlers.FilesList)
			r.Get("/read", handlers.FilesRead)
			r.Get("/zip", handlers.FilesZip)
			r.Put("/write", handlers.FilesWrite)
			r.Post("/mkdir", handlers.FilesMkdir)
			r.Post("/rename", handlers.FilesRename)
			r.Post("/copy", handlers.FilesCopy)
			r.Post("/delete", handlers.FilesDelete)
			r.Post("/chmod", handlers.FilesChmod)
			r.Post("/extract", handlers.FilesExtract)
		})
	})

	// Reaplicar la config base del listener de Unit (confianza en
	// X-Forwarded-Proto) de forma best-effort: así un node ya existente la adopta
	// tras actualizar el agente. Idempotente; si Unit aún no responde, no pasa
	// nada (se reaplica al crear/renombrar un proyecto).
	if err := (services.NginxUnit{}).EnsureBaseListener(); err != nil {
		slog.Warn("no se pudo reaplicar el listener base de Unit", "err", err)
	}

	// Curar wp-config.php de instalaciones previas para que detecten https
	// reenviado por el proxy TLS (evita el bucle de redirects en wp-admin).
	services.RepairWpConfigsSSL()

	// Dejar Adminer (gestor web de BD) instalado y ruteado en dbadmin.<PAGES>.
	// En goroutine: el Ensure puede hacer apt-get/curl y no debe retrasar que el
	// agente empiece a escuchar. Best-effort; también se reintenta en cada login.
	go func() {
		if err := (services.Adminer{}).Ensure(); err != nil {
			slog.Warn("no se pudo preparar Adminer", "err", err)
		}
	}()

	// Heartbeat goroutine: informa al control plane que este nodo está vivo.
	go heartbeatLoop(controlPlaneURL, nodeID, token)

	// TLS goroutine: termina HTTPS en :443 con certs Let's Encrypt automáticos y
	// proxy a Unit en :80. Aislada con recover para que un fallo de TLS nunca
	// tumbe el agente ni el :80 (peor caso: https no disponible, http intacto).
	go func() {
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("tls: panic recuperado — https deshabilitado, :80 intacto", "panic", rec)
			}
		}()
		startTLSProxy()
	}()

	slog.Info("agent listening", "port", port, "nodeID", nodeID)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		slog.Error("server error", "err", err)
		os.Exit(1)
	}
}

// heartbeatLoop envía heartbeats periódicos al control plane.
func heartbeatLoop(controlPlaneURL, nodeID, token string) {
	// Esperar a que el servidor HTTP esté listo antes del primer heartbeat.
	time.Sleep(3 * time.Second)

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	// Enviar un heartbeat inicial inmediatamente al arrancar.
	sendHeartbeat(controlPlaneURL, nodeID, token)

	for range ticker.C {
		sendHeartbeat(controlPlaneURL, nodeID, token)
	}
}

type clientStat struct {
	// Usuario Linux del cliente (cli_xxxx). El control plane lo mapea a clientId.
	LinuxUser    string `json:"linuxUser"`
	DiskUsedMb   int    `json:"diskUsedMb"`
	MysqlUsedMb  int    `json:"mysqlUsedMb"`
	ProcessCount int    `json:"processCount"`
}

type heartbeatBody struct {
	NodeID       string       `json:"nodeId"`
	AgentURL     string       `json:"agentUrl,omitempty"`
	PublicIP     string       `json:"publicIp,omitempty"`
	CpuPct       float64      `json:"cpuPct"`
	RamUsedMb    int          `json:"ramUsedMb"`
	DiskUsedGb   float64      `json:"diskUsedGb"`
	ClientsCount int          `json:"clientsCount"`
	Clients      []clientStat `json:"clients"`
}

func sendHeartbeat(controlPlaneURL, nodeID, token string) {
	clients := gatherClientStats()
	body := heartbeatBody{
		NodeID:       nodeID,
		AgentURL:     discoverTunnelURL(),
		PublicIP:     discoverPublicIP(),
		CpuPct:       cpuPercent(),
		RamUsedMb:    ramUsedMb(),
		DiskUsedGb:   diskUsedGb("/"),
		ClientsCount: len(clients),
		Clients:      clients,
	}

	data, err := json.Marshal(body)
	if err != nil {
		slog.Warn("heartbeat marshal error", "err", err)
		return
	}

	req, err := http.NewRequest("POST", controlPlaneURL+"/agent/heartbeat", bytes.NewReader(data))
	if err != nil {
		slog.Warn("heartbeat request build error", "err", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Agent-Token", token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		slog.Warn("heartbeat send error", "err", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		slog.Error("heartbeat unauthorized — token inválido o nodo no registrado")
		return
	}
	slog.Debug("heartbeat sent", "status", resp.StatusCode)
}

// discoverTunnelURL consulta el endpoint de métricas de cloudflared para
// obtener el hostname público del quick tunnel y lo reporta al control plane.
// Así el agentUrl en la BD sigue al tunnel aunque su URL cambie tras reinicios.
// Devuelve "" si no hay tunnel (el control plane conserva el agentUrl anterior).
func discoverTunnelURL() string {
	addr := os.Getenv("CF_METRICS_ADDR")
	if addr == "" {
		addr = "localhost:9091"
	}
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get("http://" + addr + "/quicktunnel")
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	var d struct {
		Hostname string `json:"hostname"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&d); err != nil || d.Hostname == "" {
		return ""
	}
	return "https://" + d.Hostname
}

// discoverPublicIP averigua la IP pública del nodo (la que ve internet) para
// reportarla en el heartbeat. El control plane mantiene el wildcard DNS
// *.pages/*.db apuntando a ella, de modo que si el proveedor (Hetzner)
// reasigna IP al recrear el VPS, el DNS se corrige solo. Devuelve "" si no se
// pudo determinar (el control plane conserva la IP previa).
func discoverPublicIP() string {
	client := &http.Client{Timeout: 4 * time.Second}

	// Cloudflare trace devuelve, entre otras, una línea "ip=<ipv4>".
	if resp, err := client.Get("https://cloudflare.com/cdn-cgi/trace"); err == nil {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		resp.Body.Close()
		for _, line := range strings.Split(string(b), "\n") {
			if strings.HasPrefix(line, "ip=") {
				if ip := net.ParseIP(strings.TrimSpace(line[3:])); ip != nil && ip.To4() != nil {
					return ip.String()
				}
			}
		}
	}

	// Fallback: ipify devuelve solo la IP en texto plano.
	if resp, err := client.Get("https://api.ipify.org"); err == nil {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 64))
		resp.Body.Close()
		if ip := net.ParseIP(strings.TrimSpace(string(b))); ip != nil && ip.To4() != nil {
			return ip.String()
		}
	}

	return ""
}

// startTLSProxy levanta un servidor HTTPS en :443 que termina TLS con
// certificados Let's Encrypt obtenidos automáticamente (autocert, desafío
// TLS-ALPN-01 sobre el propio :443 — no requiere :80 libre ni token DNS) y
// hace de reverse proxy a NGINX Unit en :80, que rutea por Host. Así cada
// proyecto <sub>--<slug>.pages.bezenti.com queda servido por https sin pasos
// manuales ni costo. Los certs se cachean en disco y autocert los renueva solo.
//
// Sólo se emiten certs para hosts bajo PAGES_DOMAIN (HostPolicy), para que un
// SNI arbitrario no dispare emisiones (rate limit de Let's Encrypt: ~50
// certs/semana por dominio registrado).
func startTLSProxy() {
	pagesDomain := os.Getenv("PAGES_DOMAIN")
	if pagesDomain == "" {
		pagesDomain = "pages.bezenti.com"
	}
	suffix := "." + pagesDomain

	cacheDir := os.Getenv("TLS_CACHE_DIR")
	if cacheDir == "" {
		cacheDir = "/var/lib/bezenti-agent/certs"
	}
	if err := os.MkdirAll(cacheDir, 0o700); err != nil {
		slog.Error("tls: no se pudo crear el cache de certs — https deshabilitado", "err", err)
		return
	}

	m := &autocert.Manager{
		Prompt: autocert.AcceptTOS,
		Cache:  autocert.DirCache(cacheDir),
		HostPolicy: func(_ context.Context, host string) error {
			if strings.HasSuffix(host, suffix) {
				return nil
			}
			return fmt.Errorf("host no permitido para TLS: %s", host)
		},
	}

	// Proxy a Unit en :80, preservando el Host original para que Unit rutee al
	// vhost correcto (Unit termina HTTP plano; el TLS lo cierra este server).
	upstream := &url.URL{Scheme: "http", Host: "127.0.0.1:80"}
	proxy := httputil.NewSingleHostReverseProxy(upstream)
	baseDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		baseDirector(req)
		// Decirle a Unit/PHP que el cliente llegó por https (TLS lo terminamos
		// aquí). Unit lo lee vía `forwarded` y marca is_ssl()/$_SERVER['HTTPS'].
		req.Header.Set("X-Forwarded-Proto", "https")
		req.Header.Set("X-Forwarded-Host", req.Host)
	}

	srv := &http.Server{
		Addr:      ":443",
		Handler:   proxy,
		TLSConfig: m.TLSConfig(), // GetCertificate de autocert + ALPN acme-tls/1
	}

	slog.Info("tls: https en :443 con autocert", "pagesDomain", pagesDomain, "cache", cacheDir)
	// Con TLSConfig.GetCertificate, los args de cert/key van vacíos.
	if err := srv.ListenAndServeTLS("", ""); err != nil {
		slog.Error("tls: el servidor https terminó", "err", err)
	}
}

// ── Métricas del sistema ──────────────────────────────────────────────────────

// cpuPercent lee /proc/stat dos veces y calcula el uso promedio.
func cpuPercent() float64 {
	sample := func() (idle, total uint64) {
		data, err := os.ReadFile("/proc/stat")
		if err != nil {
			return 0, 1
		}
		for _, line := range strings.Split(string(data), "\n") {
			if !strings.HasPrefix(line, "cpu ") {
				continue
			}
			fields := strings.Fields(line)[1:]
			vals := make([]uint64, len(fields))
			for i, f := range fields {
				vals[i], _ = strconv.ParseUint(f, 10, 64)
			}
			if len(vals) >= 4 {
				idle = vals[3]
				for _, v := range vals {
					total += v
				}
			}
		}
		return
	}

	idle0, total0 := sample()
	time.Sleep(200 * time.Millisecond)
	idle1, total1 := sample()

	dTotal := total1 - total0
	dIdle := idle1 - idle0
	if dTotal == 0 {
		return 0
	}
	return float64(dTotal-dIdle) / float64(dTotal) * 100
}

// ramUsedMb lee /proc/meminfo y retorna RAM usada en MiB.
func ramUsedMb() int {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0
	}
	vals := map[string]uint64{}
	for _, line := range strings.Split(string(data), "\n") {
		parts := strings.Fields(line)
		if len(parts) >= 2 {
			key := strings.TrimSuffix(parts[0], ":")
			val, _ := strconv.ParseUint(parts[1], 10, 64)
			vals[key] = val
		}
	}
	totalKb := vals["MemTotal"]
	availKb := vals["MemAvailable"]
	if totalKb == 0 {
		var ms runtime.MemStats
		runtime.ReadMemStats(&ms)
		return int(ms.Sys / 1024 / 1024)
	}
	return int((totalKb - availKb) / 1024)
}

// diskUsedGb retorna el espacio usado en GB del punto de montaje dado.
func diskUsedGb(path string) float64 {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return 0
	}
	total := stat.Blocks * uint64(stat.Bsize)
	free := stat.Bfree * uint64(stat.Bsize)
	used := total - free
	return float64(used) / 1e9
}

// ── Métricas por cliente ──────────────────────────────────────────────────────

// gatherClientStats recorre /var/www, y por cada usuario de cliente (cli_*)
// reporta disco usado (du), uso de MariaDB (information_schema) y procesos
// activos. El control plane mapea linuxUser → clientId y persiste el registro.
func gatherClientStats() []clientStat {
	entries, err := os.ReadDir("/var/www")
	if err != nil {
		return []clientStat{}
	}

	// Una sola consulta a MariaDB para todos los schemas; se reparte por usuario.
	mysqlBySchema := services.Database{}.UsageMBBySchema()

	stats := make([]clientStat, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		user := e.Name()
		if !strings.HasPrefix(user, "cli_") {
			continue
		}
		mysqlMb := 0
		for schema, mb := range mysqlBySchema {
			// El agente crea BDs como <user>_db y <user>_<n>.
			if schema == user || strings.HasPrefix(schema, user+"_") {
				mysqlMb += mb
			}
		}
		stats = append(stats, clientStat{
			LinuxUser:    user,
			DiskUsedMb:   duMB("/var/www/" + user),
			MysqlUsedMb:  mysqlMb,
			ProcessCount: psCount(user),
		})
	}
	return stats
}

// duMB retorna el espacio usado (MB) de una ruta vía `du -sm`.
func duMB(path string) int {
	out, err := exec.Command("du", "-sm", path).Output()
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(out))
	if len(fields) == 0 {
		return 0
	}
	n, _ := strconv.Atoi(fields[0])
	return n
}

// psCount cuenta los procesos activos de un usuario.
func psCount(user string) int {
	out, err := exec.Command("ps", "-u", user, "--no-headers").Output()
	if err != nil {
		return 0
	}
	trimmed := strings.TrimSpace(string(out))
	if trimmed == "" {
		return 0
	}
	return len(strings.Split(trimmed, "\n"))
}

// Ignorar lint en imports no usados durante la compilación
var _ = fmt.Sprintf
