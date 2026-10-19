# PR #240 authorized release

## Preflight — 2026-10-19 12:02 UTC

User approved ten screenshot fixtures and authorized backend first, frontend second, then stop for manual review. No carrier purchase is authorized.

- Singular regression reproduced (1 failed); fixed and rerun: shipping status + MFA UI 26/26 passed. Disabled enforcement + status RPC error message 503 mounts protected content; hung RPC also mounts. Session and explicit backend restrictions remain enforced.
- Production build passed (`index-X2i38fSY.js` locally). `Fixture sintética` found only in `scripts/shipping-visual-screenshots.mjs`, not `src`, Edge sources or `dist`. Harness is not imported into the application.
- Vercel environment metadata: no `VITE_MFA_ENFORCEMENT_ENABLED` override; committed production build flag false. Live database MFA enabled=false, cohort NULL.
- Fresh exact Edge snapshots: `supabase/snapshots/20261019-shipping-release/`: MRW22, Sendcloud tools34, Envia42, Sendcloud orders32. No drift from preparation snapshots. Deploy only changed handler/quote helper/carrier policy, preserve live MFA dependencies.
- Live shipping claim function still five minutes, ACL postgres/service_role. Existing exact SQL rollback verified: `supabase/rollback/20261019_shipping_creation_lease_before.sql`.
- Frontend rollback target: Instant Rollback `dpl_3W2T4KqMQYqspkCT6FAupXTH2jba`, old bundle `index-BkauntMi.js`; deployment READY and production aliases inspected. Do not enable MFA.

## Verification scope

Native Edge/real database probe will execute the exact production quote/label helper with a fixed existing unlabelled owner-scoped order. Carrier operations are replaced by inert callbacks; no carrier HTTP calls, purchases, labels or business-field writes. This checks lease concurrency, not live carrier prices. Remove probe access immediately after verification. Actual authenticated provider options remain for the user's browser check.

## Rollback

Redeploy each exact JSON snapshot with verify_jwt=true; restore SQL function from rollback file if reverting backend. If frontend regresses, Instant Rollback to the deployment above. Preserve release receipts and stop before any label purchase.

## Backend batch 1 — 12:03 UTC

- Applied migration; actual registry version `20261019120309`, repository/test filename reconciled to that version.
- MRW v23 and Sendcloud tools v35 ACTIVE, verify_jwt=true. Re-fetched deployed files: changed handler/helper match source exactly, original live MFA policy preserved.

## Backend batch 2 and concurrency — 12:04 UTC

- Envia v43, Sendcloud orders v33 ACTIVE, verify_jwt=true; fetched handler/helper exact matches and live MFA policy preserved in all four bundles.
- Native Deno Edge probe with exact helper + real production database, two concurrent HTTP requests per operation: quote 200/200 with identical inert options; create 409/200. All callbacks report carrierCalls=0. Receipt `20261019-shipping-concurrency-receipt.json`.
- Post-check: order lease/token TTL null; shipping_remote_id, sendcloud_parcel_id and label_created_at remain null. SQL TTL480 confirmed; anon/authenticated EXECUTE false, service_role true.
- Deviation: authenticated carrier API quotations were not exercised; helper concurrency used an isolated one-time guarded probe. Probe retired immediately to v2 constant410, no DB access/secret/helper. Gateway JWT verification remains enabled. The connector has no delete-function operation, so the inert retired endpoint remains. This is not a claim that real carrier prices were verified.

## Frontend gate and merge — 12:10 UTC

- Final source e2d2d009faba912e07ab1ee9aaa08f5432baaffa: all five workflows completed success (39249361202 Playwright; 39249361343 Auth; 39249361265 Build; 39249361304 Build check; 39249361400 disposable real integration). Real integration includes synthetic UI/PostgreSQL and actual GoTrue/Vault gates; no skipped gate inferred as success.
- Local full suites: 121 Vitest and 1,098 Node tests passed, zero failures/skips. Build passed. Specific disabled-MFA RPC503/hung tests passed before merge.
- PR240 merged only after backend verification and CI: merge SHA 966a41acca9f794e97513f7735b0aea990e0c353. Waiting Vercel; no user UI validation claimed.
