package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"os/exec"
	"strconv"
	"time"
)

// Logs devuelve logs del nodo. ?source=install|cloudinit|agent  &lines=N
func Logs(w http.ResponseWriter, r *http.Request) {
	source := r.URL.Query().Get("source")
	lines := 200
	if n, err := strconv.Atoi(r.URL.Query().Get("lines")); err == nil && n > 0 && n <= 5000 {
		lines = n
	}
	n := strconv.Itoa(lines)

	var out []byte
	switch source {
	case "install":
		out, _ = exec.Command("tail", "-n", n, "/var/log/bezenti-install.log").CombinedOutput()
	case "cloudinit":
		out, _ = exec.Command("tail", "-n", n, "/var/log/cloud-init-output.log").CombinedOutput()
	case "agent":
		out, _ = exec.Command("journalctl", "-u", "bezenti-agent", "-n", n, "--no-pager").CombinedOutput()
	default:
		http.Error(w, "source debe ser install|cloudinit|agent", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"logs": string(out)})
}

// Exec ejecuta un comando en el nodo (como root) y devuelve su salida.
// Solo lo invoca el control plane con el token del agente.
func Exec(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Command    string `json:"command"`
		TimeoutSec int    `json:"timeout_sec"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if req.Command == "" {
		http.Error(w, "command es requerido", http.StatusBadRequest)
		return
	}
	timeout := req.TimeoutSec
	if timeout <= 0 || timeout > 300 {
		timeout = 60
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout)*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "bash", "-lc", req.Command)
	out, err := cmd.CombinedOutput()

	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = -1
		}
	}

	output := string(out)
	const maxOut = 100_000
	if len(output) > maxOut {
		output = output[:maxOut] + "\n…(salida truncada)"
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"output":   output,
		"exitCode": exitCode,
		"timedOut": ctx.Err() == context.DeadlineExceeded,
	})
}
