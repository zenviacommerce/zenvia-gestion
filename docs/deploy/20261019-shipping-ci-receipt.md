# Release receipt — PR240 prepared and stopped before deployment

Reviewed source commit: `c99c866fb750f02b5d1a23e537386f5a324db95b`.
Local/remote source trees independently match `c502d58ffa36e2549c15eed3f13b2b49eb108db3`.
PR: https://github.com/zenviacommerce/zenvia-gestion/pull/240 (draft, unmerged).

## CI verified green on the exact source SHA

- Build check: https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39245393862
- Build ZENVIA Gestión: https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39245393811
- Auth resilience: https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39245393867
- MFA visual review (Playwright): https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39245393759
- Actual disposable Supabase / GoTrue / Vault integration: https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39245393834
- Vercel preview status: success. Preview: https://zenvia-gestion-git-fix-shipping-quo-c23802-sergiorojasdiaz-7097.vercel.app

Local build passed; 120/120 Vitest and 1096/1096 Node tests passed. A deliberate temporary reintroduction of four reviewed defects produced six expected regression failures (three explicit MFA restriction states, stale provider retry overwrite, insufficient lease TTL and stale cross-provider label creation); restoring the unchanged candidate passed all 38 targeted tests. No mutation-test content was pushed. Independent re-review found no remaining important issue.

## Current production / deviations

No production SQL, Edge Function, MFA flag, cohort, TOTP factor or Vercel production alias was changed. Main stays at `9183ec1ead278a2d8fa7bb1f81240011fb58fc2a`; live HTML continues to reference emergency rollback `index-BkauntMi.js` (checked during initial audit). Pilot has two verified TOTP factors, enabled=false and cohort=NULL.

(a) Amazon write reduction was NOT deployed or half-deployed; no partial (a) rollback was necessary. (d) `orders_dashboard_page_v1` is not installed. Both remain separate follow-up work after the user's requested stop.

amazon-status v21 matches the grouped-status entrypoint branch; existing owner/account/status index is present. Retention has five receipts for 2,500 deletions, 54–137 ms each, backup 12,753 rows, enabled=true/14 days/500 rows, cron 03:25 UTC. **Retention capacity deviation:** cron invokes only one 500-row batch/day. A later read-only inspection found 10,280 eligible terminal jobs older than 14 days and 3,168 jobs finished in the last 24 hours. The current schedule cannot sustain 14-day retention at that observed throughput. No silent change to its schedule/configuration was made.

Worker acquired/renewed/released leases and processed more jobs during this audit. An AMAZON_QUOTA_429 retry was observed; no failed jobs in the inspected queue. At 11:30:30 UTC, the live cycle had 47,402 success / 853 superseded / 12 queued / 1 running / 0 failed. This is a timestamped observation, not a claim that the queue remains empty.

PGRST003/57014 errors since 10:28 UTC remain UNVERIFIED because the log connector returned an internal backend error twice, including a minimal query. Vercel metadata reads returned 404; the independent live HTML check verified the rollback bundle, not deployment control-plane metadata.

## Stop and future release order

Per the user's instruction: STOP before merge or production deployment. Preview uses the existing backend, so the new Edge/SQL behavior is not active there yet. User reviews the visible changes in the browser.

Full deployment/rollback journal is in PR240 at docs/deploy/20261019-shipping-quotes-mfa-disabled.md. Before a separately authorized release, refresh live snapshots, verify the disabled-MFA public build setting is not overridden, apply/verify the 480-second SQL lease first and align its actual migration history version, then deploy the four Edge Functions in short phases without overwriting unrelated live dependency drift. SQL rollback and exact live function snapshots are committed with the PR. No rollback was executed in this task.
