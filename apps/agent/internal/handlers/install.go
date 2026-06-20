package handlers

import (
	"encoding/json"
	"net/http"

	"bezenti/agent/internal/services"
)

type installReq struct {
	App           string `json:"app"` // "wordpress"
	LinuxUser     string `json:"linux_user"`
	DocPath       string `json:"doc_path"`
	SiteURL       string `json:"site_url"`
	Title         string `json:"title"`
	AdminUser     string `json:"admin_user"`
	AdminPassword string `json:"admin_password"`
	AdminEmail    string `json:"admin_email"`
	Locale        string `json:"locale"`
	DBName        string `json:"db_name"`
	DBUser        string `json:"db_user"`
	DBPassword    string `json:"db_password"`
}

// InstallApp instala una app PHP (tipo Softaculous) en el docroot del proyecto.
// Crea la BD dedicada y luego instala la app. Si la instalación falla tras
// crear la BD, hace rollback de la BD.
func InstallApp(w http.ResponseWriter, r *http.Request) {
	var req installReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if req.LinuxUser == "" || req.DocPath == "" || req.DBName == "" {
		http.Error(w, "linux_user, doc_path y db_name son requeridos", http.StatusBadRequest)
		return
	}
	if req.App != "wordpress" {
		http.Error(w, "app no soportada: "+req.App, http.StatusBadRequest)
		return
	}

	db := services.Database{}
	if err := db.CreateNamedDatabase(req.DBName, req.DBUser, req.DBPassword); err != nil {
		http.Error(w, "creando base de datos: "+err.Error(), http.StatusInternalServerError)
		return
	}

	err := services.Installer{}.InstallWordPress(services.WordPressOpts{
		LinuxUser:     req.LinuxUser,
		DocPath:       req.DocPath,
		SiteURL:       req.SiteURL,
		Title:         req.Title,
		AdminUser:     req.AdminUser,
		AdminPassword: req.AdminPassword,
		AdminEmail:    req.AdminEmail,
		Locale:        req.Locale,
		DBName:        req.DBName,
		DBUser:        req.DBUser,
		DBPassword:    req.DBPassword,
	})
	if err != nil {
		// Rollback de la BD para no dejar basura si la instalación falló.
		db.DropNamedDatabase(req.DBName, req.DBUser)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]any{"ok": true, "app": req.App})
}
