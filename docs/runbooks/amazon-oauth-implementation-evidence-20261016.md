# Amazon application credentials and disabled OAuth — local implementation evidence

Date: 2026-10-16. Branch: `feature/amazon-oauth-disabled-20261016`, based on `origin/main` `1225eaaf`. Product checkpoint: `9f0ad6d1` (plus preceding manager and shared-reader commits). No deployment, push, merge, production writes, secret changes or live Amazon calls were performed.

## Implemented behavior

- Persisted private/public application identity; owner/account/seller-checked single-statement credential snapshots; private legacy LWA fingerprints compared privately to the selected named pair. Own refresh tokens win. The temporary explicitly allowlisted persisted private-account fallback remains supported; public never uses it.
- SHA-256 full-token/application/client/seller LWA cache isolation; shared manager/worker reader; transactional manual create/reconnect, quota-aware activation, pause invalidation, metadata patches, archive/disconnect and seller registry.
- OAuth remains disabled without exact flag and complete configuration. Real HMAC state, short one-use ticket, browser binding, exact EU redirects, explicit POST Auth/Origin, claim-before-single-LWA-exchange and atomic commit; generic safe results and error handling.
- Atomic archive/disconnect invalidates versions and attempts, revokes the synthetic authorization, preserves identity/history and promotes an active default. Manual and targeted OAuth reconnection restore usable snapshots with the same IDs and clear managed disconnection markers. Already-claimed untargeted attempts cannot overwrite a seller connected by a competing attempt.
- Capability-gated UI, manual action retained, first-head query stripping, in-memory continuation and backend launch URL validation. Gateway exceptions confined to start/callback with explicit application checks.

## Verification actually completed

| Command | Final result |
| --- | --- |
| `node --test scripts/*.test.mjs` | 1039 passed, 0 failed, 0 skipped |
| Integrated `amazon-oauth-*`, `amazon-app-*`, own-credentials and SP-API Node suites plus `supabase/tests/amazon_oauth_concurrency.mjs` | 54 passed, 0 failed, 0 skipped |
| `npm test` | 20 passed across 2 files |
| `npm run build` | Passed, including icon verification; existing large-chunk warning |
| `git diff --check` | Passed |

The SQL harness pins PGlite 0.3.14 and asserts PostgreSQL 17 (17.5 in this environment). Its Vault table and secret-writer are synthetic. It tests actual PostgreSQL SQL statements/transactions, ACL definitions, quotas, registry checks, expected-version failures, attempt consumption and rollback after injected completion failure. Handler concurrency tests model an atomic RPC claim and verify one exchange. These are not independent PostgreSQL connection tests or evidence of real Vault encryption/rollback.

The full script suite initially exposed two obsolete source-pattern expectations (global JSON status resolution and optional owner/environment-wide fallback). They were updated to assert the new shared reader, mandatory owner, snapshot links and narrow private exception; the final complete run passed. Expected mocked Auth retry error output remains in the existing resilience suite. No unresolved test failures were omitted.

## Remaining release and activation gates

- Disposable Supabase PostgreSQL 17 with actual Vault, production-equivalent service-role ACLs, two independent-connection races, failure injection at each write boundary and rollback rehearsal. No real Vault result is claimed.
- Real HTTPS top-level cookie flow with simulated Amazon, a separate browser and ingress/CDN/log query exclusion or redaction. No activation until these pass.
- Deno-native entrypoint checking (Deno executable unavailable here). Backend module TypeScript check passed during implementation; frontend production build passed.
- Named private credentials must be verified identical to the existing issuer before any separately authorized bundle rollout. Preserve the narrow current-account exception until its separately authorized later own-token migration.
- The service role is trusted and retains table/Vault rights for invoker RPCs. Registry triggers prevent identity/link mismatch, but do not prevent a privileged caller from directly changing credential/app columns. Alternative write paths must remain constrained and this defense reviewed before release.

See `amazon-app-credentials.md` and `amazon-oauth-disabled.md` for configuration, future preflight, sensitive-data handling and compatible rollback. Successful public credentials must never be relabeled private or read with a monolithic rollback bundle.

## MFA integration activation blocker

Do not enable OAuth after the MFA branch is integrated until the combined security path is implemented and reviewed. The current `oauth-auth.ts` calls Auth directly and does not invoke the MFA branch's trusted human guard. Attempts also do not bind the initiating Auth session/factor/recent verification, and the service-role callback claim/commit do not revalidate recovery or the live MFA/session state. The independent branches are not ready for combined activation.

Before enabling the flag, route start through the trusted human/MFA authorization RPC, bind the validated principal/session and required assurance to the attempt, and revalidate current principal, session, factor/recent verification and recovery status at both claim and commit. Test AAL1/recovery-only starts, recovery or revocation after start, stale/replaced sessions and changed factors: zero exchange or credential writes as appropriate. A passing OAuth mock or frontend MFA screen is not evidence that these checks exist. This packaging follow-up adds no substitute guard and makes no MFA integration claim.

## Unapplied migration packaging follow-up

Supabase CLI 2.121.0 `migration new` generated replacement pending filenames `20261016193505_amazon_app_credentials.sql` and `20261016193507_amazon_oauth_disabled.sql`, after the MFA migration `20261016191517`. SQL bytes were copied unchanged and verified equal before removing the old unapplied files. Harness/source-test references were updated. No migration was applied, no production migration history was repaired and no SQL behavior changed. The targeted PostgreSQL contract and tenant-isolation checks were rerun after the rename; the full-suite counts above describe the preceding product checkpoint.
