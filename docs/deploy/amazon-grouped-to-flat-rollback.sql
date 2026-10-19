-- PREPARED ONLY. Restore/stop grouped producers and pause worker scheduling first.
-- Execute as an authorized database administrator; leave the grouped-capable
-- worker and grouped PII controls installed until this transaction has committed.
-- No checkpoint/state/account updates. Original status=success means superseded,
-- never evidence that its source window was fetched successfully.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
-- Lock order follows worker acquisition. Prevent lease acquisition, claims,
-- producers, and maintenance writes racing the preconditions/conversion.
LOCK TABLE public.amazon_worker_leases IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.amazon_sync_jobs IN SHARE ROW EXCLUSIVE MODE;
DO $rollback$
DECLARE
 j public.amazon_sync_jobs%ROWTYPE;
 m text;
 k text;
 stamp timestamptz := clock_timestamp();
 converted integer := 0;
 replacements integer := 0;
BEGIN
 IF EXISTS(SELECT 1 FROM public.amazon_worker_leases WHERE expires_at>clock_timestamp()) THEN
  RAISE EXCEPTION 'Rollback blocked: active Amazon worker lease';
 END IF;
 IF EXISTS(SELECT 1 FROM public.amazon_sync_jobs WHERE status='running') THEN
  RAISE EXCEPTION 'Rollback blocked: running Amazon sync job';
 END IF;
 FOR j IN SELECT * FROM public.amazon_sync_jobs
  WHERE source='orders' AND scope_key='region:EU' AND marketplace_id IS NULL
   AND status IN ('queued','failed')
  ORDER BY owner_id,amazon_account_id,id
 LOOP
  IF j.window_from IS NULL OR j.window_to IS NULL OR j.window_from>=j.window_to
   OR j.payload->>'region' IS DISTINCT FROM 'EU'
   OR jsonb_typeof(j.payload->'marketplace_ids') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'Rollback blocked: invalid grouped job %',j.id;
  END IF;
  -- This recovery is deliberately pinned to the nine-market rollout. Fail closed
  -- for a changed scope rather than silently invent or omit marketplaces.
  IF jsonb_array_length(j.payload->'marketplace_ids')<>9 OR
   (SELECT count(DISTINCT v#>>'{}') FROM jsonb_array_elements(j.payload->'marketplace_ids') v)<>9 OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(j.payload->'marketplace_ids') v
    WHERE jsonb_typeof(v)<>'string' OR v#>>'{}' NOT IN
     ('A1RKKUPIHCS9HS','A13V1IB3VIYZZH','A1PA6795UKMFR9','APJ6JRA9NG5V4','A1805IZSGTT6HS','A2NODRKZP88ZB9','A1C3SOZRARQ6R3','AMEN7PMS3EDWL','A28R8C7NBKEWEA')) THEN
   RAISE EXCEPTION 'Rollback blocked: job % is not the expected nine-market scope',j.id;
  END IF;
  FOR m IN SELECT jsonb_array_elements_text(j.payload->'marketplace_ids') ORDER BY 1 LOOP
   k:='rollback-flat:orders:'||j.id::text||':'||m;
   INSERT INTO public.amazon_sync_jobs(owner_id,amazon_account_id,run_id,job_key,source,
    marketplace_id,scope_key,window_from,window_to,status,attempts,max_attempts,available_at,payload)
   VALUES(j.owner_id,j.amazon_account_id,j.run_id,k,'orders',m,m,j.window_from,j.window_to,
    'queued',0,5,stamp,jsonb_build_object('mode',CASE WHEN j.payload->>'mode' IN ('initial','hourly','manual','reconcile') THEN j.payload->>'mode' ELSE 'hourly' END))
   ON CONFLICT(owner_id,amazon_account_id,job_key) DO NOTHING;
   IF NOT EXISTS(SELECT 1 FROM public.amazon_sync_jobs r
    WHERE r.owner_id=j.owner_id AND r.amazon_account_id=j.amazon_account_id AND r.job_key=k
     AND r.source='orders' AND r.marketplace_id=m AND r.scope_key=m
     AND r.window_from=j.window_from AND r.window_to=j.window_to
     AND r.payload=jsonb_build_object('mode',CASE WHEN j.payload->>'mode' IN ('initial','hourly','manual','reconcile') THEN j.payload->>'mode' ELSE 'hourly' END)
     AND ((r.status='queued' AND r.attempts<r.max_attempts) OR r.status='success')) THEN
    RAISE EXCEPTION 'Rollback blocked: replacement validation failed for job %, market %',j.id,m;
   END IF;
   replacements:=replacements+1;
  END LOOP;
  -- All nine replacements exist and passed validation before superseding source.
  UPDATE public.amazon_sync_jobs SET status='success',locked_at=NULL,lease_holder_id=NULL,
   finished_at=stamp,last_error=NULL,updated_at=stamp,
   payload=payload||jsonb_build_object('superseded',true,'superseded_at',to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  WHERE id=j.id AND status IN ('queued','failed');
  converted:=converted+1;
 END LOOP;
 RAISE NOTICE 'Superseded % grouped jobs; verified % flat replacements; no checkpoints changed',converted,replacements;
END;
$rollback$;
-- Review this result before restoring the old worker/control function.
SELECT status,count(*) FROM public.amazon_sync_jobs
 WHERE source='orders' AND scope_key='region:EU' AND marketplace_id IS NULL
 GROUP BY status ORDER BY status;
COMMIT;
