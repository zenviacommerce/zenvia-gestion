# Amazon credentials by issuing application

`private_v1` and `public_v1` identify the app that issued an account's own refresh token. They are not interchangeable. Read owner, seller, app, credential version and token from one service-only SQL snapshot. Writers must commit token, app, version and links together. Missing own credentials fail closed except for the explicit temporary private-account exception below; `invalid_grant` never retries another app.

## Mandatory merge and deployment gates

The reader preserves reconciliation's explicit temporary exception via `AMAZON_LEGACY_FALLBACK_ACCOUNT_ID`, which must identify the persisted integration `4e55e0f5-9388-467c-b35c-a86dd4a7b383` in the current release. Only `private_v1`, a validated owner/account snapshot and a missing own token can use it; own credentials always win, public never falls back, and a conflicting global seller is rejected. The fallback emits only integration/owner IDs. Do not widen it or accidentally remove it in a future merge. Token migration remains a separately authorized later task; OAuth/MFA do not require doing it first. Keep OAuth disabled. Named private app secrets must still match the current issuer before a future bundle rollout.

The seller registry protects owner/link identity, but currently does not stop a trusted service-role caller directly updating the credential secret or app outside transactional writers. This required defense remains incomplete: prohibit deployment until alternative credential/app writes enforce the transaction contract. Do not claim registry triggers close this gap. PGlite SQL checks are not proof of true concurrent PostgreSQL 17/Vault transactions. Real disposable database concurrency and rollback gates remain required.

## Backend pair preflight and future release

The following operations require separate release authorization. Never print secrets, payloads or credential hashes in commands, chat, release records, frontend, logs or audit events.

1. Inventory metadata: account/integration IDs, owner, seller, enabled status, app/version, marketplace and job links. Resolve duplicate sellers, mismatched owner/IDs, absent own tokens and incomplete legacy pairs before migration, without transferring accounts.
2. A snapshot reports legacy pair presence and individual SHA-256 fingerprints privately to the backend, without exposing the pair. The backend hashes the selected named application pair and accepts only both exact matches. Partial/mismatched pairs fail closed. Never print those fingerprints or put them in telemetry. Compare legacy and proposed private client ID/secret in a backend-only process. Emit only per-account completeness/equality booleans, never values or hashes. Require the complete pair from one source. Partial, discrepant or ambiguous pairs block release. Never combine halves or rotate the pair to force equality.
3. In an approved secret-management operation, copy the identical verified private pair to `AMAZON_SPAPI_PRIVATE_V1_CLIENT_ID` and `AMAZON_SPAPI_PRIVATE_V1_CLIENT_SECRET`. Preserve issuer, own refresh token, IDs, seller, marketplaces and worker behavior. Public uses independent `AMAZON_SPAPI_PUBLIC_V1_CLIENT_ID` and `AMAZON_SPAPI_PUBLIC_V1_CLIENT_SECRET`; these are unnecessary for mocked/private-only tests. No VITE credentials. Configuring public never relabels private tokens.
4. Capture schema, migration list, `pg_get_functiondef`, owner/ACL, deployed bundles and account-to-app/version map, without secret payloads. Identify a rollback bundle that understands both apps and restrict access to the record.
5. Verify the additive migration against disposable PostgreSQL 17/Vault. Backfill existing Amazon accounts to private, enforce known app keys and non-Amazon NULL. Verify anon/authenticated cannot execute snapshot/writer RPCs or access Vault. Validate explicit owners and coherent snapshots.
6. Deploy manager, worker, diagnostics and shared LWA/cache consumers together only in an approved window. Audit remaining inline LWA and fallback paths. Keep `AMAZON_PUBLIC_OAUTH_ENABLED` off. Validate full-token hash/client/app cache separation without printing keys/hashes.
7. In an approved smoke window, confirm the same private pair and own token, unchanged IDs/seller/marketplaces/jobs and a normal worker cycle. Do not perform shipment confirmations, sends or incidental live Amazon calls. Record actual results.

## Validation

Use synthetic tokens and LWA mocks that reject unexpected network. Cover private with public absent; distinct apps/tokens; unknown/incomplete pairs; absent own token; owner/ID mismatch; disabled account; invalid_grant without alternate-app retry; full-token hash cache isolation and rotation. Concurrent readers must observe a coherent old or new app/token/version tuple.

Run actual loopback PostgreSQL 17/Vault snapshot/manual/OAuth tests and independent-connection concurrency harnesses. Unavailable/skipped database tests, PGlite, static SQL scans or fake Vault are not passing release gates. Rehearse schema/ACL/definition rollback with synthetic private and public accounts. Run the Node Amazon suites, `npm test` and `npm run build` on final code. Use the implementation handoff for exact actual counts; test existence does not imply success.

## Compatible rollback

With only private accounts retain additive columns and return only to an own-token-compatible reader using the verified private issuer. With any public account, disable new OAuth starts/returns in an authorized operation and restore the last verified two-app-aware reader/writer. Never return to a monolithic reader or fallback that treats public as private.

Preserve successful tokens, Vault references, integration/Amazon IDs, seller ownership, app and version. Never relabel public as private, delete public tokens to simplify rollback, retry another pair or revoke Amazon merely to test rollback. Metadata retirement requires an explicit later migration, metadata export and proof that no public accounts remain. UI/endpoint rollback does not remove the need for app-aware readers.

## MFA integration and remaining activation gates

The feature branch now incorporates the administrator MFA dependency. Start obtains a trusted actor context through `security_mfa_oauth_start_context()` using the original human JWT; no session/factor/proof fields are accepted from the request body. Attempts persist immutable actor user, owner, session, factor and original second-resolution verification time. Reserve, claim and commit call the service-only live actor validator, which checks current membership, principal recovery state, session, admitted verified TOTP factor and the original five-minute recent-proof window. Its Auth rows stay locked through the transaction; the shared context guard also locks membership, actual member workspace and owner workspace. Public capability/start/callback fail closed when the hooks are absent. Manual connection behavior remains behind the merged human MFA policy and preserves its narrow private-token exception while rollout flags are off.

Actual PostgreSQL 17 SQL tests apply both branches' real helpers and reject AAL1 starts, recovery/logout/factor changes, changed or stale proof, revoked membership and suspended workspace before callback writes. Auth tables and Vault are synthetic in those tests. Real GoTrue enrollment, independent PostgreSQL connections, actual Vault rollback and HTTPS browser execution remain separate release gates, explicitly **not executed** here because Docker/psql/Chromium are unavailable. Prepared loopback-only runners are described in `amazon-oauth-browser-local.md`. Keep both rollout flags off and do not interpret the feature-branch integration as approval to activate or deploy.
