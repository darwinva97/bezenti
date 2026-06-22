package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"runtime"
)

// Version del agente. Se incrementa en cada release y se compara contra la
// versión objetivo del control plane para saber si hay actualización.
const Version = "0.3.8"

// Update descarga un binario nuevo y reinicia el servicio para aplicarlo.
// Lo invoca el control plane (token-authed) cuando hay una versión nueva.
//
// Acepta { "base_url": "..." } (el agente añade /bezenti-agent-linux-<arch>)
// o { "url": "..." } para apuntar a un binario exacto.
func Update(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BaseURL string `json:"base_url"`
		URL     string `json:"url"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	downloadURL := req.URL
	if downloadURL == "" && req.BaseURL != "" {
		downloadURL = fmt.Sprintf("%s/bezenti-agent-linux-%s", req.BaseURL, runtime.GOARCH)
	}
	if downloadURL == "" {
		http.Error(w, "se requiere url o base_url", http.StatusBadRequest)
		return
	}

	exe, err := os.Executable()
	if err != nil {
		http.Error(w, "no se pudo resolver el binario actual: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Descargar a un archivo temporal junto al binario actual
	resp, err := http.Get(downloadURL) //nolint:gosec — URL viene del control plane autenticado
	if err != nil {
		http.Error(w, "descarga falló: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		http.Error(w, fmt.Sprintf("descarga devolvió %d", resp.StatusCode), http.StatusBadGateway)
		return
	}

	tmp := exe + ".new"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		http.Error(w, "no se pudo escribir el binario: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		os.Remove(tmp)
		http.Error(w, "copia falló: "+err.Error(), http.StatusInternalServerError)
		return
	}
	f.Close()

	// Reemplazo atómico — Linux permite renombrar sobre un ELF en ejecución
	if err := os.Rename(tmp, exe); err != nil {
		os.Remove(tmp)
		http.Error(w, "no se pudo reemplazar el binario: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":      "updating",
		"from":        Version,
		"downloaded":  downloadURL,
	})
	if fl, ok := w.(http.Flusher); ok {
		fl.Flush()
	}

	// Programar el reinicio en una unidad transitoria, fuera de nuestro cgroup,
	// para que `systemctl restart` no nos mate antes de ejecutarse.
	slog.Info("nuevo binario instalado — reiniciando servicio", "url", downloadURL)
	if err := exec.Command("systemd-run", "--on-active=1s", "systemctl", "restart", "bezenti-agent").Run(); err != nil {
		slog.Error("no se pudo programar el reinicio — reinicia manualmente", "err", err)
	}
}
