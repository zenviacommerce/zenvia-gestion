-- No request is issued while shadow capture is disabled.
create function private.platform_shadow_source_wake() returns bigint language plpgsql security definer set search_path='' as $$
declare cfg private.platform_shadow_source_config;token text;request_id bigint;
begin
 select * into cfg from private.platform_shadow_source_config;if not cfg.enabled then return null;end if;
 select decrypted_secret into token from vault.decrypted_secrets where name=cfg.worker_secret_name;
 if token is null then raise exception 'SHADOW_WORKER_SECRET_MISSING';end if;
 select net.http_post(url=>'https://'||cfg.source_project_ref||'.supabase.co/functions/v1/platform-shadow-source',headers=>jsonb_build_object('Content-Type','application/json','x-shadow-worker',token),body=>'{}'::jsonb,timeout_milliseconds=>45000) into request_id;
 return request_id;
end;$$;
revoke all on function private.platform_shadow_source_wake() from public,anon,authenticated,service_role;
select cron.schedule('platform-shadow-source','* * * * *','select private.platform_shadow_source_wake()');
