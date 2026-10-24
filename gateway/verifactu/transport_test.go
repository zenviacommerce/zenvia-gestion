package gateway

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func syntheticCertificate(t *testing.T, key *rsa.PrivateKey) ([]byte, *x509.CertPool) {
	t.Helper()
	caKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	ca := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "Synthetic test CA"}, NotBefore: now.Add(-time.Hour), NotAfter: now.Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	caDER, err := x509.CreateCertificate(rand.Reader, ca, ca, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	caParsed, _ := x509.ParseCertificate(caDER)
	leaf := &x509.Certificate{SerialNumber: big.NewInt(2), Subject: pkix.Name{CommonName: "Synthetic client"}, NotBefore: now.Add(-time.Minute), NotAfter: now.Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}}
	der, err := x509.CreateCertificate(rand.Reader, leaf, caParsed, &key.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AddCert(caParsed)
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), roots
}
func TestMTLSUsesRemoteSignerTLS12And13(t *testing.T) {
	for _, version := range []uint16{tls.VersionTLS12, tls.VersionTLS13} {
		t.Run(tls.VersionName(version), func(t *testing.T) {
			client, key := fakeKMS(t, "")
			signer, err := NewKMSSigner(context.Background(), syntheticKeyName, client, token)
			if err != nil {
				t.Fatal(err)
			}
			public, ca := syntheticCertificate(t, key)
			cert, err := ClientCertificate(public, signer)
			if err != nil {
				t.Fatal(err)
			}
			server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if len(r.TLS.VerifiedChains) == 0 {
					t.Error("mutual TLS not verified")
				}
				b, _ := io.ReadAll(r.Body)
				if !strings.Contains(string(b), "soap:Envelope") || r.Header.Get("SOAPAction") != "\"\"" {
					t.Error("SOAP boundary mismatch")
				}
				w.Header().Set("Content-Type", "text/xml")
				io.WriteString(w, "<synthetic-test-response/>")
			}))
			server.TLS = &tls.Config{ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: ca, MinVersion: version, MaxVersion: version}
			server.StartTLS()
			defer server.Close()
			roots := x509.NewCertPool()
			roots.AddCert(server.Certificate())
			cfg, err := ClientTLSConfig(cert, roots)
			if err != nil {
				t.Fatal(err)
			}
			transport := transportFor(server.URL, cfg)
			result, err := transport.Submit(context.Background(), []byte("<synthetic/>"))
			if err != nil {
				t.Fatal(err)
			}
			if result.HTTPStatus != 200 || len(result.ResponseSHA256) != 64 {
				t.Fatal("missing transport receipt")
			}
		})
	}
}
func TestCertificateKeyMismatchRejected(t *testing.T) {
	client, _ := fakeKMS(t, "")
	signer, err := NewKMSSigner(context.Background(), syntheticKeyName, client, token)
	if err != nil {
		t.Fatal(err)
	}
	other, _ := rsa.GenerateKey(rand.Reader, 2048)
	cert, _ := syntheticCertificate(t, other)
	if _, err = ClientCertificate(cert, signer); err == nil {
		t.Fatal("mismatched certificate accepted")
	}
}
func TestNoRedirectAndBoundedResponse(t *testing.T) {
	target := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("redirect followed") }))
	defer target.Close()
	for _, kind := range []string{"redirect", "oversize", "http-error"} {
		t.Run(kind, func(t *testing.T) {
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if kind == "redirect" {
					http.Redirect(w, r, target.URL, 302)
				} else if kind == "oversize" {
					io.WriteString(w, strings.Repeat("x", maxResponse+1))
				} else {
					w.WriteHeader(500)
					io.WriteString(w, "never include private upstream body in error")
				}
			}))
			defer server.Close()
			transport := &Transport{endpoint: server.URL, client: restrictedClient(server.Client())}
			if _, err := transport.Submit(context.Background(), []byte("<synthetic/>")); err == nil {
				t.Fatal("unsafe response accepted")
			} else if strings.Contains(err.Error(), "private upstream") {
				t.Fatal("upstream data leaked")
			}
		})
	}
}
func TestPinnedDestination(t *testing.T) {
	if AEATTestEndpoint != "https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP" {
		t.Fatal("unexpected endpoint")
	}
	if strings.Contains(AEATTestEndpoint, "www1.agenciatributaria") {
		t.Fatal("production destination")
	}
}
func TestXSDAndOwnerBinding(t *testing.T) {
	root, _ := filepath.Abs("../..")
	validator := PythonXSDValidator{Script: filepath.Join(root, "scripts/verify-verifactu-xml.py")}
	body, err := os.ReadFile(filepath.Join(root, "artifacts/verifactu-xml/F1-ordinary.xml"))
	if err != nil {
		t.Fatal("Generate synthetic XML fixtures before Go tests")
	}
	if err = validator.Validate(context.Background(), body); err != nil {
		t.Fatal(err)
	}
	if err = validateIssuer(body, "89890001K"); err != nil {
		t.Fatal(err)
	}
	if err = validateIssuer(body, "OTHER0000"); err == nil {
		t.Fatal("cross-owner submission accepted")
	}
	if err = validator.Validate(context.Background(), []byte("<invalid/>")); err == nil {
		t.Fatal("invalid XSD accepted")
	}
	if err = validateIssuer([]byte(`<!DOCTYPE x [<!ENTITY e SYSTEM "file:///not-read">]><x>&e;</x>`), "89890001K"); err == nil {
		t.Fatal("DTD accepted")
	}
}
func TestGatewayDisabledAndInvalidNeverSubmit(t *testing.T) {
	calls := 0
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++ }))
	defer server.Close()
	transport := &Transport{endpoint: server.URL, client: server.Client()}
	for _, enabled := range []bool{false, true} {
		g := NewGateway(enabled, "89890001K", transport, PythonXSDValidator{Script: "missing-validator"})
		r := httptest.NewRequest(http.MethodPost, "/submit", strings.NewReader("<invalid/>"))
		r.Header.Set("Content-Type", "application/xml")
		w := httptest.NewRecorder()
		g.ServeHTTP(w, r)
		if w.Code < 400 {
			t.Fatal("unsafe request succeeded")
		}
	}
	if calls != 0 {
		t.Fatal("invalid request reached transport")
	}
}
func TestHealthStatesTransportDisabled(t *testing.T) {
	g := NewGateway(false, "", nil, nil)
	w := httptest.NewRecorder()
	g.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if !strings.Contains(w.Body.String(), `"transportEnabled":false`) {
		t.Fatal("health must explicitly state disabled transport")
	}
}
func TestRejectDeepXMLBeforeValidation(t *testing.T) {
	body := `<RegFactuSistemaFacturacion xmlns="` + schemaNamespace + `">` + strings.Repeat("<x>", 2000) + strings.Repeat("</x>", 2000) + `</RegFactuSistemaFacturacion>`
	if err := validateIssuer([]byte(body), "89890001K"); err == nil || err.Error() != "XML_DEPTH_LIMIT" {
		t.Fatal("unbounded XML depth")
	}
}
func TestGatewayValidXSDThroughRemoteSignedMutualTLS(t *testing.T) {
	client, key := fakeKMS(t, "")
	signer, err := NewKMSSigner(context.Background(), syntheticKeyName, client, token)
	if err != nil {
		t.Fatal(err)
	}
	public, ca := syntheticCertificate(t, key)
	cert, err := ClientCertificate(public, signer)
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if len(r.TLS.VerifiedChains) == 0 {
			t.Error("client identity not verified")
		}
		b, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(b), "<sf:RegistroAlta>") {
			t.Error("validated fiscal record missing")
		}
		w.Header().Set("Content-Type", "text/xml")
		io.WriteString(w, "<synthetic-business-response/>")
	}))
	server.TLS = &tls.Config{ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: ca, MinVersion: tls.VersionTLS12}
	server.StartTLS()
	defer server.Close()
	roots := x509.NewCertPool()
	roots.AddCert(server.Certificate())
	cfg, _ := ClientTLSConfig(cert, roots)
	root, _ := filepath.Abs("../..")
	body, err := os.ReadFile(filepath.Join(root, "artifacts/verifactu-xml/F1-ordinary.xml"))
	if err != nil {
		t.Fatal(err)
	}
	g := NewGateway(true, "89890001K", transportFor(server.URL, cfg), PythonXSDValidator{Script: filepath.Join(root, "scripts/verify-verifactu-xml.py")})
	for _, issuer := range []string{"OTHER0000", "89890001K"} {
		requestBody := strings.ReplaceAll(string(body), "89890001K", issuer)
		r := httptest.NewRequest(http.MethodPost, "/submit", strings.NewReader(requestBody))
		r.Header.Set("Content-Type", "application/xml; charset=utf-8")
		w := httptest.NewRecorder()
		g.ServeHTTP(w, r)
		if issuer == "OTHER0000" && w.Code != 422 {
			t.Fatal("foreign issuer accepted")
		}
		if issuer == "89890001K" && (w.Code != 200 || w.Header().Get("X-AEAT-Environment") != "test") {
			t.Fatal("local end-to-end failed")
		}
	}
	if calls != 1 {
		t.Fatal("rejected input reached the mutual TLS server")
	}
}
