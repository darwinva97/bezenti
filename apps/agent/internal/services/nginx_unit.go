package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
)

const unitSocket = "http://localhost:8080"

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

func (NginxUnit) AddListener(user, domain, docRoot string) error {
	listener := map[string]any{
		"pass": "applications/" + user,
	}
	return unitPut("/config/listeners/"+domain+":80", listener)
}

func (NginxUnit) RemoveListener(user, domain string) error {
	return unitDelete("/config/listeners/" + domain + ":80")
}

func unitPut(path string, body any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, _ := http.NewRequest(http.MethodPut, unitSocket+path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("unit PUT %s: %w", path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("unit PUT %s: status %d", path, resp.StatusCode)
	}
	return nil
}

func unitDelete(path string) error {
	req, _ := http.NewRequest(http.MethodDelete, unitSocket+path, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("unit DELETE %s: %w", path, err)
	}
	defer resp.Body.Close()
	return nil
}
