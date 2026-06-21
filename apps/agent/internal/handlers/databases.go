package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"bezenti/agent/internal/services"
)

type createDatabaseReq struct {
	DBName   string `json:"db_name"`
	DBUser   string `json:"db_user"`
	Password string `json:"password"`
}

// CreateDatabase crea una BD MariaDB independiente para el cliente.
func CreateDatabase(w http.ResponseWriter, r *http.Request) {
	var req createDatabaseReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if req.DBName == "" || req.DBUser == "" || req.Password == "" {
		http.Error(w, "db_name, db_user y password son requeridos", http.StatusBadRequest)
		return
	}
	if err := (services.Database{}).CreateNamedDatabase(req.DBName, req.DBUser, req.Password); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

// DeleteDatabase elimina una BD y su usuario. El usuario va como query ?user=.
func DeleteDatabase(w http.ResponseWriter, r *http.Request) {
	dbName := chi.URLParam(r, "dbName")
	dbUser := r.URL.Query().Get("user")
	if dbName == "" || dbUser == "" {
		http.Error(w, "dbName y user son requeridos", http.StatusBadRequest)
		return
	}
	services.Database{}.DropNamedDatabase(dbName, dbUser)
	w.WriteHeader(http.StatusNoContent)
}
