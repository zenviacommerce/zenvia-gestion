package gateway

// The application holds a public key and a signing capability, never its private key.
import (
	"bytes"
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"time"
)

type TokenSource func(context.Context) (string, error)
type KMSSigner struct {
	name   string
	public *rsa.PublicKey
	client *http.Client
	token  TokenSource
	ctx    context.Context
}

var keyResource = regexp.MustCompile(`^projects/[a-z0-9][a-z0-9-]{3,62}/locations/europe-west1/keyRings/[A-Za-z0-9_-]{1,63}/cryptoKeys/[A-Za-z0-9_-]{1,63}/cryptoKeyVersions/[1-9][0-9]*$`)

func checksum(b []byte) string {
	return strconv.FormatUint(uint64(crc32.Checksum(b, crc32.MakeTable(crc32.Castagnoli))), 10)
}
func restrictedClient(input *http.Client) *http.Client {
	if input == nil {
		input = &http.Client{}
	}
	c := *input
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	if c.Timeout == 0 || c.Timeout > 10*time.Second {
		c.Timeout = 10 * time.Second
	}
	return &c
}
func (s *KMSSigner) request(ctx context.Context, method, path string, payload any, out any) error {
	var body io.Reader
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			return errors.New("KMS_PAYLOAD")
		}
		body = bytes.NewReader(b)
	}
	token, err := s.token(ctx)
	if err != nil || token == "" {
		return errors.New("KMS_IDENTITY_UNAVAILABLE")
	}
	req, err := http.NewRequestWithContext(ctx, method, "https://cloudkms.googleapis.com/v1/"+s.name+path, body)
	if err != nil {
		return errors.New("KMS_REQUEST")
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return errors.New("KMS_UNAVAILABLE")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("KMS_HTTP_%d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 65537))
	if err != nil || len(data) > 65536 || json.Unmarshal(data, out) != nil {
		return errors.New("KMS_RESPONSE_INVALID")
	}
	return nil
}
func NewKMSSigner(ctx context.Context, name string, client *http.Client, token TokenSource) (*KMSSigner, error) {
	if !keyResource.MatchString(name) || token == nil {
		return nil, errors.New("KMS_VERSIONED_BELGIUM_KEY_REQUIRED")
	}
	s := &KMSSigner{name: name, client: restrictedClient(client), token: token, ctx: context.Background()}
	var out struct {
		PEM        string `json:"pem"`
		CRC        string `json:"pemCrc32c"`
		Name       string `json:"name"`
		Algorithm  string `json:"algorithm"`
		Protection string `json:"protectionLevel"`
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := s.request(ctx, http.MethodGet, "/publicKey", nil, &out); err != nil {
		return nil, err
	}
	if out.Name != name || out.Protection != "HSM" || out.CRC != checksum([]byte(out.PEM)) {
		return nil, errors.New("KMS_PUBLIC_KEY_INTEGRITY")
	}
	block, rest := pem.Decode([]byte(out.PEM))
	if block == nil || block.Type != "PUBLIC KEY" || len(bytes.TrimSpace(rest)) != 0 {
		return nil, errors.New("KMS_PUBLIC_KEY_FORMAT")
	}
	value, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, errors.New("KMS_PUBLIC_KEY_FORMAT")
	}
	key, ok := value.(*rsa.PublicKey)
	if !ok || !(key.N.BitLen() == 2048 || key.N.BitLen() == 3072 || key.N.BitLen() == 4096) || out.Algorithm != fmt.Sprintf("RSA_SIGN_PSS_%d_SHA256", key.N.BitLen()) {
		return nil, errors.New("KMS_RSA_PSS_SHA256_REQUIRED")
	}
	s.public = key
	return s, nil
}
func (s *KMSSigner) Public() crypto.PublicKey { return s.public }
func (s *KMSSigner) withContext(ctx context.Context) *KMSSigner {
	copy := *s
	copy.ctx = ctx
	return &copy
}
func (s *KMSSigner) Sign(_ io.Reader, digest []byte, options crypto.SignerOpts) ([]byte, error) {
	pss, ok := options.(*rsa.PSSOptions)
	if !ok || pss == nil || pss.Hash != crypto.SHA256 || len(digest) != 32 || (pss.SaltLength != rsa.PSSSaltLengthEqualsHash && pss.SaltLength != 32) {
		return nil, errors.New("KMS_TLS_RSA_PSS_SHA256_REQUIRED")
	}
	ctx, cancel := context.WithTimeout(s.ctx, 5*time.Second)
	defer cancel()
	payload := map[string]any{"digest": map[string]string{"sha256": base64.StdEncoding.EncodeToString(digest)}, "digestCrc32c": checksum(digest)}
	var out struct {
		Signature  string `json:"signature"`
		CRC        string `json:"signatureCrc32c"`
		Verified   bool   `json:"verifiedDigestCrc32c"`
		Name       string `json:"name"`
		Protection string `json:"protectionLevel"`
	}
	if err := s.request(ctx, http.MethodPost, ":asymmetricSign", payload, &out); err != nil {
		return nil, err
	}
	signature, err := base64.StdEncoding.DecodeString(out.Signature)
	if err != nil || out.Name != s.name || out.Protection != "HSM" || !out.Verified || out.CRC != checksum(signature) || rsa.VerifyPSS(s.public, crypto.SHA256, digest, signature, &rsa.PSSOptions{Hash: crypto.SHA256, SaltLength: rsa.PSSSaltLengthEqualsHash}) != nil {
		return nil, errors.New("KMS_SIGNATURE_INTEGRITY")
	}
	return signature, nil
}
