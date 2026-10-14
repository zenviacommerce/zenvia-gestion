-- Read-only financial snapshots refresh without calling operational shipping sync.
select cron.schedule('shopify-analytics-sync','*/30 * * * *',$cron$
 select net.http_post(
   url:=(select decrypted_secret from vault.decrypted_secrets where name='project_url')||'/functions/v1/shopify-analytics-sync',
   headers:=jsonb_build_object('Content-Type','application/json','apikey',(select decrypted_secret from vault.decrypted_secrets where name='amazon_cron_secret_key')),
   body:=jsonb_build_object('ownerId',a.owner_id,'integrationAccountId',a.id),timeout_milliseconds:=120000)
 from public.integration_accounts a join public.workspaces w on w.id=a.owner_id
 where a.provider='shopify' and a.enabled and a.status='connected' and a.credential_source<>'derived' and w.status in ('active','trialing');
$cron$);
