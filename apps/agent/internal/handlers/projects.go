package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"bezenti/agent/internal/services"
)

// appKey estable por proyecto — no cambia aunque se renombre el subdominio,
// así el rename solo recablea listeners sin tocar la app (ni el cert futuro).
func projectAppKey(projectID string) string {
	return "proj_" + strings.ReplaceAll(projectID, "-", "")
}

type createProjectReq struct {
	ID            string   `json:"id"`
	LinuxUser     string   `json:"linux_user"`
	DocPath       string   `json:"doc_path"`
	PhpVersion    string   `json:"php_version"`
	MemoryLimitMB int      `json:"memory_limit_mb"`
	MaxProcesses  int      `json:"max_processes"`
	UploadMaxMB   int      `json:"upload_max_mb"`
	Hosts         []string `json:"hosts"`
}

func CreateProject(w http.ResponseWriter, r *http.Request) {
	var req createProjectReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if req.ID == "" || req.LinuxUser == "" || req.DocPath == "" || len(req.Hosts) == 0 {
		http.Error(w, "id, linux_user, doc_path y hosts son requeridos", http.StatusBadRequest)
		return
	}

	sys := services.System{}
	if err := sys.EnsureDir(req.LinuxUser, req.DocPath); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	appKey := projectAppKey(req.ID)
	docRoot := "/var/www/" + req.LinuxUser + "/" + req.DocPath + "/public"
	unit := services.NginxUnit{}
	if err := unit.CreateProjectApp(appKey, req.LinuxUser, docRoot, req.MemoryLimitMB, req.MaxProcesses); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	for _, host := range req.Hosts {
		if err := unit.SetHostRoute(host, appKey); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	// Aplicar el límite de subida (persistido en el control plane) — así una
	// re-provisión conserva lo que el cliente haya configurado.
	uploadMB := req.UploadMaxMB
	if uploadMB < 1 {
		uploadMB = services.DefaultUploadMaxMB
	}
	if err := unit.SetPhpUploadLimit(appKey, uploadMB); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]any{"app": appKey, "doc_root": docRoot})
}

// SetProjectPhpLimits ajusta los límites PHP de subida del proyecto (lo llama
// el control plane cuando el cliente cambia el límite desde el panel).
func SetProjectPhpLimits(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	var req struct {
		UploadMaxMB int `json:"upload_max_mb"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if req.UploadMaxMB < 1 || req.UploadMaxMB > 1024 {
		http.Error(w, "upload_max_mb fuera de rango (1–1024)", http.StatusBadRequest)
		return
	}
	if err := (services.NginxUnit{}).SetPhpUploadLimit(projectAppKey(projectID), req.UploadMaxMB); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ProjectSSO genera un token de login 1-clic para el WordPress del proyecto.
// El control plane (ya autenticado) lo llama; devuelve { token } y arma la URL.
func ProjectSSO(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	root, err := (services.NginxUnit{}).AppRoot(projectAppKey(projectID))
	if err != nil {
		http.Error(w, "proyecto no encontrado en el nodo: "+err.Error(), http.StatusNotFound)
		return
	}
	token, err := services.Installer{}.GenerateSSOToken(root)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"token": token})
}

// DeleteProject quita listeners y la app de Unit. Conserva los archivos del
// docroot — el borrado de datos del cliente es decisión aparte.
func DeleteProject(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	var req struct {
		Hosts []string `json:"hosts"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	unit := services.NginxUnit{}
	for _, host := range req.Hosts {
		unit.RemoveHostRoute(host) //nolint — best effort
	}
	unit.DeleteApp(projectAppKey(projectID))

	w.WriteHeader(http.StatusNoContent)
}

// SetProjectHosts recablea los listeners de un proyecto (rename de subdominio
// o de accountSlug): quita los hosts viejos y agrega los nuevos apuntando a
// la MISMA app — el contenido y la config no se tocan.
func SetProjectHosts(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	var req struct {
		Add    []string `json:"add"`
		Remove []string `json:"remove"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}

	appKey := projectAppKey(projectID)
	unit := services.NginxUnit{}

	// Primero agregar los nuevos (si falla, los viejos siguen sirviendo)
	for _, host := range req.Add {
		if err := unit.SetHostRoute(host, appKey); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	for _, host := range req.Remove {
		unit.RemoveHostRoute(host) //nolint — best effort
	}

	w.WriteHeader(http.StatusNoContent)
}
