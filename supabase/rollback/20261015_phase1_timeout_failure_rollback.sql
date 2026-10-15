-- Phase 1 rollback applied in production on 2026-10-15 after statement_timeout verification failed.
-- Precondition: no running Amazon jobs and no live worker lease.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.amazon_worker_leases WHERE expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Live worker lease'; END IF;
 IF EXISTS(SELECT 1 FROM public.amazon_sync_jobs WHERE status='running') THEN RAISE EXCEPTION 'Running jobs'; END IF;
END $$;
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='amazon-worker-maintenance';
DROP FUNCTION IF EXISTS private.amazon_phase1_timeout_probe();
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
-- Restore original Edge Function from:
-- supabase/rollback/20261015_phase1_worker_index.ts
-- supabase/rollback/20261015_phase1_amazon_sync_shared.ts
-- Keep existing one-argument public/private claim functions and cron worker */5.
