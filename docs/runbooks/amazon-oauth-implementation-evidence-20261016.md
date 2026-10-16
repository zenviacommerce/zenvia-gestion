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

## MFA integration and remaining activation gates

The feature branch now incorporates the administrator MFA dependency. Start obtains a trusted actor context through `security_mfa_oauth_start_context()` using the original human JWT; no session/factor/proof fields are accepted from the request body. Attempts persist immutable actor user, owner, session, factor and original second-resolution verification time. Reserve, claim and commit call the service-only live actor validator, which checks current membership, principal recovery state, session, admitted verified TOTP factor and the original five-minute recent-proof window. Its Auth rows stay locked through the transaction; the shared context guard also locks membership, actual member workspace and owner workspace. Public capability/start/callback fail closed when the hooks are absent. Manual connection behavior remains behind the merged human MFA policy and preserves its narrow private-token exception while rollout flags are off.

Actual PostgreSQL 17 SQL tests apply both branches' real helpers and reject AAL1 starts, recovery/logout/factor changes, changed or stale proof, revoked membership and suspended workspace before callback writes. Auth tables and Vault are synthetic in those tests. Real GoTrue enrollment, independent PostgreSQL connections, actual Vault rollback and HTTPS browser execution remain separate release gates, explicitly **not executed** here because Docker/psql/Chromium are unavailable. Prepared loopback-only runners are described in `amazon-oauth-browser-local.md`. Keep both rollout flags off and do not interpret the feature-branch integration as approval to activate or deploy.

## Unapplied migration packaging follow-up

Supabase CLI 2.121.0 `migration new` generated replacement pending filenames `20261016193505_amazon_app_credentials.sql` and `20261016193507_amazon_oauth_disabled.sql`, after the MFA migration `20261016191517`. SQL bytes were copied unchanged and verified equal before removing the old unapplied files. Harness/source-test references were updated. No migration was applied, no production migration history was repaired and no SQL behavior changed. The targeted PostgreSQL contract and tenant-isolation checks were rerun after the rename; the full-suite counts above describe the preceding product checkpoint.

## MFA/OAuth feature-branch integration follow-up

The OAuth feature branch merged the full administrator MFA feature branch at `a40d57de` (including helper dependency `4993c5a8`) and incorporated the timestamp-precision clarification. This is a feature-branch dependency merge, not a merge into main or authorization to deploy. The three import conflicts in App, Settings and integration-accounts were resolved by retaining both features. The OAuth first-head query sanitization and manual connection remain present; business effects and the OAuth continuation screen remain behind the merged MFA readiness gate.

The additive OAuth actor-binding migration is `20261016194232_amazon_oauth_verified_actor_binding.sql`, following MFA's `20261016194211_admin_mfa_oauth_actor_binding.sql`. It invalidates old unbound attempts and removes the old reserve overload. Claim/commit never obtain actor proof from a callback parameter. The shared context helper locks current membership, member workspace and data-owner workspace; the service actor helper locks current principal, session, admitted factor and AMR rows until the enclosing transaction ends. A refreshed JWT never renews the immutable original proof's five-minute window.

Final verification after the integration and lock fix (product checkpoint `f6b94f69`):

| Command/check | Observed result |
| --- | --- |
| `node --test scripts/*.test.mjs` | 1049 passed, 0 failed, 0 skipped |
| `npm test` | 69 passed across 5 files |
| `npm run build` | Passed; existing large-chunk warning; icon verification passed |
| Actual merged MFA helpers + OAuth SQL and existing OAuth SQL contract | 2 tests passed on PG17 PGlite; synthetic Auth/Vault |
| Browser harness `--check-guards`, default prepared-only path, and runner/helper syntax checks | Passed guard/syntax checks only; real environments NOT exercised |

The merged SQL test checks AAL1 start; recovery, principal epoch, logout/session disappearance, session expiry, missing/changed AMR, factor removal/admission/session change, active/role withdrawal, owner/member-workspace reassignment, suspension of distinct member and owner workspaces, and expired original proof at both claim and commit. Each denial preserves the prior token/version. A valid actor commits the existing IDs. The initial merged script run exposed three manager test fixtures lacking the newly merged real MFA policy adapter; fixtures were corrected to execute the real `assertMfaWithClient` policy with controlled backend results, and the final entire script run passed.

Prepared real-environment coverage now includes actual GoTrue/TOTP setup, recovery/global logout/Auth Admin factor removal, optional real-clock proof expiry, real Vault failure rollback, two independent PostgreSQL claim/quota/snapshot/row-lock cases and HTTPS/browser binding with intercepted simulated Amazon. **None of those real-environment suites ran here.** Docker, psql, Chromium and Deno are absent. The harnesses require two explicit disposable-local opt-ins, loopback API/database URLs and environment-only local keys; they do not apply migrations, deploy or contact Amazon. All rollout flags remain off; neither local feature integration nor passing synthetic SQL authorizes activation. No further push was performed by this worker; parent publication is a separate coordinated action.
