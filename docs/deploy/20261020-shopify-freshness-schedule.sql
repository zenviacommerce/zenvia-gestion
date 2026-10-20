-- Run only after schema + all three backend functions are verified. No secrets returned.
-- Old job is preserved intact and merely paused, for exact rollback.
begin;
select cron.alter_job(job_id := jobid, active := false) from cron.job where jobname='shopify-analytics-sync';
select cron.schedule('shopify-order-freshness','* * * * *',$job$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='project_url')||'/functions/v1/shopify-order-events',
  headers:=jsonb_build_object('Content-Type','application/json','apikey',(select decrypted_secret from vault.decrypted_secrets where name='amazon_cron_secret_key')),
  body:=jsonb_build_object('action','tick','integrationAccountId',a.id),
  timeout_milliseconds:=300000)
 from public.integration_accounts a join public.workspaces w on w.id=a.owner_id
 where a.provider='shopify' and a.enabled and a.status='connected' and a.credential_source<>'derived'
 and a.config->>'syncOrders' is distinct from 'false' and w.status in ('active','trialing');
$job$);
commit;
