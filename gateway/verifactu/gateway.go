package gateway

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"strings"
	"time"
)

const maxRequest = 2 * 1024 * 1024
const schemaNamespace = "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd"

type Validator interface {
	Validate(context.Context, []byte) error
}
type PythonXSDValidator struct{ Script string }

func (v PythonXSDValidator) Validate(ctx context.Context, body []byte) error {
	if len(body) > maxRequest {
		return errors.New("XML_LIMIT")
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "python3", v.Script, "--stdin")
	cmd.Stdin = bytes.NewReader(body)
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	if err := cmd.Run(); err != nil {
		return errors.New("XML_VALIDATION_FAILED")
	}
	return nil
}
func validateIssuer(body []byte, issuer string) error {
	decoder := xml.NewDecoder(bytes.NewReader(body))
	path := []string{}
	header := false
	records := 0
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return errors.New("XML_INVALID")
		}
		switch value := token.(type) {
		case xml.Directive:
			return errors.New("XML_DIRECTIVE_FORBIDDEN")
		case xml.StartElement:
			if len(path) >= 64 {
				return errors.New("XML_DEPTH_LIMIT")
			}
			if len(path) == 0 && (value.Name.Local != "RegFactuSistemaFacturacion" || value.Name.Space != schemaNamespace) {
				return errors.New("XML_ROOT_INVALID")
			}
			path = append(path, value.Name.Local)
			p := strings.Join(path, "/")
			isHeader := p == "RegFactuSistemaFacturacion/Cabecera/ObligadoEmision/NIF"
			isRecord := p == "RegFactuSistemaFacturacion/RegistroFactura/RegistroAlta/IDFactura/IDEmisorFactura" || p == "RegFactuSistemaFacturacion/RegistroFactura/RegistroAnulacion/IDFactura/IDEmisorFacturaAnulada"
			if isHeader || isRecord {
				var nif string
				if err := decoder.DecodeElement(&nif, &value); err != nil {
					return errors.New("XML_IDENTITY_INVALID")
				}
				path = path[:len(path)-1]
				if nif != issuer {
					return errors.New("ISSUER_SCOPE_MISMATCH")
				}
				if isHeader {
					header = true
				} else {
					records++
				}
			}
		case xml.EndElement:
			if len(path) == 0 {
				return errors.New("XML_INVALID")
			}
			path = path[:len(path)-1]
		}
	}
	if !header || records < 1 || records > 1000 {
		return errors.New("XML_IDENTITY_REQUIRED")
	}
	return nil
}

type Gateway struct {
	enabled   bool
	issuer    string
	transport *Transport
	validator Validator
	busy      chan struct{}
}

func NewGateway(enabled bool, issuer string, transport *Transport, validator Validator) *Gateway {
	return &Gateway{enabled: enabled, issuer: issuer, transport: transport, validator: validator, busy: make(chan struct{}, 1)}
}
func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodGet && r.URL.Path == "/healthz" {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"status":"ready","environment":"test","aeatConnectionProven":false,"transportEnabled":%t}`, g.enabled && g.transport != nil && g.validator != nil)
		return
	}
	if r.Method != http.MethodPost || r.URL.Path != "/submit" {
		http.NotFound(w, r)
		return
	}
	if !g.enabled || g.transport == nil || g.validator == nil {
		http.Error(w, "TEST_TRANSPORT_DISABLED", http.StatusServiceUnavailable)
		return
	}
	select {
	case g.busy <- struct{}{}:
		defer func() { <-g.busy }()
	default:
		w.Header().Set("Retry-After", "60")
		http.Error(w, "BUSY", http.StatusTooManyRequests)
		return
	}
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/xml") {
		http.Error(w, "XML_CONTENT_TYPE_REQUIRED", http.StatusUnsupportedMediaType)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRequest))
	if err != nil {
		http.Error(w, "XML_LIMIT", http.StatusRequestEntityTooLarge)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	if validateIssuer(body, g.issuer) != nil || g.validator.Validate(ctx, body) != nil {
		http.Error(w, "XML_VALIDATION_FAILED", http.StatusUnprocessableEntity)
		return
	}
	result, err := g.transport.Submit(ctx, body)
	if err != nil {
		http.Error(w, "AEAT_TEST_TRANSPORT_FAILED", http.StatusBadGateway)
		return
	}
	// A transport receipt is never labelled as AEAT business acceptance. The caller must validate/process its SOAP response.
	w.Header().Set("Content-Type", "text/xml; charset=utf-8")
	w.Header().Set("X-AEAT-Environment", "test")
	w.Header().Set("X-Response-SHA256", result.ResponseSHA256)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(result.ResponseXML)
}
