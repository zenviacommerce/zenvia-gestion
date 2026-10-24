package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sync"
	"time"
)

// Cloud Run supplies short-lived tokens for its runtime service account. No downloaded key is accepted.
func NewMetadataTokenSource(input *http.Client) TokenSource {
	client := restrictedClient(input)
	var mutex sync.Mutex
	var value string
	var expires time.Time
	return func(ctx context.Context) (string, error) {
		mutex.Lock()
		defer mutex.Unlock()
		if value != "" && time.Until(expires) > 30*time.Second {
			return value, nil
		}
		ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
		defer cancel()
		r, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", nil)
		if err != nil {
			return "", errors.New("RUNTIME_IDENTITY_UNAVAILABLE")
		}
		r.Header.Set("Metadata-Flavor", "Google")
		resp, err := client.Do(r)
		if err != nil {
			return "", errors.New("RUNTIME_IDENTITY_UNAVAILABLE")
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 || resp.Header.Get("Metadata-Flavor") != "Google" {
			return "", errors.New("RUNTIME_IDENTITY_UNTRUSTED")
		}
		b, err := io.ReadAll(io.LimitReader(resp.Body, 16385))
		if err != nil || len(b) > 16384 {
			return "", errors.New("RUNTIME_IDENTITY_INVALID")
		}
		var token struct {
			Access  string `json:"access_token"`
			Type    string `json:"token_type"`
			Expires int    `json:"expires_in"`
		}
		if json.Unmarshal(b, &token) != nil || token.Access == "" || token.Type != "Bearer" || token.Expires < 1 || token.Expires > 3600 {
			return "", errors.New("RUNTIME_IDENTITY_INVALID")
		}
		value = token.Access
		expires = time.Now().Add(time.Duration(token.Expires) * time.Second)
		return value, nil
	}
}
