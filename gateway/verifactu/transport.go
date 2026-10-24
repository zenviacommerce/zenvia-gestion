package gateway

import (
	"bytes"
	"context"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"time"
)

const AEATTestEndpoint = "https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP"
const maxResponse = 2 * 1024 * 1024

type SubmissionResult struct {
	HTTPStatus     int
	ResponseXML    []byte
	ResponseSHA256 string
}
type Transport struct {
	endpoint string
	client   *http.Client
}

func ClientCertificate(publicChain []byte, signer *KMSSigner) (tls.Certificate, error) {
	var cert tls.Certificate
	for len(bytes.TrimSpace(publicChain)) > 0 {
		block, rest := pem.Decode(publicChain)
		if block == nil || block.Type != "CERTIFICATE" {
			return cert, errors.New("PUBLIC_CERTIFICATE_CHAIN_REQUIRED")
		}
		if _, err := x509.ParseCertificate(block.Bytes); err != nil {
			return cert, errors.New("CERTIFICATE_INVALID")
		}
		cert.Certificate = append(cert.Certificate, block.Bytes)
		publicChain = rest
	}
	if len(cert.Certificate) == 0 || signer == nil {
		return cert, errors.New("CERTIFICATE_REQUIRED")
	}
	leaf, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		return cert, errors.New("CERTIFICATE_INVALID")
	}
	pub, ok := leaf.PublicKey.(*rsa.PublicKey)
	if !ok || pub.N.Cmp(signer.public.N) != 0 || pub.E != signer.public.E {
		return cert, errors.New("CERTIFICATE_KMS_KEY_MISMATCH")
	}
	now := time.Now()
	if now.Before(leaf.NotBefore) || !now.Before(leaf.NotAfter) {
		return cert, errors.New("CERTIFICATE_EXPIRED_OR_NOT_YET_VALID")
	}
	clientAuth := false
	for _, usage := range leaf.ExtKeyUsage {
		if usage == x509.ExtKeyUsageClientAuth || usage == x509.ExtKeyUsageAny {
			clientAuth = true
		}
	}
	if len(leaf.ExtKeyUsage) > 0 && !clientAuth {
		return cert, errors.New("CERTIFICATE_CLIENT_AUTH_REQUIRED")
	}
	cert.Leaf = leaf
	cert.PrivateKey = signer
	cert.SupportedSignatureAlgorithms = []tls.SignatureScheme{tls.PSSWithSHA256}
	return cert, nil
}
func ClientTLSConfig(cert tls.Certificate, roots *x509.CertPool) (*tls.Config, error) {
	signer, ok := cert.PrivateKey.(*KMSSigner)
	if !ok {
		return nil, errors.New("REMOTE_KMS_SIGNER_REQUIRED")
	}
	return &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: roots, GetClientCertificate: func(info *tls.CertificateRequestInfo) (*tls.Certificate, error) {
		copy := cert
		copy.PrivateKey = signer.withContext(info.Context())
		if err := info.SupportsCertificate(&copy); err != nil {
			return nil, errors.New("TLS_RSA_PSS_NOT_SUPPORTED")
		}
		return &copy, nil
	}}, nil
}
func transportFor(endpoint string, config *tls.Config) *Transport {
	return &Transport{endpoint: endpoint, client: restrictedClient(&http.Client{Timeout: 15 * time.Second, Transport: &http.Transport{TLSClientConfig: config, DialContext: (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}).DialContext, TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: 10 * time.Second, MaxIdleConnsPerHost: 2}})}
}
func NewAEATTestTransport(cert tls.Certificate) (*Transport, error) {
	config, err := ClientTLSConfig(cert, nil)
	if err != nil {
		return nil, err
	}
	return transportFor(AEATTestEndpoint, config), nil
}
func (t *Transport) Submit(ctx context.Context, body []byte) (SubmissionResult, error) {
	var result SubmissionResult
	// The validation gateway accepts a submission body; this layer only adds SOAP 1.1.
	body = bytes.TrimSpace(body)
	if bytes.HasPrefix(body, []byte("<?xml")) {
		end := bytes.Index(body, []byte("?>"))
		if end < 0 {
			return result, errors.New("XML_DECLARATION_INVALID")
		}
		body = bytes.TrimSpace(body[end+2:])
	}
	soap := append([]byte(`<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>`), body...)
	soap = append(soap, []byte("</soap:Body></soap:Envelope>")...)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.endpoint, bytes.NewReader(soap))
	if err != nil {
		return result, errors.New("AEAT_REQUEST_INVALID")
	}
	req.Header.Set("Content-Type", "text/xml; charset=utf-8")
	req.Header.Set("SOAPAction", "\"\"")
	resp, err := t.client.Do(req)
	if err != nil {
		return result, errors.New("AEAT_TEST_TRANSPORT_UNAVAILABLE")
	}
	defer resp.Body.Close()
	result.HTTPStatus = resp.StatusCode
	if resp.StatusCode != 200 {
		return result, fmt.Errorf("AEAT_HTTP_%d", resp.StatusCode)
	}
	result.ResponseXML, err = io.ReadAll(io.LimitReader(resp.Body, maxResponse+1))
	if err != nil || len(result.ResponseXML) > maxResponse {
		return SubmissionResult{}, errors.New("AEAT_RESPONSE_LIMIT")
	}
	digest := sha256.Sum256(result.ResponseXML)
	result.ResponseSHA256 = hex.EncodeToString(digest[:])
	return result, nil
}
