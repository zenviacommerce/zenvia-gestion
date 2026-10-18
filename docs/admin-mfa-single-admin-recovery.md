# MFA recovery policy amendment — review, not deployed

Production aggregate inventory (2026-10-17): workspace 7461b2b7-f383-460d-b1c7-6ccbb52e42b2 has 3 active app_users role=admin; workspace 835a7f45-7edf-4af2-b455-a8ec9c9f07e0 has 1; zero active platform_admins. Counts do not establish independent human operators or factor readiness.

## Proposed policy (requires tested code and explicit activation approval)
- Register two independent TOTP authenticators per administrator (separate physical devices); validate both by fresh challenge before enforcing MFA.
- Normal recovery uses the backup admitted factor, retaining AAL2 proof and existing session/factor checks.
- If fewer than two **independent, MFA-admitted, active** administrators can approve recovery, use owner-operated, audited break-glass with service_role, from a trusted administrative channel. Verify established owner identity outside the lost factor before doing so. Never expose service_role to frontend or make a public break-glass endpoint.
- Break-glass sequence: pause privileged writes for the affected account; record case/reason and authorized owner; revoke affected sessions and admitted factors via restricted server procedures/Auth Admin; advance security epoch and lock the principal; create a session-bound, expiring enrollment authorization; register/verify a new TOTP; recheck admitted factor and AAL2; add and verify backup device; close case and review audit. No bypass of session/tenant/role guard.
- With two or more independently controlled, MFA-admitted, reachable administrators, require different approvers. **Do not infer independence merely from number of admin accounts.**
- Determine quorum server-side at recovery time; check for promotions, inactive admins, lost factors and tenant membership; fail closed if the count is uncertain.
- The current #222 implementation still requires two independent approval references and DOES NOT implement this quorum switch. Do not deploy it as though this amendment were implemented.

## Real Auth/Vault and CI release gates
Run on isolated GitHub Actions ubuntu-latest with Docker, pinned Supabase CLI, `supabase start`, migrations applied to a disposable local database, and injected **local-only** anon/service credentials. No production secrets or tokens. Exercise real Supabase GoTrue enroll/challenge/verify (AAL1->AAL2), JWT refresh, factor revocation, two-device fallback, recovery state/epoch, direct RPC/Edge denial without AAL2, Vault handling and session-concurrency races. Upload sanitized JUnit/JSON results with no secrets and link the run. If any test is skipped, classify the gate as NOT PASSED, never green by omission. Require independent review of any SQL/Edge auth change.

## Activation
Keep `private.mfa_configuration.enabled=false` until end-to-end gates pass and owner approves. First deploy schema/Edge/browser with flags off; verify login, workers, existing pg_cron, integration flows and service-role Edge paths. Rollback deploys previous compatible frontend/Edge versions, while keeping security tables, user recovery locks and factor state. If activation has happened, disable enforcement server-side before other recovery; do not indiscriminately replace protective Edge guards.
