-- Orders only: finance/inventory keep their existing schedules and preferences.
select cron.schedule(
  'amazon-orders-five-minutes',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/amazon-sync-orchestrator',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey',(select decrypted_secret from vault.decrypted_secrets where name = 'amazon_cron_secret_key')
    ),
    body := '{"mode":"hourly","ordersOnly":true}'::jsonb
  );
  $cron$
);

do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='fulfillment_orders') then
    alter publication supabase_realtime add table public.fulfillment_orders;
  end if;
end;
$$;
