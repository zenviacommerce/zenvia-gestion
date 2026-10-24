package gateway

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"hash/crc32"
	"io"
	"net/http"
	"strings"
	"testing"
)

const syntheticKeyName = "projects/synthetic-project/locations/europe-west1/keyRings/test/cryptoKeys/mtls/cryptoKeyVersions/1"

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func fakeKMS(t *testing.T, corrupt string) (*http.Client, *rsa.PrivateKey) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	der, _ := x509.MarshalPKIXPublicKey(&key.PublicKey)
	public := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}))
	client := &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host != "cloudkms.googleapis.com" || r.Header.Get("Authorization") != "Bearer synthetic-token" {
			t.Error("unexpected authentication boundary")
		}
		var value map[string]any
		if r.Method == http.MethodGet {
			value = map[string]any{"pem": public, "pemCrc32c": fmt.Sprint(crc32.Checksum([]byte(public), crc32.MakeTable(crc32.Castagnoli))), "name": syntheticKeyName, "algorithm": "RSA_SIGN_PSS_2048_SHA256", "protectionLevel": "HSM"}
			if corrupt == "public-crc" {
				value["pemCrc32c"] = "0"
			}
			if corrupt == "software" {
				value["protectionLevel"] = "SOFTWARE"
			}
		} else {
			var p struct {
				Digest struct {
					Sha256 string `json:"sha256"`
				} `json:"digest"`
				CRC string `json:"digestCrc32c"`
			}
			if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
				return nil, err
			}
			digest, err := base64.StdEncoding.DecodeString(p.Digest.Sha256)
			if err != nil {
				return nil, err
			}
			if p.CRC != fmt.Sprint(crc32.Checksum(digest, crc32.MakeTable(crc32.Castagnoli))) {
				t.Error("digest checksum missing")
			}
			signature, err := rsa.SignPSS(rand.Reader, key, crypto.SHA256, digest, &rsa.PSSOptions{SaltLength: rsa.PSSSaltLengthEqualsHash, Hash: crypto.SHA256})
			if err != nil {
				return nil, err
			}
			value = map[string]any{"signature": base64.StdEncoding.EncodeToString(signature), "signatureCrc32c": fmt.Sprint(crc32.Checksum(signature, crc32.MakeTable(crc32.Castagnoli))), "verifiedDigestCrc32c": true, "name": syntheticKeyName, "protectionLevel": "HSM"}
			if corrupt == "signature-crc" {
				value["signatureCrc32c"] = "0"
			}
			if corrupt == "verified" {
				value["verifiedDigestCrc32c"] = false
			}
			if corrupt == "name" {
				value["name"] = syntheticKeyName + "9"
			}
		}
		b, _ := json.Marshal(value)
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(b))), Header: make(http.Header)}, nil
	})}
	return client, key
}
func token(context.Context) (string, error) { return "synthetic-token", nil }
func TestKMSSignerRSAAndBoundaries(t *testing.T) {
	client, key := fakeKMS(t, "")
	s, err := NewKMSSigner(context.Background(), syntheticKeyName, client, token)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256([]byte("synthetic TLS handshake"))
	sig, err := s.Sign(rand.Reader, digest[:], &rsa.PSSOptions{Hash: crypto.SHA256, SaltLength: rsa.PSSSaltLengthEqualsHash})
	if err != nil {
		t.Fatal(err)
	}
	if err = rsa.VerifyPSS(&key.PublicKey, crypto.SHA256, digest[:], sig, &rsa.PSSOptions{SaltLength: rsa.PSSSaltLengthEqualsHash}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Sign(rand.Reader, digest[:], crypto.SHA256); err == nil {
		t.Fatal("PKCS1 fallback must be rejected")
	}
	if _, err = s.Sign(rand.Reader, digest[:], &rsa.PSSOptions{Hash: crypto.SHA256, SaltLength: 0}); err == nil {
		t.Fatal("ambiguous PSS salt must be rejected")
	}
}
func TestKMSSignerRejectsCorruption(t *testing.T) {
	for _, kind := range []string{"public-crc", "software", "signature-crc", "verified", "name"} {
		t.Run(kind, func(t *testing.T) {
			client, _ := fakeKMS(t, kind)
			s, err := NewKMSSigner(context.Background(), syntheticKeyName, client, token)
			if kind == "public-crc" || kind == "software" {
				if err == nil {
					t.Fatal("unsafe public key accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			digest := sha256.Sum256([]byte("synthetic"))
			if _, err = s.Sign(rand.Reader, digest[:], &rsa.PSSOptions{Hash: crypto.SHA256, SaltLength: -1}); err == nil {
				t.Fatal("corrupted signature accepted")
			}
		})
	}
}
func TestKMSSignerRequiresBelgiumVersionedResource(t *testing.T) {
	for _, name := range []string{"projects/p/locations/global/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1", "https://evil.invalid/key", syntheticKeyName + "?query=bad"} {
		if _, err := NewKMSSigner(context.Background(), name, nil, token); err == nil {
			t.Fatal("invalid KMS resource accepted")
		}
	}
}
func TestNilPSSOptionsRejected(t *testing.T) {
	client, _ := fakeKMS(t, "")
	s, err := NewKMSSigner(context.Background(), syntheticKeyName, client, token)
	if err != nil {
		t.Fatal(err)
	}
	var options *rsa.PSSOptions
	if _, err = s.Sign(rand.Reader, make([]byte, 32), options); err == nil {
		t.Fatal("nil PSS options accepted")
	}
}
