package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	_ "github.com/go-sql-driver/mysql"

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

// DatabaseQuery prueba la conexión a una BD con las credenciales del cliente y
// ejecuta una sentencia SQL, devolviendo el resultado. Si no se da SQL, corre
// una consulta de diagnóstico (versión, BD actual, hora).
func DatabaseQuery(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DBName   string `json:"db_name"`
		DBUser   string `json:"db_user"`
		Password string `json:"password"`
		SQL      string `json:"sql"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if req.DBName == "" || req.DBUser == "" {
		http.Error(w, "db_name y db_user son requeridos", http.StatusBadRequest)
		return
	}

	stmt := strings.TrimSpace(req.SQL)
	if stmt == "" {
		stmt = "SELECT VERSION() AS version, DATABASE() AS base_de_datos, NOW() AS hora"
	}

	respond := func(v any) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(v)
	}

	// Conexión TCP como el usuario del cliente (igual que se conectaría su app).
	dsn := fmt.Sprintf("%s:%s@tcp(127.0.0.1:3306)/%s?timeout=8s&readTimeout=8s",
		req.DBUser, req.Password, req.DBName)
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		respond(map[string]any{"ok": false, "error": err.Error()})
		return
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		respond(map[string]any{"ok": false, "error": "No se pudo conectar: " + err.Error()})
		return
	}

	upper := strings.ToUpper(stmt)
	isQuery := strings.HasPrefix(upper, "SELECT") || strings.HasPrefix(upper, "SHOW") ||
		strings.HasPrefix(upper, "DESC") || strings.HasPrefix(upper, "EXPLAIN") ||
		strings.HasPrefix(upper, "WITH")

	if !isQuery {
		res, err := db.ExecContext(ctx, stmt)
		if err != nil {
			respond(map[string]any{"ok": false, "error": err.Error()})
			return
		}
		n, _ := res.RowsAffected()
		respond(map[string]any{"ok": true, "message": fmt.Sprintf("OK — %d fila(s) afectada(s)", n)})
		return
	}

	rows, err := db.QueryContext(ctx, stmt)
	if err != nil {
		respond(map[string]any{"ok": false, "error": err.Error()})
		return
	}
	defer rows.Close()

	cols, _ := rows.Columns()
	out := [][]string{}
	for rows.Next() && len(out) < 200 {
		raw := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range raw {
			ptrs[i] = &raw[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			break
		}
		row := make([]string, len(cols))
		for i, v := range raw {
			switch t := v.(type) {
			case nil:
				row[i] = "NULL"
			case []byte:
				row[i] = string(t)
			default:
				row[i] = fmt.Sprintf("%v", t)
			}
		}
		out = append(out, row)
	}
	respond(map[string]any{"ok": true, "columns": cols, "rows": out})
}

type setPasswordReq struct {
	DBUser   string `json:"db_user"`
	Password string `json:"password"`
}

// SetDatabasePassword cambia la contraseña del usuario MySQL de una BD del
// cliente (ambos hosts). La nueva contraseña la decide el control plane.
func SetDatabasePassword(w http.ResponseWriter, r *http.Request) {
	var req setPasswordReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if req.DBUser == "" || req.Password == "" {
		http.Error(w, "db_user y password son requeridos", http.StatusBadRequest)
		return
	}
	if err := (services.Database{}).SetPassword(req.DBUser, req.Password); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// AdminerLogin prepara el gestor web (Adminer) y devuelve una URL de login
// 1-clic con un token de un solo uso que inyecta las credenciales de la BD.
func AdminerLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Engine   string `json:"engine"`
		Server   string `json:"server"`
		DBName   string `json:"db_name"`
		DBUser   string `json:"db_user"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if req.DBName == "" || req.DBUser == "" {
		http.Error(w, "db_name y db_user son requeridos", http.StatusBadRequest)
		return
	}
	server := req.Server
	if server == "" {
		server = "127.0.0.1"
	}
	if err := (services.Adminer{}).Ensure(); err != nil {
		http.Error(w, "no se pudo preparar el gestor de BD: "+err.Error(), http.StatusInternalServerError)
		return
	}
	u, err := (services.Adminer{}).LoginURL(req.Engine, server, req.DBName, req.DBUser, req.Password)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"url": u})
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
