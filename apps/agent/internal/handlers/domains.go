package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"bezenti/agent/internal/services"
)

func AddDomain(w http.ResponseWriter, r *http.Request) {
	clientID := chi.URLParam(r, "clientID")

	var req struct {
		Domain  string `json:"domain"`
		DocRoot string `json:"doc_root"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}

	if err := (services.NginxUnit{}).AddListener(clientID, req.Domain, req.DocRoot); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
}

func RemoveDomain(w http.ResponseWriter, r *http.Request) {
	clientID := chi.URLParam(r, "clientID")
	domain := chi.URLParam(r, "domain")

	if err := (services.NginxUnit{}).RemoveListener(clientID, domain); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
