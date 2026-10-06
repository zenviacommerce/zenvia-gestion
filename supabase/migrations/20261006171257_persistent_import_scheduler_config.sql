-- Backend-only bootstrap. Credentials come exclusively from Edge runtime secrets.
create or replace function public.import_configure_worker(p_url text,p_key text) returns void language plpgsql security definer set search_path='' as $$
declare existing uuid;stored text;
begin
 if p_url!~'^https://[a-z0-9]+[.]supabase[.]co/?$' or length(coalesce(p_key,''))<30 then raise exception 'Configuración interna no válida';end if;
 select id,decrypted_secret into existing,stored from vault.decrypted_secrets where name='project_url' limit 1;
 if existing is null then perform vault.create_secret(rtrim(p_url,'/'),'project_url','Supabase project URL for internal workers');
 elsif rtrim(stored,'/')<>rtrim(p_url,'/') then raise exception 'La URL del scheduler pertenece a otro proyecto';end if;
 select id,decrypted_secret into existing,stored from vault.decrypted_secrets where name='import_cron_secret_key' limit 1;
 if existing is null then perform vault.create_secret(p_key,'import_cron_secret_key','Internal import worker credential');
 elsif stored is distinct from p_key then perform vault.update_secret(existing,p_key,'import_cron_secret_key','Internal import worker credential');end if;
end $$;
revoke all on function public.import_configure_worker(text,text) from public,anon,authenticated;
grant execute on function public.import_configure_worker(text,text) to service_role;
