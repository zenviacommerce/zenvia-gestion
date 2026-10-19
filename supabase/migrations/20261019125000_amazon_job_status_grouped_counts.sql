-- One grouped count query replaces four concurrent PostgREST exact-count requests.
-- Existing index amazon_sync_jobs_owner_account_status_idx(owner_id, amazon_account_id, status)
-- supports this grouping. No redundant index needed.
CREATE OR REPLACE FUNCTION public.amazon_sync_job_status_counts(
 p_owner_id uuid,p_account_id uuid
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $counts$
 SELECT jsonb_build_object(
  'queued',count(*) FILTER(WHERE status='queued'),
  'running',count(*) FILTER(WHERE status='running'),
  'success',count(*) FILTER(WHERE status='success'),
  'failed',count(*) FILTER(WHERE status='failed')
 ) FROM public.amazon_sync_jobs
 WHERE owner_id=p_owner_id AND amazon_account_id=p_account_id
$counts$;
REVOKE ALL ON FUNCTION public.amazon_sync_job_status_counts(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.amazon_sync_job_status_counts(uuid,uuid) TO service_role;
