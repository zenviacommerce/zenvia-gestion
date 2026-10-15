
CREATE OR REPLACE FUNCTION private.amazon_worker_maintenance()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='20s' SET lock_timeout='500ms' AS $$
DECLARE v_failed int:=0;v_running_failed int:=0;v_requeued int:=0;v_superseded int:=0;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.amazon_worker_leases WHERE lease_key='amazon-sync-worker' AND expires_at>clock_timestamp()) THEN
  WITH exhausted AS (
   UPDATE public.amazon_sync_jobs j SET status='failed',finished_at=clock_timestamp(),locked_at=NULL,lease_holder_id=NULL,updated_at=clock_timestamp(),
   last_error=concat_ws(' · ',nullif(j.last_error,''),'Recovery: queued job exhausted max_attempts')
   WHERE j.status='queued' AND j.attempts>=j.max_attempts RETURNING 1
  ) SELECT count(*) INTO v_failed FROM exhausted;
  WITH exhausted_running AS (
   UPDATE public.amazon_sync_jobs j SET status='failed',finished_at=clock_timestamp(),locked_at=NULL,lease_holder_id=NULL,updated_at=clock_timestamp(),
   duration_ms=CASE WHEN j.started_at IS NOT NULL THEN greatest(0,(extract(epoch FROM(clock_timestamp()-j.started_at))*1000)::bigint) ELSE j.duration_ms END,
   last_error=concat_ws(' · ',nullif(j.last_error,''),'Recovery: running >15min, no live worker lease, attempts exhausted')
   WHERE j.status='running' AND j.locked_at<clock_timestamp()-interval '15 minutes' AND j.attempts>=j.max_attempts RETURNING 1
  ) SELECT count(*) INTO v_running_failed FROM exhausted_running;
  WITH recoverable AS (
   UPDATE public.amazon_sync_jobs j SET status='queued',locked_at=NULL,lease_holder_id=NULL,available_at=clock_timestamp(),finished_at=NULL,updated_at=clock_timestamp(),
   last_error=concat_ws(' · ',nullif(j.last_error,''),'Recovery: running >15min, no live worker lease')
   WHERE j.status='running' AND j.locked_at<clock_timestamp()-interval '15 minutes' AND j.attempts<j.max_attempts RETURNING 1
  ) SELECT count(*) INTO v_requeued FROM recoverable;
 END IF;
 WITH candidates AS (
   SELECT stale.id FROM public.amazon_sync_jobs stale
   WHERE stale.status='queued'
    AND coalesce(stale.payload->>'mode','') IN('hourly','manual')
    AND EXISTS (
     SELECT 1 FROM public.amazon_sync_jobs newer
     WHERE newer.owner_id=stale.owner_id AND newer.amazon_account_id=stale.amazon_account_id
      AND newer.source=stale.source
      AND coalesce(newer.scope_key,newer.marketplace_id,'global')=coalesce(stale.scope_key,stale.marketplace_id,'global')
      AND coalesce(newer.payload->>'mode','') IN('hourly','manual')
      AND newer.created_at>stale.created_at AND newer.status IN('queued','running','success')
    )
   ORDER BY stale.created_at LIMIT 500 FOR UPDATE SKIP LOCKED
 ), compacted AS (
  UPDATE public.amazon_sync_jobs stale
  SET status='success',rows_processed=0,finished_at=clock_timestamp(),updated_at=clock_timestamp(),
  payload=coalesce(stale.payload,'{}'::jsonb)||jsonb_build_object('superseded',true,'superseded_at',clock_timestamp())
  FROM candidates c WHERE stale.id=c.id RETURNING 1
 ) SELECT count(*) INTO v_superseded FROM compacted;
 RETURN jsonb_build_object('failed_queued',v_failed,'failed_running',v_running_failed,'requeued_running',v_requeued,'superseded',v_superseded);
END $$;
REVOKE ALL ON FUNCTION private.amazon_worker_maintenance() FROM PUBLIC;
SELECT cron.schedule('amazon-worker-maintenance','1-59/10 * * * *','SELECT private.amazon_worker_maintenance();');
