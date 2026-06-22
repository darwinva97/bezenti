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
	ID            string               `json:"id"`
	LinuxUser     string               `json:"linux_user"`
	DocPath       string               `json:"doc_path"`
	PhpVersion    string               `json:"php_version"`
	MemoryLimitMB int                  `json:"memory_limit_mb"`
	MaxProcesses  int                  `json:"max_processes"`
	PhpSettings   services.PhpSettings `json:"php_settings"`
	Hosts         []string             `json:"hosts"`
}

// withDefaults completa los campos en 0 de unos ajustes PHP con los defaults del
// nodo (la memoria por defecto = la del plan, que llega aparte en el create).
func phpSettingsWithDefaults(s services.PhpSettings, memDefault int) services.PhpSettings {
	if s.MemoryLimitMB <= 0 {
		s.MemoryLimitMB = memDefault
	}
	if s.UploadMaxMB <= 0 {
		s.UploadMaxMB = services.DefaultUploadMaxMB
	}
	if s.MaxExecutionTime <= 0 {
		s.MaxExecutionTime = services.DefaultMaxExecutionTime
	}
	if s.MaxInputVars <= 0 {
		s.MaxInputVars = services.DefaultMaxInputVars
	}
	if s.MaxInputTime <= 0 {
		s.MaxInputTime = services.DefaultMaxInputTime
	}
	return s
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

	// Aplicar los ajustes PHP (persistidos en el control plane) — así una
	// re-provisión conserva lo que el cliente haya configurado. Sube además el
	// max_body_size global de Unit para la subida.
	if err := unit.SetPhpSettings(appKey, phpSettingsWithDefaults(req.PhpSettings, req.MemoryLimitMB)); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]any{"app": appKey, "doc_root": docRoot})
}

// SetProjectPhpLimits aplica los ajustes PHP del proyecto (lo llama el control
// plane cuando el cliente los cambia desde el panel). Las validaciones de rango
// y el tope de memoria según el plan se hacen en el control plane.
func SetProjectPhpLimits(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	var s services.PhpSettings
	if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if err := (services.NginxUnit{}).SetPhpSettings(projectAppKey(projectID), s); err != nil {
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
