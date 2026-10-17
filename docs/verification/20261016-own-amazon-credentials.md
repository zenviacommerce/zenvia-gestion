# Scoped legacy Amazon credentials — reconciliation candidate

Updated 2026-10-16; supersedes strict-token deployment block from 06:09UTC. User now permits a temporary global refresh token fallback for ONE exact integration account. Token migration is no longer a deployment prerequisite.

## Configuration (not applied)

Backend environment variable `AMAZON_LEGACY_FALLBACK_ACCOUNT_ID=4e55e0f5-9388-467c-b35c-a86dd4a7b383` identifies **integration_accounts.id**, not amazon_accounts.id, seller ID, workspace or owner. Read-only database check confirms linked Amazon row af6b6833-c9d7-46a4-9b62-20dd11bf529c, seller A2GUV2J3AU8FTO and matching owners. Existing AMAZON_SPAPI_CREDENTIALS stays unchanged and was not read for this task.

Stored refreshToken/refresh_token always wins. Otherwise the loader requires fetched integration.id to equal the configured allowlist AND nonempty global refresh token. Any other integration throws exactly `cuenta Amazon sin credenciales`; unset allowlist fails closed. Shared environment-only helper remains disabled. Worker-supplied owner scopes both account reads; conflicting explicit integration/job links are rejected. Legacy credentials take app/client from backend environment and seller from verified account, not request or partial Vault JSON.

Each successful fallback load logs `amazon_legacy_fallback_used` with integration_account_id and owner_id only. No token, client secret or raw Vault data. This logs credential selection, including if subsequent LWA uses a cached access token; it does not claim each event is an LWA exchange.

## Evidence

12 focused runtime tests pass: authorized account and integration-only path; second account for environment/vault rejected; both own-token key formats override; other account own token works; missing allowlist fails; blank own token counts as missing; environment helper fails; conflicting account linkage and wrong owner rejected; safe logs on every selection. RED evidence recorded before implementation. No Amazon network calls. Three real reconcile-handler regressions additionally reject inconsistent reverse links and explicit unknown source integrations before SP-API; correct linkage works. Three maintenance-handler tests cover503 before DB, CORS, default behavior. Fresh independent reviewer re-ran these six and found no remaining blockers.

Full Node suite1003/1003 green after cherry-picking only the already-approved PR215 test expectation changes. No runtime changes from main were imported. Frontend build recorded separately.

## Confirmed deployment window

User confirmed 17 October2026,08:15–08:50 Europe/Madrid (06:15–06:50UTC). Last14days:3 purchases in hour08 and0 shipments before09; shipments concentrate09–12 and21. This supports a low-activity proposal, not a guarantee of no traffic.

**STEP 1 — mandatory, before ANY function deployment, including the temporary manual maintenance deployment:** configure `AMAZON_LEGACY_FALLBACK_ACCOUNT_ID=4e55e0f5-9388-467c-b35c-a86dd4a7b383` in the project Edge Function secrets. Read it back through authenticated Supabase CLI/Management API secrets metadata; verify exact project/name and expected value or SHA-256 digest using the documented response format. Never read/print the global Amazon token, LWA secret or a PAT. Supabase documents immediate Edge availability without redeploy. If this cannot be verified, STOP: no deployment and no producer pause. No diagnostic function may be deployed to bypass this prerequisite. A Vault row, local environment variable or assumed dashboard save is insufficient. Record evidence type (remote Edge-secret configuration vs runtime environment); do not claim a runtime probe that did not occur.

Current preparation blocker: the connector exposes no secrets-management tool and CLI `secrets list --project-ref sjkxxbedkkmgmqnvaqjh` returned `AccessTokenRequiredError`; no CLI session/PAT exists here. No secret has been changed. Restore an authorized secrets-management route before the window, otherwise the window must stop at step1.

**STEP 2 — only after step1 passes:** confirm bundles and time budget; save cron1/8/9 exact definitions/active state and actual deployed function bundles/versions (code only, no buyer data). Pause producers1/8/9. Set AMAZON_SYNC_MANUAL_PAUSED=true and install the candidate manual function as a preliminary maintenance step: POST returns503 before DB/job/worker access, OPTIONS remains available. Current deployed code does not read this flag, so setting it alone is insufficient. Prove manual POST503 and no new manual jobs. This preparatory deployment touches the same manual function in the14-function set; retain/reverify it at step12. Wait for live worker lease to disappear, never forcibly steal it. Drain/inspect pending jobs and keep old worker inactive while replacing the set.

Proposed order, each verified before continuing:
1.amazon-sync-fx
2.amazon-backfill-finance-components
3.amazon-sync-inventory
4.amazon-sync-finances
5.amazon-sync-orders
6.amazon-sync-product-images
7.amazon-recipient-fallback
8.amazon-reconcile-orders
9.amazon-status
10.shopify-analytics-sync
11.amazon-confirm-shipment
12.amazon-sync-manual (still gated)
13.amazon-sync-orchestrator
14.amazon-sync-worker

Verify authenticated/internal authorization and missing/mismatched account rejection with no mutation; inspect installed bundle/source/version and shared config at each step. Do not invoke confirm-shipment with a fabricated shipment, duplicate or pending real confirmation. Its safe verification is authorization/validation denial + installed-source check; actual successful POST waits for an authorized real shipment. No dry-run is assumed to exist. A bundled code deployment alone does not prove functional Amazon writes.

On any failed verification restore every already-changed function using per-function production-snapshot bundles at09c68337c1053dba4480e3916b537a907d9a793a, stop and report. Check production has not drifted from snapshot before window; if it has, stop and capture current code for review. Restore original cron active states/manual availability only once rollback is verified. Restore manual availability last, after all other snapshot versions are verified. Removing allowlist while candidate is active stops the tokenless legacy account; it is not a safe rollback by itself.

After all functions pass: restore original producers/manual access; monitor one complete cycle: lease acquisition and release, queue empty,0failed, new financial rows/timestamps, no Auth5xx, fallback events only exact allowlisted account. No live confirmation POST as a smoke test. Then pilot purge10 and validate before remaining batches; Storage later.

## Removal after owner stores token

Observe own credential selection in worker, no fallback events for a complete cycle, verify queue/finance. Remove fallback code and allowlist in a reviewed follow-up; retaining global app client credentials is separate from removing seller refresh token. No deployment, configuration change, cron pause or production write performed in this preparation.

## Scheduled execution and post-window report

Exact start17October08:15Madrid (06:15UTC), end08:50Madrid. Never start outside this window. Leave time for rollback and a complete cycle. Send changes/evidence/deviations/rollback result immediately on completion or any blocker. After successful reconciliation, execute purge pilot10 only after the separate purge code/schema/copies/null-safe UI are deployed and verified; then remaining batches. No PII backup; Storage binaries last. MFA/OAuth/#216 are outside this deployment authorization.

Official secret availability reference: https://supabase.com/docs/guides/functions/secrets (production secrets are immediately available without function redeploy). This is the documented propagation contract, not an observed runtime read.
