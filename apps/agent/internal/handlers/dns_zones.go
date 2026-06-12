package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"bezenti/agent/internal/services"
)

// Zonas DNS de clientes — el control plane manda el estado completo deseado
// y el agente lo reconcilia contra PowerDNS (full-state, idempotente).

var pdns services.PowerDNS

type syncZoneReq struct {
	NS      []string             `json:"ns"`
	Records []services.DnsRecord `json:"records"`
}

func SyncDnsZone(w http.ResponseWriter, r *http.Request) {
	zone := chi.URLParam(r, "zone")
	var req syncZoneReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if err := pdns.SyncZone(zone, req.NS, req.Records); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func DeleteDnsZone(w http.ResponseWriter, r *http.Request) {
	if err := pdns.DeleteZone(chi.URLParam(r, "zone")); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
