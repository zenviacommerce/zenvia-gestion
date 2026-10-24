# Build context is the repository root. Preparation only: no image has been deployed.
FROM golang:1.27.3-bookworm AS build
WORKDIR /src
COPY gateway/verifactu/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /gateway ./cmd/server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates python3 python3-lxml && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /gateway /app/gateway
COPY scripts/verify-verifactu-xml.py /app/scripts/verify-verifactu-xml.py
COPY docs/deploy/20261023-verifactu-phase0/contracts /app/docs/deploy/20261023-verifactu-phase0/contracts
USER 65532:65532
ENV PORT=8080 VF_TEST_SEND_ENABLED=false
EXPOSE 8080
ENTRYPOINT ["/app/gateway"]
