# Amazon performance releases — 2026-10-19

Production Vercel pinned to emergency rollback dpl_3W2T4KqMQYqspkCT6FAupXTH2jba / commit 07505dda4eb489c5016fcc218992efbaba10e96a. MFA compulsory remains enabled=false, cohort=NULL. GitHub main contains later MFA frontend; do not merge any PR to main before a separately verified disabled-MFA startup recovery fix.

## Step (c) terminal Amazon sync job retention — deployed SQL only
PR #238 perf/amazon-sync-jobs-retention-20261019; all five CI checks successful on original code commit and on latest migration/test check expected.
Applied Supabase migration registry version 20261019104723 amazon_sync_job_retention using apply_migration, with disabled kill switch initially.
Created backup private.amazon_sync_jobs_retention_backup_20261019 containing 12,753 terminal jobs older than 14 days before deletion. No FK references to amazon_sync_jobs detected.
Activated retention configuration with keep_days=14, batch_size=500. Ran five supervised batches, deleted 500 each (2,500 total), receipt mean 85 ms, max 137 ms; 5 receipts.
Worker amazon-sync-worker cron remains active (*/5 * * * *), last completed succeeded at 10:50 UTC. Worker successes 9 and failures 3 in preceding hour; don't claim there were no historic errors. Queue remained functional; no label writes.
Daily cron amazon-sync-job-retention at 03:25 UTC, function private.amazon_sync_job_retention_once; kill switch enabled=false in private.amazon_sync_job_retention_config. Rollback in PR #238 supabase/rollback/amazon_sync_job_retention_20261019.sql; backup restore uses INSERT ON CONFLICT DO NOTHING after disabling kill switch.
PR NOT merged to main to avoid redeploying MFA frontend. Repo file renamed to migration registry timestamp 20261019104723. Production frontend unchanged.

## Step (b) grouped Amazon queue counts
PR #239 perf/amazon-status-grouped-20261019. SQL dry-run and parity passed inside BEGIN/ROLLBACK. Existing index amazon_sync_jobs_owner_account_status_idx reused, no redundant index necessary. Live Edge amazon-status pre-release v20, files saved in supabase/snapshots/20261019-amazon-status-prod-v20.json in this safety branch.
