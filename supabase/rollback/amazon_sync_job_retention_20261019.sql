-- Emergency switch (safe to execute independently)
BEGIN;
UPDATE private.amazon_sync_job_retention_config SET enabled=false,updated_at=now() WHERE singleton=true;
DO $check$ BEGIN IF EXISTS(SELECT 1 FROM private.amazon_sync_job_retention_config WHERE enabled) THEN RAISE EXCEPTION 'KILL_SWITCH_FAILED'; END IF; END $check$;
COMMIT;

-- Optional recovery of saved terminal jobs, only after kill switch disabled.
-- Snapshot contains the pre-cleanup rows from 2026-10-19. DO NOT overwrite
-- newer records or requeue completed work.
BEGIN;
INSERT INTO public.amazon_sync_jobs
SELECT b.* FROM private.amazon_sync_jobs_retention_backup_20261019 b
WHERE NOT EXISTS(SELECT 1 FROM public.amazon_sync_jobs j WHERE j.id=b.id)
ON CONFLICT DO NOTHING;
COMMIT;
-- Re-check queued/running/failed and receipt counts after any recovery.
-- To disable scheduler without removing retention schema:
-- SELECT cron.unschedule('amazon-sync-job-retention');
