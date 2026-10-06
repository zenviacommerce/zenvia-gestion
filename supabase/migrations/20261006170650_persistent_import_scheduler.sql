-- Durable periodic processing, independent from any browser or user JWT.
create extension if not exists pg_cron;
create extension if not exists pg_net;
create or replace function private.import_invoke_worker() returns bigint language plpgsql security definer set search_path='' as $$
declare project_url text;internal_key text;request_id bigint;
begin
 if not exists(select 1 from public.import_job_items where status in ('queued','ready') and available_at<=now() or status='running' and lease_until<now()) then return null;end if;
 select decrypted_secret into project_url from vault.decrypted_secrets where name='project_url' limit 1;
 select decrypted_secret into internal_key from vault.decrypted_secrets where name in ('import_cron_secret_key','amazon_cron_secret_key') order by case name when 'import_cron_secret_key' then 0 else 1 end limit 1;
 if coalesce(project_url,'')='' or coalesce(internal_key,'')='' then raise exception 'Configura project_url e import_cron_secret_key en Vault para ejecutar importaciones sin navegador';end if;
 select net.http_post(url:=rtrim(project_url,'/')||'/functions/v1/import-worker',headers:=jsonb_build_object('Content-Type','application/json','apikey',internal_key,'x-import-worker-secret',internal_key),body:='{}'::jsonb,timeout_milliseconds:=120000) into request_id;
 return request_id;
end $$;
revoke all on function private.import_invoke_worker() from public,anon,authenticated;
do $$ declare job record;begin for job in select jobid from cron.job where jobname='import-worker' loop perform cron.unschedule(job.jobid);end loop;end $$;
select cron.schedule('import-worker','* * * * *',$cron$select private.import_invoke_worker();$cron$);
