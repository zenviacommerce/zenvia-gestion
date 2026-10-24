package gateway

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestMetadataIdentityIsEphemeralAndCached(t *testing.T) {
	calls := 0
	client := &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Host != "metadata.google.internal" || r.Header.Get("Metadata-Flavor") != "Google" {
			t.Fatal("metadata boundary")
		}
		return &http.Response{StatusCode: 200, Header: http.Header{"Metadata-Flavor": []string{"Google"}}, Body: io.NopCloser(strings.NewReader(`{"access_token":"synthetic-temporary-token","token_type":"Bearer","expires_in":3600}`))}, nil
	})}
	source := NewMetadataTokenSource(client)
	for range 2 {
		v, err := source(context.Background())
		if err != nil || v != "synthetic-temporary-token" {
			t.Fatal("identity unavailable")
		}
	}
	if calls != 1 {
		t.Fatal("token was not cached")
	}
}
func TestMetadataRejectsUntrustedResponse(t *testing.T) {
	client := &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"access_token":"never-use","token_type":"Bearer","expires_in":3600}`))}, nil
	})}
	if _, err := NewMetadataTokenSource(client)(context.Background()); err == nil {
		t.Fatal("missing metadata flavor accepted")
	}
}
