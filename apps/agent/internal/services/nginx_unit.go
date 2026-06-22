package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"sync"
)

// El paquete Debian de NGINX Unit expone la API de control solo por
// socket unix — no por TCP.
const unitSocket = "http://unit"

var unitClient = &http.Client{
	Transport: &http.Transport{
		DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
			return net.Dial("unix", "/var/run/control.unit.sock")
		},
	},
}

type NginxUnit struct{}

func (NginxUnit) CreateApp(user, phpVersion string, memoryMB, maxProcs int) error {
	app := map[string]any{
		"type":             "php",
		"user":             user,
		"group":            user,
		"root":             "/var/www/" + user + "/public",
		"script":           "index.php",
		"options": map[string]any{
			"admin": map[string]string{
				"memory_limit": fmt.Sprintf("%dM", memoryMB),
			},
		},
		"processes": map[string]any{
			"max":              maxProcs,
			"idle_timeout":     20,
			"spare":            0,
		},
	}
	return unitPut("/config/applications/"+user, app)
}

func (NginxUnit) DeleteApp(user string) {
	unitDelete("/config/applications/" + user)
}

func (NginxUnit) UpdateLimits(user string, memoryMB, maxProcs int) error {
	patch := map[string]any{
		"processes": map[string]any{"max": maxProcs},
		"options":   map[string]any{"admin": map[string]string{"memory_limit": fmt.Sprintf("%dM", memoryMB)}},
	}
	return unitPut("/config/applications/"+user, patch)
}

// ── Apps por PROYECTO ─────────────────────────────────────────────────────────
// Cada proyecto tiene su propia app PHP en Unit (appKey estable derivado del
// project id) con docroot aislado. El ruteo por hostname NO usa listeners
// (en Unit un listener es un socket IP:puerto, no un vhost): hay UN listener
// "*:80" que pasa a /config/routes, y cada host es un step con match.host.

func (NginxUnit) CreateProjectApp(appKey, user, docRoot string, memoryMB, maxProcs int) error {
	// Dos targets: `direct` ejecuta el .php pedido tal cual (wp-login.php,
	// wp-admin/index.php); `index` enruta todo a index.php (permalinks bonitos).
	// El ruteo (SetHostRoute) sirve estáticos con `share` y manda los .php a
	// `direct` y el resto a `index`. Sin esto Unit mandaba TODO a index.php y
	// los .php directos y los assets daban 404.
	app := map[string]any{
		"type":  "php",
		"user":  user,
		"group": user,
		"targets": map[string]any{
			"direct": map[string]any{"root": docRoot},
			"index":  map[string]any{"root": docRoot, "script": "index.php"},
		},
		"options": map[string]any{
			"admin": map[string]string{
				"memory_limit": fmt.Sprintf("%dM", memoryMB),
			},
		},
		"processes": map[string]any{
			"max":          maxProcs,
			"idle_timeout": 20,
			"spare":        0,
		},
	}
	return unitPut("/config/applications/"+appKey, app)
}

