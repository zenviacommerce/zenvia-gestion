BEGIN;
SET LOCAL lock_timeout='500ms';
SET LOCAL statement_timeout='5s';
UPDATE private.amazon_sync_job_retention_config SET enabled=false,updated_at=now() WHERE singleton;
SELECT cron.schedule('amazon-sync-job-retention','25 3 * * *','SELECT private.amazon_sync_job_retention_once();');
INSERT INTO public.amazon_sync_jobs SELECT b.* FROM private.amazon_sync_jobs_retention_backup_20261019 b
WHERE NOT EXISTS(SELECT 1 FROM public.amazon_sync_jobs j WHERE j.id=b.id) ON CONFLICT DO NOTHING;
COMMIT;
-- Cleanup stays disabled after rollback. Re-enable only after investigation.
