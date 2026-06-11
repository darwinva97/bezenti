package handlers

import (
	"encoding/json"
	"net/http"
	"runtime"
)

func Health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"os":     runtime.GOOS,
		"arch":   runtime.GOARCH,
	})
}
