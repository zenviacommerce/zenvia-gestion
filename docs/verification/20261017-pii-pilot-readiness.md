# Main alignment and Amazon PII pilot readiness — 17 October 2026

## Changes

PR #225 merged the reconciliation branch into main (merge 0c1a5d66fd592f3a116c2805aaef185d4262f198). Main divergence was only a README conflict; current main changes were retained before merge. All fourteen fresh production bundles were downloaded again, every one of their 84 files compared against the candidate and main Git blob hashes, and JWT settings compared. Zero differences.

PR #226 removed the obsolete README deployment warning after that comparison, documented the archived snapshot and Phase 3 connection/telemetry requirements. Current main: 19fb2f2374a3a01d4c9ada1e2510dff34cfe2a21. Its same 84 source blobs were checked again: unchanged and matching production.

Historical refs both point to 09c68337c1053dba4480e3916b537a907d9a793a: original sync/production-snapshot-20261015 retained unchanged; archive/production-snapshot-20261015 created. GitHub has no individual-branch archive switch: naming plus docs/verification/production-snapshot-archive.md identify the snapshot as historical, without deleting the original. Archive naming is not a branch protection rule.

Draft PR #224 contains the purge preparation. Independent review identified two material issues before deployment:
- Carrier/logistics code checked an old snapshot without holding an external-read lease. Five handlers now wrap the whole operation in withAmazonBuyerRead: atomic owner-scoped service RPC, lease throughout outbound work, owner+holder release in finally, fail closed if purged/busy. Lease duration is 480 seconds, beyond Edge's 400-second lifetime. A trigger also extends legacy shipping/confirmation leases from five minutes to at least 480 seconds and refuses opening a lease on a purged row. This does not implement or deploy #216's confirmation behavior.
- Control minimization erased quota/credential classifications. It now retains only allowlisted operational codes (quota 429, invalid_grant/client, missing credentials/auth denial, transient 5xx/network, generic). Free-form messages and synthetic PII are removed; retry and incident classes remain distinguishable. The historical scrub affects owner-level job/run/state controls, not just ten selected orders; it is a separate reviewed minimization operation and has not run.

A further deployed-writer review found cancellation operations as an additional copy/race surface. Current linked audit rows and cancellation rows are both0, but the runner now excludes active cancellations (including all duplicates), rechecks them after locking, redacts closed cancellation details/message/remote capability/reference for selected orders, includes their counts in preview/receipt and the500-row total budget, and rejects starting a cancellation after purge. The regression first reproduced admission of an active cancellation and now passes. Real PostgreSQL temporary verification also covered this case.

No purge migration, new carrier guard, purge frontend, buyer anonymization, backup, invoice update or Storage deletion was applied in production.

## Exact verification checklist

