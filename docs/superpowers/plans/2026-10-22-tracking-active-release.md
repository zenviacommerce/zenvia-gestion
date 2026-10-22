# Tracking active release implementation plan

> **For agentic workers:** Use executing-plans or subagent-driven-development. Execute the owner-approved release; do not add an approval stop for planning.

**Goal:** Publish approved normalized tracking with singular Incidencia, preserving the active order projection and its fail-open behavior.
**Architecture:** Add a projection-aware UI migration path, asynchronous dependency invalidation and guarded fallback; activate the existing bounded tracking worker without writing order/label/marketplace data. Preview provider observations without persistence before bounded reprocessing.
**Tech Stack:** React/TypeScript, Supabase PostgreSQL/Edge/Vault/pg_cron, Vitest/PGlite/Node.
**Spec:** docs/deploy/20261022-tracking-active-projection-compatibility-review.md and owner approval of 22 October.

## Global constraints

- Preserve #280 guarded read/versions/completeness/PII cleanup/MFA and #281 visible-only >=60 second refresh.
- Singular Incidencia for each shipment, plural Incidencias for filter.
- MRW direct uses official TrackingService GetEnvios with the existing SAGEC login/password from Vault. Never use chat passwords or automatic public web tracking. Validate real shipments read-only before activation; retain the manual link when service is unavailable.
- No reprocessing of delivered/returned/cancelled shipments. Show provider/state counts before writes; validate identity/account/tenant again at apply time.
- Preserve reset boundary 2026-10-22 09:19:20.702302 UTC; no further reset. Scheduled comparison 23 October around11:20 Europe/Madrid.

## Review focus

- Repeated same-transaction updates and tracking changes must reject stale projection reads.
- Missing queue/failure ledger must never reject business writes or reveal stale PII.
- Account, label identity and tenant changes invalidate in-flight observations.
- Preview has no persistence or subscription/label/marketplace effects.
- Rollback restores normalized semantics with original security wrappers and immediate switches.

## Tasks

- [ ] SQL adapter: reproduce UNION failure and stale60/59; implement additive projection-aware dispatch, normalized source and cache parity, tracking dependency versions, generation/repair, rollback. Run complete relevant SQL suite and full application suite.
- [ ] UI: test singular state/table/history and plural filter, change central label, regenerate affected screenshots, preserve header and published refresh.
- [ ] Worker active mode: accept only approved shadow/active values; mode schema upgrade defaults to shadow; test active Sendcloud/Envia and MRW no-password/noHTTP plus kill switch.
- [ ] Reprocessing preview: read current eligible identities, fetch only read-only provider observations; report provider+before/after state counts, errors and terminal/configuration exclusions. Tests prohibit writes and exclude terminal rows. Bounded apply validates identity and eligibility again.
- [ ] Release: independent code review, publish branch with exact tree/lease, require CI green. Capture schema/functions/settings, install backend then UI, preserve MFA dependencies, verify current RPC parity/normalized filters/history and deployed bundle. Record rollback and changes inside24hwindow.
- [ ] Show dry-run counts in conversation, then authorized bounded reprocessing and reconcile; report verified outcomes, no delivered writes.

## Ordered follow-up backlog

After tracking publication, MRW classification and active-shipment reprocessing, publish the compact pickup-report PDF separately. Then: (1) registrar envío externo; (2) reetiquetar tras cancelar; (3) cancelar envíos desde Zenvia; (4) bug Cancelado derivado del texto (a shared classifier fix in this release remains a prerequisite, avoid duplicate work); (5) eliminar pedidos con papelera — design first; (6) Sin coste instead of Margen100%; (7) Amazon Mes anterior; (8) token propio de Amazon. Each feature uses an isolated reviewable change. Do not perform real carrier cancellations or deletions to test UI.

Remaining compute work (<50ms, Broadcast, cron idle exits, tenant observability and10/50/200client estimates) remains recorded in compute-cost-plan; observe the existing24hwindow and report changes that affect comparability.
