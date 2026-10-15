
CREATE OR REPLACE FUNCTION private.amazon_worker_maintenance()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_exhausted integer:=0; v_recovered integer:=0; v_superseded integer:=0;
BEGIN
 IF NOT pg_catalog.pg_try_advisory_xact_lock(891746203) THEN RETURN jsonb_build_object('skipped','already_running'); END IF;
 WITH changed AS (
 UPDATE public.amazon_sync_jobs j
 SET status='failed',finished_at=clock_timestamp(),updated_at=clock_timestamp(),locked_at=NULL,
 last_error=concat_ws(' · ',nullif(j.last_error,''),'Recovery: queued job exhausted max_attempts')
 WHERE j.status='queued' AND j.attempts>=j.max_attempts RETURNING 1
 ) SELECT count(*) INTO v_exhausted FROM changed;
 IF NOT EXISTS (SELECT 1 FROM public.amazon_worker_leases WHERE expires_at>clock_timestamp()) THEN
  WITH changed AS (
   UPDATE public.amazon_sync_jobs j
   SET status=CASE WHEN j.attempts>=j.max_attempts THEN 'failed' ELSE 'queued' END,
   available_at=clock_timestamp(),locked_at=NULL,lease_holder_id=NULL,
   finished_at=CASE WHEN j.attempts>=j.max_attempts THEN clock_timestamp() ELSE NULL END,
   duration_ms=CASE WHEN j.started_at IS NOT NULL THEN greatest(0,(extract(epoch from clock_timestamp()-j.started_at)*1000)::bigint) ELSE j.duration_ms END,
   updated_at=clock_timestamp(),
   last_error=concat_ws(' · ',nullif(j.last_error,''),'Recovery: running job older than 15 minutes with no live worker lease')
   WHERE j.status='running' AND coalesce(j.started_at,j.locked_at)<clock_timestamp()-interval '15 minutes'
   RETURNING 1
  ) SELECT count(*) INTO v_recovered FROM changed;
 END IF;
 WITH changed AS (
 UPDATE public.amazon_sync_jobs stale
 SET status='success',rows_processed=0,finished_at=now(),updated_at=now(),
 payload=coalesce(stale.payload,'{}'::jsonb)||jsonb_build_object('superseded',true,'superseded_at',now())
 WHERE stale.status='queued'
 AND coalesce(stale.payload->>'mode','') IN ('hourly','manual')
 AND EXISTS (
 SELECT 1 FROM public.amazon_sync_jobs newer
 WHERE newer.owner_id=stale.owner_id AND newer.amazon_account_id=stale.amazon_account_id
 AND newer.source=stale.source
 AND coalesce(newer.scope_key,newer.marketplace_id,'global')=coalesce(stale.scope_key,stale.marketplace_id,'global')
 AND coalesce(newer.payload->>'mode','') IN ('hourly','manual')
 AND newer.created_at>stale.created_at AND newer.status IN ('queued','running','success')
 ) RETURNING 1
 ) SELECT count(*) INTO v_superseded FROM changed;
 RETURN jsonb_build_object('exhausted',v_exhausted,'recovered',v_recovered,'superseded',v_superseded);
END $$;
ALTER FUNCTION private.amazon_worker_maintenance() SET statement_timeout='20s';
ALTER FUNCTION private.amazon_worker_maintenance() SET lock_timeout='500ms';
REVOKE ALL ON FUNCTION private.amazon_worker_maintenance() FROM PUBLIC, anon, authenticated;