| Check | Method | Success criterion | Result |
|---|---|---|---|
| Main equals Edge production | Fresh get_edge_function for fourteen; content equality plus main tree blob SHA; compare JWT flags | 84/84 matching files, fourteen correct flags | PASS; #225/#226 |
| Ten expired canonical orders | Read-only owner-scoped grouping; reject conflicting references; newest duplicate purchase; exclude active leases; purchase +1440 hours | Exactly ten; every duplicate expired; identical cohort fingerprint immediately before any eventual write | PASS as preview at 14:28:26 Madrid; must repeat immediately before execution |
| Runner semantics on real PostgreSQL | scripts/amazon-pii-real-postgres.mjs; only pg_temp synthetic fixtures, transaction ends ROLLBACK | Dry run writes zero; exactly ten; same fingerprint; idempotent; tenant B unchanged; economic facts retained; rehydration rejected | PASS on PostgreSQL17.6; zero buyer rows touched |
| Concurrent purgers | Separate real sessions; hold exact owner advisory key, call real runner against isolated synthetic fixtures | Second session receives 55P03; zero changed rows | PASS: PIDs85376/85378 |
| Concurrent writer vs purger | --writer / --contender modes, same real DB, separate sessions and isolated pg_temp fixtures; actual write trigger holds shared advisory order keys | Runner rejects with55P03 while writer active; zero changed rows; transactions release locks | PASS: PIDs85578/85580. This tests real shared advisory fences; it is not a same-physical-production-row race test |
| External read vs purge | Controlled held operation through real helper + SQL lease tests | Lease remains until response/error; denied claim makes zero outbound calls; active lease excludes cohort; purged/other-owner rows cannot be opened; TTL exceeds400s | PASS in code/synthetic fixtures and real PostgreSQL temp transaction; deployment attestation still required |
| Stale carrier snapshots | Actual five compiled handlers, four actions each, real shared helper | Fresh DB claim returns purged →410 and zero outbound calls, despite stale null marker | PASS; twenty stale plus twenty already-purged cases |
| All buyer copies | Enumerate fulfillment columns/raw JSON/items/capabilities; normalized Amazon tables and financial metadata/identifier contracts; control copies, audit associations, logs and Storage boundaries | Every retained field justified; every expired copy has scoped removal/protection; no invoice cross-scope changes | Financial evidence below; all-surface production gate remains unset |
| Compatible deployment | Review and deploy null-safe frontend/cache/VAT/export, DB guards/RPCs and carrier helper together; read back all writers/flags; wait >400s plus margin after final external writer deployment | Actual production runs compatible code; old in-flight requests drained; no synthetic-test substitution | NOT EXECUTED: production access blocked; no readiness gate preapproved |
| Pilot dry run/write | Re-run exact service RPC preview; compare fingerprint and unchanged economic aggregates; fixed run UUID; pilot limit10 | Preview and receipt match, exactly ten canonical orders, no others, errors0 | NOT EXECUTED; no irreversible write while earlier gates unmet |
| Production smoke | Authenticated mobile/desktop list and detail of pilot references; analytics; CSV/PDF exports; gross/net/VAT and preserved country; labels/tracking blocked | No broken screen/process; no null exceptions; exact financial totals; no buyer data or capability re-exposure | BLOCKED by Vercel protection and absent application session; cannot claim production UI success |
| Subsequent sync | Import the same purged reference through real application importer; observe a natural sync and query markers/copy counts | Zero buyer fields repopulated; stable tombstones; amounts/SKU/country intact | Local real-importer tests PASS; production post-pilot verification NOT RUN because pilot not run |

### Current ten-order preview

At 2026-10-17 12:28:26.766104UTC (14:28Madrid): exactly10 canonical orders /10 fulfillment rows, purchases from 2026-02-11 11:21:11UTC through 2026-04-04 10:03:03UTC. Latest purchase+60-day deadline: 2026-06-03 10:03:03UTC. All ten expired. Opaque cohort fingerprint: bcf702392d8b4df8ac1037ce1a328690. This is an equivalent read-only canonical SQL preview; the production runner RPC is not installed. It is not a purge receipt or a fixed cohort guaranteed against future source changes.

No verified delivery source exists in the inspected schema, so no delivered-status inference was used. No status or Amazon fiscal exemption; unrelated invoices untouched. No buyer values/order list were exported in evidence.

### Real PostgreSQL verification reproduction

Generate the full transaction with node scripts/amazon-pii-real-postgres.mjs. It uses the current migration function bodies, remapping public/private references only into pg_temp; synthetic tables and data are rolled back. It validates lease refusal, minimum480s lifetime, post-purge lease rejection, exact-ten/idempotence/economic invariants and SQL anti-rehydration.

For the two-session writer test, generate --writer and --contender. Start writer, confirm zenvia_pii_writer_test is in PgSleep, execute contender before the ten-second hold ends. Setup alone disables the contender's own synthetic write fence while seeding; it is re-enabled before invoking the unchanged runner. The writer's real trigger remains enabled and holds the actual shared advisory key. Never substitute these synthetic transactions for deployed-consumer/browser attestation.

### Financial copy evidence

All 44,185 finance rows were included in a flat identifier-type/format census. Only eight names occurred: DEFERRED_TRANSACTION_ID(20,893), FINANCIAL_EVENT_GROUP_ID(44,185), OBFUSCATED_SHIPMENT_ID(41,795), ORDER_ID(43,211), REFUND_ID(1,103), RELEASE_TRANSACTION_ID(17,183), SETTLEMENT_ID(44,185), SHIPMENT_ID(41,795). Every value was identifier-shaped; no email/whitespace matches. Values were never returned.

