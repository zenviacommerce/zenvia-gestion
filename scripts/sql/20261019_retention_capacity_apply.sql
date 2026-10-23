BEGIN;
SET LOCAL lock_timeout='500ms';
SET LOCAL statement_timeout='5s';
DO $guard$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM private.amazon_sync_job_retention_config WHERE singleton AND enabled AND keep_days=14 AND batch_size=500) THEN RAISE EXCEPTION 'Unexpected retention configuration'; END IF;
 IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='amazon-sync-job-retention' AND active AND schedule='25 3 * * *') THEN RAISE EXCEPTION 'Unexpected retention schedule'; END IF;
END $guard$;
-- Every current eligible row must have a restore copy before the drain starts.
INSERT INTO private.amazon_sync_jobs_retention_backup_20261019
SELECT j.* FROM public.amazon_sync_jobs j
WHERE j.status IN('success','superseded') AND j.finished_at IS NOT NULL AND j.finished_at<now()-interval '14 days'
AND j.id IN (SELECT id FROM public.amazon_sync_jobs WHERE status IN('success','superseded') AND finished_at<now()-interval '14 days' EXCEPT SELECT id FROM private.amazon_sync_jobs_retention_backup_20261019);
DO $backup$
BEGIN
 IF EXISTS(SELECT id FROM public.amazon_sync_jobs WHERE status IN('success','superseded') AND finished_at<now()-interval '14 days'
 EXCEPT SELECT id FROM private.amazon_sync_jobs_retention_backup_20261019) THEN RAISE EXCEPTION 'Retention snapshot incomplete'; END IF;
END $backup$;
-- 18 executions/night x 500 rows = 9,000/day; old job name/id is retained.
SELECT cron.schedule('amazon-sync-job-retention','*/10 1-3 * * *','SELECT private.amazon_sync_job_retention_once();');
COMMIT;
