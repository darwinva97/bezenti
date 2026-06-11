package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"bezenti/agent/internal/services"
)

type createClientReq struct {
	ID           string `json:"id"`
	LinuxUser    string `json:"linux_user"`
	SftpPassword string `json:"sftp_password"`
	Limits       struct {
		DiskMB       int    `json:"disk_mb"`
		MaxProcesses int    `json:"max_processes"`
		MemoryLimitMB int   `json:"memory_limit_mb"`
		PhpVersion   string `json:"php_version"`
	} `json:"limits"`
}

func CreateClient(w http.ResponseWriter, r *http.Request) {
	var req createClientReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}

	sys := services.System{}
	if err := sys.CreateUser(req.LinuxUser, req.SftpPassword, req.Limits.DiskMB); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	unit := services.NginxUnit{}
	if err := unit.CreateApp(req.LinuxUser, req.Limits.PhpVersion, req.Limits.MemoryLimitMB, req.Limits.MaxProcesses); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	db := services.Database{}
	creds, err := db.CreateDatabase(req.LinuxUser)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]any{
		"db_name":     creds.Name,
		"db_user":     creds.User,
		"db_password": creds.Password,
		"sftp_port":   22,
		"sftp_user":   req.LinuxUser,
	})
}

func DeleteClient(w http.ResponseWriter, r *http.Request) {
	clientID := chi.URLParam(r, "clientID")

	services.NginxUnit{}.DeleteApp(clientID)
	services.Database{}.DeleteDatabase(clientID)

	if err := (services.System{}).DeleteUser(clientID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func UpdateLimits(w http.ResponseWriter, r *http.Request) {
	clientID := chi.URLParam(r, "clientID")

	var req struct {
		DiskMB        int `json:"disk_mb"`
		MaxProcesses  int `json:"max_processes"`
		MemoryLimitMB int `json:"memory_limit_mb"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}

	if err := (services.System{}).UpdateQuota(clientID, req.DiskMB); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if err := (services.NginxUnit{}).UpdateLimits(clientID, req.MemoryLimitMB, req.MaxProcesses); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