The official Amazon model was retrieved via GitHub at af0be99a754fba53d46d6a845a5aba8f99f077c4, models/finances-api-model/finances_2024-06-19.json. Seven observed names are enumerated related business identifiers. OBFUSCATED_SHIPMENT_ID is absent from that enum; all41,795 are paired with SHIPMENT_ID but differ. Identifier-shaped text alone does not establish complete buyer-data provenance; that specific undocumented type still needs authoritative mapping before declaring the entire copy gate closed. No financial identifiers/keys were removed or changed to force a pass.

The full recursive metadata census completed: 44,185 rows in45 bounded batches, depth32, zero nonempty containers left at the depth limit. Only breakdownAmount, breakdownType, breakdowns, currencyAmount, currencyCode and marketplaceId occurred. No free-form metadata values were retrieved. Current installed safeTransactionMetadata/safeIdentifiers source was attested in the84-file production comparison. Provider logs, remote carriers and Storage are separate retention domains; no claim of their deletion follows from SQL tests.

## Test evidence

- New error classifier failed first (AMAZON_SYNC_ERROR versus expectedAMAZON_QUOTA_429), then passed.
- New external read RPC failed first as absent, then passed.
- Legacy lease regression failed first at the old300-second lifetime, then passed.
- Node full final: 1,075/1,075 PASS. Five harness regressions from loading the new real helper were found in the first full run (MRW label retry and four tracking endpoint cases), corrected to load the actual helper, and passed in the final full suite.
- New cancellation regression failed first because the active operation did not prevent purge, then passed; final real PostgreSQL temporary transaction also confirmed active refusal and closed-copy redaction.
- Vitest:35/35 PASS; frontend build PASS. Existing bundle-size warnings remain.
- Real PostgreSQL17.6 temporary verification PASS; owner/writer concurrency tests above PASS. All production buyer rows untouched.

## Deviations and concrete blocker

The user authorized the pilot only after checks pass. They do not all pass yet. Vercel production navigation redirects to its login protection. The connector's web_fetch_vercel_url failed403 at read_protection_bypass; no mapped CLI fallback exists and Vercel CLI is unavailable. An explicit project/team read also failed404. No Vercel login, protection setting change, Supabase dashboard login or access-token impersonation was attempted.

To complete authenticated production checks, the Vercel connection must have access to project prj_L6nGgpq78QTEnZByUNtjtmF5rGkv in team team_k0AO6trehO3oBKWWG1tap1un, plus an authorized application test session/account. That is an access prerequisite, not another request to approve the already-authorized ten-order pilot. Once access and copy/deployment gates are complete, repeat preview immediately and execute only ten.

## Rollback and stop rules

No irreversible production change has occurred in this stage, so no buyer data rollback is needed. Synthetic DDL/DML ended ROLLBACK. Proposed guards remain in draft #224. Any regression after a future pilot stops processing, keeps tombstones/anti-rehydration guards and fixes consumer code; never restore buyer PII or create a buyer backup.

After a successful pilot and smoke/post-sync checks, publish the receipt and wait for the user's explicit confirmation before remaining batches. Do not enable pilot_verified_at/batch execution as an implicit authorization for the rest. Storage remains a later phase. MFA/OAuth/#216 untouched.

Phase3: docs/phase3/connection-budget-and-sp-api-telemetry.md now records the36/60 observed connection budget and the exact per-endpoint/per-account attempt telemetry requirements.

## Separate deployed-function finding outside the fourteen

Read-only inspection of order-cancellation v2 found its own bundled older _shared/amazon/config.ts. It owner-scopes the integration lookup but permits the global refresh token whenever credential_source==='environment'; it does not have the integration-ID allowlist used by the fourteen reconciled functions. Thus this bundle must not be represented as covered by the fourteen-function allowlist proof. This pre-existing function was not deployed or changed in this task. Its source/bundle should be reconciled and tested before another tenant can use environment-backed credentials. The database cancellation fences in this draft address purge concurrency, not this separate credential selection issue.
