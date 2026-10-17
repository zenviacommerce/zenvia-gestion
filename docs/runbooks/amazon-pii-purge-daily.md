# Amazon buyer-data retention — production operations

Production migration records: `20261017183137` and `20261017184105`. These migration files are an exact archive of applied SQL; do not reapply.

## Daily schedule
- pg_cron job 15: `amazon-pii-purge-daily`, `30 2 * * *` (UTC).
- Dispatcher: `private.amazon_pii_cron_daily()`; at most 100 canonical references per invocation, max 50 per batch.
- Owner-scoped purge leases and a dispatcher advisory transaction lock protect concurrency.
- Each invocation writes to `private.amazon_pii_cron_receipts`; inspect status, counts, SQLSTATE, and run IDs. Do not log PII.

## Immediate pause (recommended)
```sql
UPDATE private.amazon_pii_cron_config
SET enabled = false, updated_at = now()
WHERE id = true;
SELECT enabled, daily_limit FROM private.amazon_pii_cron_config;
```

## Pause the calendar itself
```sql
SELECT cron.alter_job(job_id := 15, active := false);
SELECT jobid,jobname,schedule,active FROM cron.job WHERE jobid = 15;
```
Disable the kill switch before pausing the schedule; no change to other jobs.

## Resume after investigation
```sql
SELECT cron.alter_job(job_id := 15, active := true);
UPDATE private.amazon_pii_cron_config SET enabled = true, updated_at = now() WHERE id = true;
```

## Verification and incident handling
Check the latest receipts and matching `private.amazon_pii_batch_runs`, remaining eligible references, connections, running/failed Amazon jobs, and purged-row PII capability fields. Stop additional executions for the documented nontransient failures, unauthorized credentials, data loss/duplication, stuck leases or >15m jobs, Auth 5xx or >60% connections. Recovered transient 429s are documented, not rollback triggers. Never restore buyer data or remove tombstones/guards.

The first supervised invocation after historical purge recorded success and zero selected references (empty eligible queue); this confirms dispatcher behavior, not a live scheduled invocation.