// appRoot lee el docroot configurado de una app (target index) — así SetHostRoute
// puede construir el `share` de estáticos sin recibir el docRoot por parámetro.
func appRoot(appKey string) (string, error) {
	req, _ := http.NewRequest(http.MethodGet, unitSocket+"/config/applications/"+appKey, nil)
	resp, err := unitClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("unit GET app %s: %w", appKey, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var app struct {
		Root    string `json:"root"`
		Targets struct {
			Index struct {
				Root string `json:"root"`
			} `json:"index"`
		} `json:"targets"`
	}
	if err := json.Unmarshal(body, &app); err != nil {
		return "", fmt.Errorf("unit app %s no parseable: %w", appKey, err)
	}
	if app.Targets.Index.Root != "" {
		return app.Targets.Index.Root, nil
	}
	return app.Root, nil
}

// Las mutaciones de routes son read-modify-write sobre el array completo —
// serializar para no perder steps en llamadas concurrentes.
var routesMu sync.Mutex

// SetHostRoute hace que el hostname dado sirva la app indicada (reemplaza el
// step previo del mismo host si existía) y garantiza el listener "*:80".
func (NginxUnit) SetHostRoute(host, appKey string) error {
	root, err := appRoot(appKey)
	if err != nil {
		return err
	}

	routesMu.Lock()
	defer routesMu.Unlock()

	routes, err := getRoutes()
	if err != nil {
		return err
	}
	routes = removeHostStep(routes, host)

	// Dos steps por host: (1) los .php y /wp-admin/ se ejecutan directo; (2) el
	// resto sirve el archivo estático si existe (`share`) y si no, cae a index.php.
	phpStep := map[string]any{
		"match":  map[string]any{"host": host, "uri": []string{"*.php", "*.php/*", "/wp-admin/"}},
		"action": map[string]any{"pass": "applications/" + appKey + "/direct"},
	}
	shareStep := map[string]any{
		"match": map[string]any{"host": host},
		"action": map[string]any{
			"share":    root + "$uri",
			"fallback": map[string]any{"pass": "applications/" + appKey + "/index"},
		},
	}

	// Antes de un eventual catch-all del final, pero después de los steps
	// con match.scheme (el redirect http→https debe evaluarse primero).
	idx := 0
	for idx < len(routes) {
		s, ok := routes[idx].(map[string]any)
		if !ok {
			break
		}
		match, ok := s["match"].(map[string]any)
		if !ok {
			break
		}
		if _, hasScheme := match["scheme"]; !hasScheme {
			break
		}
		idx++
	}
	routes = append(routes[:idx], append([]any{phpStep, shareStep}, routes[idx:]...)...)

	if err := putRoutes(routes); err != nil {
		return err
	}
	return ensureVhostListener()
}

func (NginxUnit) RemoveHostRoute(host string) error {
	routesMu.Lock()
	defer routesMu.Unlock()

	routes, err := getRoutes()
	if err != nil {
		return err
	}
	return putRoutes(removeHostStep(routes, host))
}

// AddListener / RemoveListener (modelo por-cliente y dominios propios) usan el
// mismo mecanismo de routes — un "listener" por dominio no existe en Unit.
func (NginxUnit) AddListener(user, domain, docRoot string) error {
	return NginxUnit{}.SetHostRoute(domain, user)
}

func (NginxUnit) RemoveListener(user, domain string) error {
	return NginxUnit{}.RemoveHostRoute(domain)
}

func ensureVhostListener() error {
	// Sin `forwarded`: Unit `forwarded.protocol` sólo ajusta REQUEST_SCHEME, no
	// $_SERVER['HTTPS'] (que es lo que mira WordPress is_ssl()). Por eso dejamos
	// que Unit pase X-Forwarded-Proto tal cual (HTTP_X_FORWARDED_PROTO) y un
	// snippet en wp-config lo promueve a HTTPS=on. Ver installer.EnsureWpConfigSSL.
	return unitPut("/config/listeners/*:80", map[string]any{"pass": "routes"})
}

// EnsureBaseListener reaplica la config del listener *:80. Se llama al arrancar
// el agente para normalizar la config en nodes ya existentes tras actualizar.
func (NginxUnit) EnsureBaseListener() error {
	return ensureVhostListener()
}

func getRoutes() ([]any, error) {
	req, _ := http.NewRequest(http.MethodGet, unitSocket+"/config/routes", nil)
	resp, err := unitClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("unit GET /config/routes: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return []any{}, nil
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var routes []any
	if err := json.Unmarshal(body, &routes); err != nil {
		return nil, fmt.Errorf("unit /config/routes no es un array: %w", err)
	}
	return routes, nil
}

func putRoutes(routes []any) error {
	return unitPut("/config/routes", routes)
}

func removeHostStep(routes []any, host string) []any {
	out := make([]any, 0, len(routes))
	for _, r := range routes {
		step, ok := r.(map[string]any)
		if ok {
			if match, ok := step["match"].(map[string]any); ok {
				if h, ok := match["host"].(string); ok && h == host {
					continue
				}
			}
		}
		out = append(out, r)
	}
	return out
}

func unitPut(path string, body any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, _ := http.NewRequest(http.MethodPut, unitSocket+path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	resp, err := unitClient.Do(req)
	if err != nil {
		return fmt.Errorf("unit PUT %s: %w", path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		detail, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("unit PUT %s: status %d: %s", path, resp.StatusCode, bytes.TrimSpace(detail))
	}
	return nil
}

func unitDelete(path string) error {
	req, _ := http.NewRequest(http.MethodDelete, unitSocket+path, nil)
	resp, err := unitClient.Do(req)
	if err != nil {
		return fmt.Errorf("unit DELETE %s: %w", path, err)
	}
	defer resp.Body.Close()
	return nil
}
