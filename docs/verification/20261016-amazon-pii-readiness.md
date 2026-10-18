# Amazon PII readiness — 2026-10-16

Superseding local preparation update: the bounded SQL runner and separate control-copy scrub are now implemented in additive migration `20261016194728_amazon_pii_bounded_runner.sql`; see [runner evidence and deployment plan](20261016-amazon-pii-runner.md). Nothing has been applied or executed in production. Default execution gates remain empty; reconciliation/cycle success, deployed guard/consumer review, copy provenance review and then production pilot smoke verification are still required. Storage remains LAST. The implementation sequence and1,019-test baseline below describe the earlier preparation checkpoint; final runner verification is recorded in the linked report.

Status: local branch only; no migration applied, production writes, PII backup, cron activation, binary deletion, production pilot, merge or deployment.

Priority updated by Sergio: Amazon reconciliation → purge → MFA → OAuth → #216. Own-token migration is deferred; scoped legacy fallback permits reconciliation independently. Production credential-presence check at18:55UTC found no own token; this is no longer a gate. Production Phase2 PR214 previously verified: login, reload preserving session, logout and subsequent access requiring credentials passed; postmerge CI38865241561 green.

## Agreed implementation sequence

1. Reader inventory and tests (see consumers report). Preserve country separately for existing VAT calculations. Block carrier retrieval/label generation for purged orders, remove persistent operational-order cache, prevent duplicate rehydration.
2. Add marker, country, policy, scoped tombstone and final database write guard. Migration is preparation only and leaves all existing rows untouched.
3. Implement remaining purge orchestration/copies with the same dry-run selection, bounded batches, idempotence, leases and counts without personal data. Audit Amazon normalized tables, tracking history, jobs JSON, logs, exports and Storage; current fulfillment guard alone is NOT a complete purge.
4. Only after reconciliation and complete-cycle gates: compatible schema and consumers first; production pilot exactly10. Verify list/detail/analytics/VAT/exports before processing remaining batches (proposed50). Cron initially disabled. Storage binaries are a subsequent phase.

Historic fallback is purchase+60days, no fiscal/status exemption. Read-only production dry-run on original618 cohort:424due,194within period,0missing purchase dates,0active action leases. Former7review:4due,3notdue; all3 invoice-name matches included, unrelated invoices untouched. No personal data in evidence.

## Verification

Node baseline991 tests. Expanded Node suite1019/1019 passing: actual PostgreSQL17.5 via PGlite, actual importer function through controlled external boundary, tombstone delete/reinsert and tenant isolation, DST deadline, synthetic pilot10, recipient fallback and20 carrier-handler cases with zero external calls. Synthetic pilot is NOT the production pilot.

Focused frontend tests cover real list mobile/desktop, detail, financial table, ZIP/PDF export using synthetic bytes, stale cache, duplicate rehydration and before/after ES121gross/100net/21VAT. See final consumer evidence for counts. Physical printing, real external carrier calls and all production smoke checks remain gated. Full Vitest suite35/35 passing (20 Auth +15 PII), build passed. Existing chunk-size warnings remain. Final logs are committed alongside this report.

Fresh review found VAT loss when clearing shipping_address. Fixed using destination_country_code, selected/mapped to dedicated frontend field; regression tests also prevent stale duplicate country overriding retained country.

## Rollback

No buyer-PII backups or restoration. Anonymization is irreversible. Stop scheduled processing, retain guard/tombstone and repair readers using null-safe code. Do not remove protection or roll frontend back to incompatible code after purging. Before first purge schema/code rollback is possible because migration does not redact existing rows; after purge retained country/tombstones must survive. Existing platform backups require separate retention/access review and restore re-redaction procedure; no new copies created.
