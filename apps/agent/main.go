package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"bezenti/agent/internal/handlers"
	agentmw "bezenti/agent/internal/middleware"
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
	r.Use(agentmw.TokenAuth(token))

	r.Get("/health", handlers.Health)

	r.Route("/clients", func(r chi.Router) {
		r.Post("/", handlers.CreateClient)
		r.Delete("/{clientID}", handlers.DeleteClient)
		r.Post("/{clientID}/domains", handlers.AddDomain)
		r.Delete("/{clientID}/domains/{domain}", handlers.RemoveDomain)
		r.Post("/{clientID}/limits", handlers.UpdateLimits)
		r.Get("/{clientID}/metrics", handlers.GetMetrics)
	})

	// Heartbeat goroutine: informa al control plane que este nodo está vivo.
	go heartbeatLoop(controlPlaneURL, nodeID, token)

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

type heartbeatBody struct {
	NodeID       string `json:"nodeId"`
	CpuPct       float64 `json:"cpuPct"`
	RamUsedMb    int     `json:"ramUsedMb"`
	DiskUsedGb   float64 `json:"diskUsedGb"`
	ClientsCount int     `json:"clientsCount"`
	Clients      []any   `json:"clients"`
}

func sendHeartbeat(controlPlaneURL, nodeID, token string) {
	body := heartbeatBody{
		NodeID:       nodeID,
		CpuPct:       cpuPercent(),
		RamUsedMb:    ramUsedMb(),
		DiskUsedGb:   diskUsedGb("/"),
		ClientsCount: 0,
		Clients:      []any{},
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

// Ignorar lint en imports no usados durante la compilación
var _ = fmt.Sprintf
