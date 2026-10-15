DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.amazon_worker_leases WHERE expires_at>clock_timestamp()) THEN
  RAISE EXCEPTION 'Rollback blocked: live worker lease';
 END IF;
 IF EXISTS(SELECT 1 FROM public.amazon_sync_jobs WHERE status='running') THEN
  RAISE EXCEPTION 'Rollback blocked: running jobs';
 END IF;
END $$;
DROP FUNCTION IF EXISTS public.amazon_claim_sync_jobs(integer,uuid);
DROP FUNCTION IF EXISTS private.amazon_claim_sync_jobs(integer,uuid);
DROP FUNCTION IF EXISTS public.amazon_worker_acquire_lease(uuid);
DROP FUNCTION IF EXISTS public.amazon_worker_renew_lease(uuid);
DROP FUNCTION IF EXISTS public.amazon_worker_release_lease(uuid);
DROP FUNCTION IF EXISTS private.amazon_worker_maintenance();
ALTER TABLE public.amazon_sync_jobs DROP COLUMN IF EXISTS lease_holder_id;
ALTER TABLE public.amazon_sync_jobs DROP COLUMN IF EXISTS started_at;
ALTER TABLE public.amazon_sync_jobs DROP COLUMN IF EXISTS duration_ms;
DROP TABLE IF EXISTS public.amazon_worker_leases;