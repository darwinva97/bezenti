package middleware

import (
	"net/http"
	"strings"
)

func TokenAuth(token string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			auth := r.Header.Get("X-Agent-Token")
			// strip "Bearer " prefix if present
			auth = strings.TrimPrefix(auth, "Bearer ")

			if auth != token {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
