package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"

	"bezenti/agent/internal/services"
)

// Endpoints del explorador de archivos. Todos reciben el linux user del
// cliente (?user= o en el body) y rutas RELATIVAS a /var/www/<user> — el
// scoping y la validación anti-traversal viven en services.Files.

var files services.Files

func fileErr(w http.ResponseWriter, err error) {
	http.Error(w, err.Error(), http.StatusBadRequest)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func FilesList(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	entries, err := files.List(q.Get("user"), q.Get("path"))
	if err != nil {
		fileErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
}

// FilesRead sirve el contenido crudo de un archivo (editor y descargas).
func FilesRead(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f, size, err := files.Open(q.Get("user"), q.Get("path"))
	if err != nil {
		fileErr(w, err)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	io.Copy(w, f) //nolint:errcheck — error de red del cliente
}

// FilesWrite crea/sobreescribe un archivo con el body crudo (uploads y editor).
func FilesWrite(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	n, err := files.Write(q.Get("user"), q.Get("path"), r.Body)
	if err != nil {
		fileErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"written": n})
}

func FilesMkdir(w http.ResponseWriter, r *http.Request) {
	var req struct{ User, Path string }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fileErr(w, err)
		return
	}
	if err := files.Mkdir(req.User, req.Path); err != nil {
		fileErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func FilesRename(w http.ResponseWriter, r *http.Request) {
	var req struct{ User, From, To string }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fileErr(w, err)
		return
	}
	if err := files.Rename(req.User, req.From, req.To); err != nil {
		fileErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func FilesCopy(w http.ResponseWriter, r *http.Request) {
	var req struct{ User, From, To string }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fileErr(w, err)
		return
	}
	if err := files.Copy(req.User, req.From, req.To); err != nil {
		fileErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func FilesDelete(w http.ResponseWriter, r *http.Request) {
	var req struct {
		User  string
		Paths []string
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fileErr(w, err)
		return
	}
	if err := files.Delete(req.User, req.Paths); err != nil {
		fileErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func FilesChmod(w http.ResponseWriter, r *http.Request) {
	var req struct{ User, Path, Mode string }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fileErr(w, err)
		return
	}
	if err := files.Chmod(req.User, req.Path, req.Mode); err != nil {
		fileErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func FilesExtract(w http.ResponseWriter, r *http.Request) {
	var req struct{ User, Path, Dest string }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fileErr(w, err)
		return
	}
	if err := files.Extract(req.User, req.Path, req.Dest); err != nil {
		fileErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// FilesZip descarga un archivo o carpeta como zip (streaming).
func FilesZip(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	w.Header().Set("Content-Type", "application/zip")
	if err := files.Zip(q.Get("user"), q.Get("path"), w); err != nil {
		// Si ya se escribió parte del zip no se puede cambiar el status;
		// el error queda truncando la respuesta.
		fileErr(w, err)
	}
}
