# Durable Amazon confirmations implementation

Authority: approved docs/superpowers/specs/2026-10-16-amazon-confirmation-idempotency-design.md. Implementation only, no deployment or production DDL.

1. Add service-only durable ledger and atomic RPCs. Lock fulfillment order before ledger, validate owner/account/integration/marketplace, persist uncertainty before POST, fence late writers, bound GET verification, block cancellation regardless of lease expiry. Preserve current cancellation RPC definition for rollback. Test with two real PostgreSQL connections in dedicated Actions service; no production fixtures.
2. Add single-attempt transport enforcement and real shipment-module tests with intercepted HTTP. Integrate every endpoint/worker route through durable operations. Legacy attempts enter verification only. Confirmed duplicates perform no POST. Force and changed tracking cannot bypass uncertainty.
3. Return pending/needs-review status to caller and display it in existing order UI. Preserve tenant filters. Import currently deployed cancellation endpoint and dependencies, recording exact hashes and rollback source.
4. Run full Node suite, dedicated PostgreSQL/handler regressions, build, fresh whole-branch review and a single TDD fix pass for material findings. Push separate review PR; never merge or deploy.

Review focus: SQL lock order, triggers and service-only ACL; all mutations reach ledger before HTTP; crash-after-commit uncertainty; legacy ambiguity; matching evidence stronger than shipped status; cancellation races; stale holder fences; all nested retry routes; no credentials in fixtures/logs.

Execution ledger: docs/verification/20261016-confirmation-implementation-progress.md.
