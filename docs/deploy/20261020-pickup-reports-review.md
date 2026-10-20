# 2026-10-20 — Pickup handover reports (REVIEW ONLY; NOT DEPLOYED)

## Authorized scope and behavior
User asks for printable proof of orders handed to a courier. Prepare PR, tests/green CI, desktop/mobile and PDF captures, then STOP before publishing. No migration applied to production, no main merge, no commercial labels or real reports created. Existing MFA pilot remains outside this feature.

Orders reuses existing checkboxes and page/all-filter selection. Labelled/shipped/all tabs now admit selection for reports; pending label generation retains its server eligibility and is disabled for labelled selections. Selection is capped at2000; over-limit scopes require narrower filters. Filter changes invalidate selection; global selection preserves exact IDs across pages. Preview does not drop missing/cancelled/unavailable rows silently. Creates one saved report with separate carrier sheets.

## Data and safety
New immutable pickup_reports/pickup_report_items and private transactional per-owner/year counters. Number REC-YYYY-NNNN (expands above9999). Creation UUID idempotency + payload fingerprint, owner advisory transaction lock and sorted logical-sibling row locks. Snapshots retain only sender company, order number/channel, real carrier/tracking, parcel counts, actor UUID and creation time. No buyer name, address, email, phone or raw_payload copied.

Existing auth, active workspace, orders permission and MFA are enforced in every public RPC. Direct table writes/reads denied to ordinary API roles, RLS defense in depth, fixed search_path, anon/PUBLIC EXECUTE revoked. Logical order identity includes integration account so equal Shopify numbers in different shops cannot borrow labels or receipt membership. Cancellation/purge across same-account siblings blocks stale labels; a provably newer replacement may be reported.

Existing order storage has no reliable parcel-count column. Preview proposes1 per order, explicitly marks this estimate, and requires the user to review/edit1..100 before confirming. UI sends confirmed counts; PDF/group totals use those stored counts. Repeated membership requires explicit acknowledgement. Idempotent retry preserves frozen request/counts after initial create attempt. PDF failure after successful save is reported as saved with a download-only retry; reprint loads the original snapshot and never creates a new receipt.

## Dashboard selection dependency
Pickup selection clones the exact deployed-repo dashboard SQL body at migration time, modifies only its namespace, owner predicate and pending-only eligibility. Existing public dashboard function/signature untouched. SQL parity test guards this transformation. Future dashboard filtering/dedupe migrations must refresh/review the pickup clone alongside it. Existing dashboard cross-account display dedupe behavior is not changed by this PR; report snapshot/label/membership resolution is account-isolated.

## Verification and limits
- Vitest194 tests passed, including real Orders selecting63 labelled results across25-row pages, no label purchase, report review/missing tracking/repeated membership/idempotency/PDF retry/history.
- Node1131 tests passed, including real jsPDF text extraction via the project's existing pdfjs parser: multi-carrier pages, signatures, wrapping, page numbers and no injected buyer/internal UUID fields. No new runtime dependency.
- PGlite SQL tests exercise all5 RPC permission/MFA/tenant denials, overlapping/replayed request outcomes, counter rollback/no gaps, duplicate selection, exact snapshot reprint, different Shopify accounts, cancelled stale sibling and newer replacement.
- PGlite is single session: actual simultaneous PostgreSQL lock scheduling has NOT been claimed. Advisory/row lock SQL and serial overlap outcomes are tested. Production preflight must include a reversible multi-connection concurrency rehearsal before enabling this feature.
- Playwright runs actual Orders/dialogs/PDF with synthetic service boundary, all network blocked. Desktop/mobile63 selected,2carriers, history/reprint, missing tracking, repeat warning/acknowledgement. Actual PDF pages rendered for desktop/mobile review. No fixtures enter app bundle.
- Existing build chunk-size warning retained. Exact-head CI evidence added in PR/final review receipt.
- Optional tracking QR/barcode is deferred; no unvalidated scan symbol or extra dependency introduced. Human-readable full tracking, including long wrapping, is present on every row.

## Review assets
See [capture index](pickup-review-20261020/README.md), [63-order flow PDF](pickup-review-20261020/flow-desktop.pdf), [48-order pagination stress PDF](pickup-review-20261020/pdf-manifest-sample.pdf). Synthetic sender data is visibly fixture-only.

## Future deployment and rollback (not executed)
Migration: supabase/migrations/20261020072636_pickup_reports.sql. Apply backend first only after owner review, verify permission/MFA and no PII, then publish frontend. Current reviewed production baseline c512720ad2429520c897b2961002cf8948cf53b8, index-CRlr5KXE.js (PR250); record fresh Vercel deployment at actual release.

Operational rollback: frontend Instant Rollback preserves all immutable receipts. Database removal rollback supabase/rollback/20261020_pickup_reports.sql refuses if any receipt exists; do not delete evidence after use. Restrict create RPC temporarily if necessary while retaining saved get/list access for reprints. Empty-install rollback is tested and leaves orders/dashboard untouched.

STOP: owner browser/PDF review required before production.
