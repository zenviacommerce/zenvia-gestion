
ALTER TABLE public.amazon_sync_jobs ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE public.amazon_sync_jobs ADD COLUMN IF NOT EXISTS duration_ms bigint;
ALTER TABLE public.amazon_sync_jobs ADD COLUMN IF NOT EXISTS lease_holder_id uuid;
CREATE TABLE IF NOT EXISTS public.amazon_worker_leases (
  lease_key text PRIMARY KEY CHECK(lease_key='amazon-sync-worker'),
  holder_id uuid NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON public.amazon_worker_leases FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.amazon_worker_leases TO service_role;
CREATE OR REPLACE FUNCTION public.amazon_worker_acquire_lease(p_holder_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_ok boolean;
BEGIN
 IF p_holder_id IS NULL THEN RAISE EXCEPTION 'holder required'; END IF;
 INSERT INTO public.amazon_worker_leases AS l(lease_key,holder_id,acquired_at,heartbeat_at,expires_at)
 VALUES ('amazon-sync-worker',p_holder_id,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '480 seconds')
 ON CONFLICT (lease_key) DO UPDATE
 SET holder_id=excluded.holder_id,acquired_at=excluded.acquired_at,heartbeat_at=excluded.heartbeat_at,expires_at=excluded.expires_at
 WHERE l.expires_at<=clock_timestamp()
 RETURNING true INTO v_ok;
 RETURN coalesce(v_ok,false);
END $$;
CREATE OR REPLACE FUNCTION public.amazon_worker_renew_lease(p_holder_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_ok boolean;
BEGIN
 UPDATE public.amazon_worker_leases SET heartbeat_at=clock_timestamp(),expires_at=clock_timestamp()+interval '480 seconds'
 WHERE lease_key='amazon-sync-worker' AND holder_id=p_holder_id AND expires_at>clock_timestamp()
 RETURNING true INTO v_ok;
 RETURN coalesce(v_ok,false);
END $$;
CREATE OR REPLACE FUNCTION public.amazon_worker_release_lease(p_holder_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_ok boolean;
BEGIN
 DELETE FROM public.amazon_worker_leases WHERE lease_key='amazon-sync-worker' AND holder_id=p_holder_id RETURNING true INTO v_ok;
 RETURN coalesce(v_ok,false);
END $$;
CREATE OR REPLACE FUNCTION private.amazon_claim_sync_jobs(limit_count integer,p_holder_id uuid)
RETURNS SETOF public.amazon_sync_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF limit_count<1 OR limit_count>20 OR p_holder_id IS NULL THEN RAISE EXCEPTION 'Invalid claim arguments'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.amazon_worker_leases WHERE lease_key='amazon-sync-worker' AND holder_id=p_holder_id AND expires_at>clock_timestamp()) THEN
  RAISE EXCEPTION 'Worker lease missing or expired' USING ERRCODE='55000';
 END IF;
 RETURN QUERY
 WITH candidates AS (
 SELECT j.id FROM public.amazon_sync_jobs j
 WHERE j.status='queued' AND j.available_at<=now() AND j.attempts<j.max_attempts
 ORDER BY
  CASE WHEN coalesce(j.payload->>'mode','') IN ('hourly','manual') THEN 0 ELSE 1 END,
  CASE WHEN coalesce(j.payload->>'mode','') IN ('hourly','manual') THEN j.created_at END DESC NULLS LAST,
  CASE j.source WHEN 'orders' THEN 0 WHEN 'finances' THEN 1 WHEN 'inventory' THEN 2 ELSE 9 END,
  j.available_at,j.created_at
 FOR UPDATE SKIP LOCKED LIMIT limit_count
 )
 UPDATE public.amazon_sync_jobs j SET status='running',attempts=j.attempts+1,locked_at=clock_timestamp(),
 started_at=clock_timestamp(),duration_ms=NULL,lease_holder_id=p_holder_id,updated_at=clock_timestamp()
 FROM candidates c WHERE j.id=c.id RETURNING j.*;
END $$;
CREATE OR REPLACE FUNCTION public.amazon_claim_sync_jobs(limit_count integer,p_holder_id uuid)
RETURNS SETOF public.amazon_sync_jobs LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT * FROM private.amazon_claim_sync_jobs(limit_count,p_holder_id);
$$;
ALTER FUNCTION public.amazon_claim_sync_jobs(integer,uuid) SET statement_timeout='3s';
ALTER FUNCTION private.amazon_claim_sync_jobs(integer,uuid) SET statement_timeout='3s';
ALTER FUNCTION public.amazon_claim_sync_jobs(integer,uuid) SET lock_timeout='500ms';
ALTER FUNCTION private.amazon_claim_sync_jobs(integer,uuid) SET lock_timeout='500ms';
REVOKE ALL ON FUNCTION public.amazon_claim_sync_jobs(integer,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.amazon_claim_sync_jobs(integer,uuid) TO service_role;
REVOKE ALL ON FUNCTION private.amazon_claim_sync_jobs(integer,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.amazon_worker_acquire_lease(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.amazon_worker_renew_lease(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.amazon_worker_release_lease(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.amazon_worker_acquire_lease(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.amazon_worker_renew_lease(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.amazon_worker_release_lease(uuid) TO service_role;
