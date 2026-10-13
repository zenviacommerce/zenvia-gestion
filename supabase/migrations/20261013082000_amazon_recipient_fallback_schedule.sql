-- Only explicitly configured workspaces are called. Orders remain Amazon-owned.
select cron.schedule('amazon-recipient-fallback-refresh','*/5 * * * *',$job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/amazon-recipient-fallback',
    headers := jsonb_build_object('Content-Type','application/json','apikey',(select decrypted_secret from vault.decrypted_secrets where name='amazon_cron_secret_key')),
    body := jsonb_build_object('ownerId',configured.owner_id),
    timeout_milliseconds := 60000
  )
  from (select distinct owner_id from public.integration_accounts
    where provider='amazon' and enabled and status<>'disabled'
      and nullif(config->>'recipientSourceAccountId','') is not null) configured;
$job$)
where not exists(select 1 from cron.job where jobname='amazon-recipient-fallback-refresh');
