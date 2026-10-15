-- Fase 0: only pg_cron execution logs, never business queues.
-- Retention: 7 days; at most 10 batches of 5000 per daily run.
CREATE OR REPLACE FUNCTION private.prune_cron_job_run_details()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '20s'
SET lock_timeout = '500ms'
AS $function$
DECLARE
  v_deleted integer;
  v_total integer := 0;
  v_batch integer;
BEGIN
  FOR v_batch IN 1..10 LOOP
    WITH doomed AS (
      SELECT d.ctid
      FROM cron.job_run_details AS d
      WHERE d.end_time < clock_timestamp() - interval '7 days'
      ORDER BY d.end_time
      LIMIT 5000
    ),
    deleted AS (
      DELETE FROM cron.job_run_details AS d
      USING doomed
      WHERE d.ctid = doomed.ctid
      RETURNING 1
    )
    SELECT count(*) INTO v_deleted FROM deleted;
    v_total := v_total + v_deleted;
    EXIT WHEN v_deleted < 5000;
    PERFORM pg_catalog.pg_sleep(0.2);
  END LOOP;
  RETURN v_total;
END;
$function$;

REVOKE ALL ON FUNCTION private.prune_cron_job_run_details() FROM PUBLIC;

-- Existing jobs checked: no same-name job existed.
SELECT cron.schedule(
  'cron-job-run-details-retention-7d',
  '40 3 * * *',
  $cron$SELECT private.prune_cron_job_run_details();$cron$
);
