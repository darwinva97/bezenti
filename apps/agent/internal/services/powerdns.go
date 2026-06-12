package services

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
)

// PowerDNS habla con la API REST local del servidor autoritativo. La api-key
// la escribe el bootstrap en /etc/powerdns/pdns.d/bezenti.conf — se lee de
// ahí para no distribuir otro secret.
type PowerDNS struct{}

const pdnsBase = "http://127.0.0.1:8081/api/v1/servers/localhost"

var (
	pdnsKeyOnce sync.Once
	pdnsKey     string
	pdnsClient  = &http.Client{Timeout: 15 * time.Second}
)

func pdnsAPIKey() (string, error) {
	pdnsKeyOnce.Do(func() {
		for _, path := range []string{"/etc/powerdns/pdns.d/bezenti.conf", "/etc/powerdns/pdns.conf"} {
			data, err := os.ReadFile(path)
			if err != nil {
				continue
			}
			for _, line := range strings.Split(string(data), "\n") {
				if v, ok := strings.CutPrefix(strings.TrimSpace(line), "api-key="); ok {
					pdnsKey = strings.TrimSpace(v)
					return
				}
			}
		}
	})
	if pdnsKey == "" {
		return "", errors.New("no se encontró la api-key de PowerDNS")
	}
	return pdnsKey, nil
}

func pdnsDo(method, path string, body any) (int, []byte, error) {
	key, err := pdnsAPIKey()
	if err != nil {
		return 0, nil, err
	}
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return 0, nil, err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, pdnsBase+path, rdr)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("X-API-Key", key)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := pdnsClient.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("powerdns api: %w", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, data, nil
}

// DnsRecord es un registro tal como lo guarda el control plane.
type DnsRecord struct {
	Type     string `json:"type"`
	Name     string `json:"name"`  // "@" para el apex o etiqueta relativa
	Value    string `json:"value"`
	TTL      int    `json:"ttl"`
	Priority int    `json:"priority"`
}

type rrset struct {
	Name       string      `json:"name"`
	Type       string      `json:"type"`
	TTL        int         `json:"ttl,omitempty"`
	ChangeType string      `json:"changetype"`
	Records    []rrContent `json:"records,omitempty"`
}

type rrContent struct {
	Content  string `json:"content"`
	Disabled bool   `json:"disabled"`
}

var validZoneRe = regexp.MustCompile(`^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$`)

func canonical(zone string) (string, error) {
	zone = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(zone)), ".")
	if !validZoneRe.MatchString(zone) {
		return "", fmt.Errorf("zona inválida: %q", zone)
	}
	return zone + ".", nil
}

func fqdn(name, zone string) string {
	if name == "@" || name == "" {
		return zone
	}
	return strings.TrimSuffix(name, ".") + "." + zone
}

// content normaliza el valor según el tipo a la sintaxis que espera PowerDNS.
func content(r DnsRecord, zone string) string {
	dot := func(v string) string {
		if v == "@" {
			return zone
		}
		return strings.TrimSuffix(v, ".") + "."
	}
	switch r.Type {
	case "CNAME", "NS", "PTR":
		return dot(r.Value)
	case "MX":
		return fmt.Sprintf("%d %s", r.Priority, dot(r.Value))
	case "SRV":
		return fmt.Sprintf("%d %s", r.Priority, r.Value)
	case "TXT":
		v := strings.Trim(r.Value, `"`)
		return `"` + strings.ReplaceAll(v, `"`, `\"`) + `"`
	default:
		return r.Value
	}
}

// SyncZone crea la zona si no existe y reconcilia TODOS sus rrsets con el
// estado deseado (full-state, idempotente). El SOA no se toca.
func (PowerDNS) SyncZone(zone string, ns []string, records []DnsRecord) error {
	zc, err := canonical(zone)
	if err != nil {
		return err
	}
	if len(ns) < 1 {
		return errors.New("se requiere al menos un nameserver")
	}

	status, _, err := pdnsDo("GET", "/zones/"+zc, nil)
	if err != nil {
		return err
	}
	if status == http.StatusNotFound {
		nsDots := make([]string, len(ns))
		for i, n := range ns {
			nsDots[i] = strings.TrimSuffix(n, ".") + "."
		}
		st, body, err := pdnsDo("POST", "/zones", map[string]any{
			"name": zc, "kind": "Native", "nameservers": nsDots,
		})
		if err != nil {
			return err
		}
		if st != http.StatusCreated {
			return fmt.Errorf("powerdns create zone %d: %s", st, string(body))
		}
	}

	// Estado deseado: registros del cliente + NS del apex
	type rrKey struct{ Name, Type string }
	desired := map[rrKey]*rrset{}
	add := func(name, typ, cont string, ttl int) {
		k := rrKey{name, typ}
		if desired[k] == nil {
			desired[k] = &rrset{Name: name, Type: typ, TTL: ttl, ChangeType: "REPLACE"}
		}
		desired[k].Records = append(desired[k].Records, rrContent{Content: cont})
	}
	for _, n := range ns {
		add(zc, "NS", strings.TrimSuffix(n, ".")+".", 3600)
	}
	for _, r := range records {
		ttl := r.TTL
		if ttl < 60 {
			ttl = 3600
		}
		add(fqdn(r.Name, zc), strings.ToUpper(r.Type), content(r, zc), ttl)
	}

	// Estado actual → DELETE de lo que sobre (excepto SOA)
	_, cur, err := pdnsDo("GET", "/zones/"+zc, nil)
	if err != nil {
		return err
	}
	var zoneData struct {
		Rrsets []struct {
			Name string `json:"name"`
			Type string `json:"type"`
		} `json:"rrsets"`
	}
	if err := json.Unmarshal(cur, &zoneData); err != nil {
		return fmt.Errorf("powerdns get zone: %w", err)
	}

	var patch []rrset
	for _, existing := range zoneData.Rrsets {
		if existing.Type == "SOA" {
			continue
		}
		if desired[rrKey{existing.Name, existing.Type}] == nil {
			patch = append(patch, rrset{Name: existing.Name, Type: existing.Type, ChangeType: "DELETE"})
		}
	}
	for _, rs := range desired {
		patch = append(patch, *rs)
	}

	st, body, err := pdnsDo("PATCH", "/zones/"+zc, map[string]any{"rrsets": patch})
	if err != nil {
		return err
	}
	if st != http.StatusNoContent {
		return fmt.Errorf("powerdns patch %d: %s", st, string(body))
	}
	return nil
}

// DeleteZone elimina la zona (idempotente — 404 no es error).
func (PowerDNS) DeleteZone(zone string) error {
	zc, err := canonical(zone)
	if err != nil {
		return err
	}
	st, body, err := pdnsDo("DELETE", "/zones/"+zc, nil)
	if err != nil {
		return err
	}
	if st != http.StatusNoContent && st != http.StatusNotFound {
		return fmt.Errorf("powerdns delete %d: %s", st, string(body))
	}
	return nil
}
