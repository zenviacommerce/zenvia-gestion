# Shipping creation reconciliation implementation plan

> For agentic workers: execute natively using superpowers:executing-plans.

**Goal:** Recover or safely release stale carrier creations without duplication.

**Architecture:** Durable private operations and guarded owner-scoped RPCs; shared provider read-only reconciliation behind internal scheduled worker and human MFA endpoint.

**Tech Stack:** Supabase PostgreSQL, Edge Functions Deno, React/Vite and @zenvia/ui.

**Spec:** User incident request 23 October 2026; design and task sequence below.

**Global constraints:** No real shipment tests; preserve MFA; no blind creation; show exact production data UPDATE before execution; screenshots before UI publication.

# Durable label creation and reconciliation

Scope requested by owner: prevent permanent *_CREATING locks for MRW, Sendcloud and Envia; never repeat a provider creation to discover its outcome. This follows the immediate single-order recovery and MRW input correction in PR295.

## Design choices

Use a private durable operation per owner/order, recording selected provider/account, exact client reference, start time and non-PII service metadata before outbound creation. A unique open operation prevents cross-provider duplication. A ten-minute default grace exceeds the existing eight-minute order lease and Edge maximum 400s. Preserve existing MFA, owner checks, RLS and Amazon retention gates. No secrets, recipient address, DNI or signature in operation context or logs.

Use a dedicated authenticated reconcile endpoint plus an internal worker calling the same implementation. Queries are read only at the carrier. Exact account and exact reference matching are mandatory; ambiguous matches, HTTP errors, partial/paginated/incomplete responses, invalid credentials and missing label identities fail closed. A successful empty lookup may release only after the grace period; an existing unique shipment is persisted before PDF retrieval. No marketplace confirmation as a side effect. No blind TransmEnvio/create-label/ship-generate calls from reconciliation.

Alternatives considered: clearing locks by age is unsafe (duplicates); browser retry cannot cover closed sessions; durable server reconciliation covers both. Selected approach is an engineering choice within the owner's explicit requested behavior.

## Implementation sequence

- [ ] TDD: PostgreSQL operation claim/resolve with owner/account validation, uniqueness, expired worker claim, live-order-lease rejection and stale-token CAS. Add private table and service-only RPCs in a new migration, with rollback preservation of pending operations.
- [ ] TDD: provider reference lookups. MRW TrackingService tipoFiltro=1 and attempted date window; Sendcloud exact source order plus parcel lookup; Envia complete monthly guide list and exact reference then guide detail. Reject multiple active matches, malformed success and incomplete pagination. Use documented existing API contracts, never guess search endpoints.
- [ ] Wrap each provider's outbound creation in durable operation lifecycle. Preserve accepted identity before PDF retrieval (fix Envia's current PDF-before-persist order). Unknown outcomes remain pending for worker. Explicit rejection can release only when proven.
- [ ] Add endpoint and bounded worker (max five candidates/run, ten-minute stale threshold, one-minute schedule); preactivation count and exact mutation SQL shown before any data repair. No initial bulk reprocessing: current stuck count is zero.
- [ ] UI: shared Button in order drawer with Comprobar con MRW / Sendcloud / Envia, pending state and explicit recovered/released/unknown results. Refresh drawer after errors so stale snapshot does not hide the button. Do not offer a new label while creation is pending.
- [ ] Run PostgreSQL and fake-provider concurrency/unknown/PII tests, full Node/Vitest/build/Deno, independent review. Action inventory and before/after390/1280/1440 screenshots, light/dark. Journal each stage and stop before publishing visible UI per standing instruction; no real shipments in tests.

## Review focus

Provider indexing delay must not cause a duplicate; a service error must not be read as no shipments. A carrier account disabled/replaced after attempt must not silently switch account. An old cancelled shipment with the same business reference must not replace the current attempt. Recovery cannot overwrite a later accepted consignment. Removing/rolling back UI must preserve pending durable operations and reconciliation capability.
