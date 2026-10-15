-- Phase 1 v2 rollback. FIRST deploy worker v33 from supabase/rollback/20261015_phase1_worker_index.ts and matching shared source.
-- Wait for lease to expire or be released, and for running jobs to finish.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.amazon_worker_leases WHERE expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Live worker lease: abort rollback'; END IF;
 IF EXISTS(SELECT 1 FROM public.amazon_sync_jobs WHERE status='running') THEN RAISE EXCEPTION 'Running Amazon jobs: abort rollback'; END IF;
END $$;
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='amazon-worker-maintenance';
DROP FUNCTION IF EXISTS public.amazon_phase1_timeout_probe_v2();
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
CREATE OR REPLACE FUNCTION private.amazon_claim_sync_jobs(limit_count integer DEFAULT 3)
RETURNS SETOF public.amazon_sync_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
begin
  if limit_count < 1 or limit_count > 20 then
    raise exception 'Invalid job claim size';
  end if;
  update public.amazon_sync_jobs stale
  set status = 'failed', locked_at = null, finished_at = now(), updated_at = now(),
      last_error = coalesce(stale.last_error,'') || case when coalesce(stale.last_error,'')='' then '' else ' · ' end || 'Recovered stale worker lock after retry exhaustion'
  where stale.status = 'running' and stale.locked_at < now() - interval '15 minutes' and stale.attempts >= stale.max_attempts;
  update public.amazon_sync_jobs stale
  set status = 'queued', locked_at = null, available_at = now(), finished_at = null, updated_at = now(),
      last_error = coalesce(stale.last_error,'') || case when coalesce(stale.last_error,'')='' then '' else ' · ' end || 'Recovered stale worker lock'
  where stale.status = 'running' and stale.locked_at < now() - interval '15 minutes' and stale.attempts < stale.max_attempts;
  update public.amazon_sync_jobs stale
  set status = 'success', rows_processed = 0, finished_at = now(), updated_at = now(),
      payload = coalesce(stale.payload,'{}'::jsonb) || jsonb_build_object('superseded',true,'superseded_at',now())
  where stale.status = 'queued'
    and coalesce(stale.payload->>'mode','') in ('hourly','manual')
    and exists (
      select 1 from public.amazon_sync_jobs newer
      where newer.owner_id = stale.owner_id
        and newer.amazon_account_id = stale.amazon_account_id
        and newer.source = stale.source
        and coalesce(newer.scope_key,newer.marketplace_id,'global') = coalesce(stale.scope_key,stale.marketplace_id,'global')
        and coalesce(newer.payload->>'mode','') in ('hourly','manual')
        and newer.created_at > stale.created_at
        and newer.status in ('queued','running','success')
    );
  if exists (
    select 1 from public.amazon_sync_jobs active
    where active.status = 'running' and active.locked_at >= now() - interval '15 minutes'
  ) then return; end if;
  return query
  with candidates as (
    select j.id from public.amazon_sync_jobs j
    where j.status = 'queued' and j.available_at <= now() and j.attempts < j.max_attempts
    order by
      case when coalesce(j.payload->>'mode','') in ('hourly','manual') then 0 else 1 end,
      case when coalesce(j.payload->>'mode','') in ('hourly','manual') then j.created_at end desc nulls last,
      case j.source when 'orders' then 0 when 'finances' then 1 when 'inventory' then 2 else 9 end,
      j.available_at,j.created_at
    for update skip locked limit limit_count
  )
  update public.amazon_sync_jobs j
  set status='running',attempts=j.attempts+1,locked_at=now(),updated_at=now()
  from candidates c where j.id=c.id returning j.*;
end;
$function$;

CREATE OR REPLACE FUNCTION public.amazon_claim_sync_jobs(limit_count integer DEFAULT 3)
RETURNS SETOF public.amazon_sync_jobs
LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $function$
  select * from private.amazon_claim_sync_jobs(limit_count);
$function$;

-- Restore cron worker to */5 with SELECT cron.alter_job(8,schedule:='*/5 * * * *'); if changed.
