
CREATE OR REPLACE FUNCTION private.amazon_claim_sync_jobs(limit_count integer DEFAULT 3)
RETURNS SETOF public.amazon_sync_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RAISE NOTICE 'Legacy claim disabled: worker lease required';
 RETURN;
END $$;
CREATE OR REPLACE FUNCTION public.amazon_claim_sync_jobs(limit_count integer DEFAULT 3)
RETURNS SETOF public.amazon_sync_jobs LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT * FROM private.amazon_claim_sync_jobs(limit_count);
$$;
ALTER FUNCTION public.amazon_claim_sync_jobs(integer) SET statement_timeout='3s';
ALTER FUNCTION private.amazon_claim_sync_jobs(integer) SET statement_timeout='3s';
ALTER FUNCTION public.amazon_claim_sync_jobs(integer) SET lock_timeout='500ms';
ALTER FUNCTION private.amazon_claim_sync_jobs(integer) SET lock_timeout='500ms';
SELECT cron.schedule('amazon-worker-maintenance','12,27,42,57 * * * *',$cron$SELECT private.amazon_worker_maintenance();$cron$);
