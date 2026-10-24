package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"regexp"
	"syscall"
	"time"
	gateway "zenvia/verifactu-gateway"
)

func main() {
	enabled := os.Getenv("VF_TEST_SEND_ENABLED") == "true"
	var transport *gateway.Transport
	issuer := os.Getenv("VF_ISSUER_NIF")
	if enabled {
		// No accidental localhost sender and no general-purpose public signing proxy.
		if os.Getenv("K_SERVICE") == "" || !regexp.MustCompile(`^[A-Z0-9]{9}$`).MatchString(issuer) {
			log.Fatal("TEST_CONFIGURATION_REQUIRES_PRIVATE_CLOUD_RUN_AND_BOUND_ISSUER")
		}
		signer, err := gateway.NewKMSSigner(context.Background(), os.Getenv("VF_KMS_KEY_VERSION"), nil, gateway.NewMetadataTokenSource(nil))
		if err != nil {
			log.Fatal("KMS_INITIALIZATION_FAILED")
		}
		chain, err := os.ReadFile(os.Getenv("VF_PUBLIC_CERTIFICATE_CHAIN"))
		if err != nil {
			log.Fatal("PUBLIC_CERTIFICATE_CHAIN_UNAVAILABLE")
		}
		cert, err := gateway.ClientCertificate(chain, signer)
		if err != nil {
			log.Fatal("CERTIFICATE_CONFIGURATION_INVALID")
		}
		transport, err = gateway.NewAEATTestTransport(cert)
		if err != nil {
			log.Fatal("TEST_TRANSPORT_CONFIGURATION_INVALID")
		}
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	if !regexp.MustCompile(`^[0-9]{2,5}$`).MatchString(port) {
		log.Fatal("PORT_INVALID")
	}
	script := os.Getenv("VF_XSD_VALIDATOR_SCRIPT")
	if script == "" {
		script = "/app/scripts/verify-verifactu-xml.py"
	}
	handler := gateway.NewGateway(enabled, issuer, transport, gateway.PythonXSDValidator{Script: script})
	server := &http.Server{Addr: ":" + port, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16384}
	done, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-done.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()
	log.Print("VERIFACTU_TEST_GATEWAY_STARTING_NO_PRODUCTION_TRANSPORT")
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal("HTTP_SERVER_FAILED")
	}
}
