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
