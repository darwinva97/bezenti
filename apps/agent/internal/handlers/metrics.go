package handlers

import (
	"encoding/json"
	"net/http"
	"os/exec"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
)

func GetMetrics(w http.ResponseWriter, r *http.Request) {
	clientID := chi.URLParam(r, "clientID")

	diskMB := diskUsageMB("/var/www/" + clientID)
	procs := processCount(clientID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"disk_used_mb":   diskMB,
		"process_count":  procs,
	})
}

func diskUsageMB(path string) int {
	out, err := exec.Command("du", "-sm", path).Output()
	if err != nil {
		return 0
	}
	parts := strings.Fields(string(out))
	if len(parts) == 0 {
		return 0
	}
	n, _ := strconv.Atoi(parts[0])
	return n
}

func processCount(user string) int {
	out, err := exec.Command("ps", "-u", user, "--no-headers").Output()
	if err != nil {
		return 0
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) == 1 && lines[0] == "" {
		return 0
	}
	return len(lines)
}
