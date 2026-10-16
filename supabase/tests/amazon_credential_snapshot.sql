-- Run only against a disposable local PostgreSQL 17 with migrations applied.
\set ON_ERROR_STOP on
begin;
do $$ begin
 if current_setting('server_version_num')::integer not between 170000 and 179999 then raise exception 'PostgreSQL 17 required'; end if;
 if inet_server_addr() is not null and inet_server_addr()::text not in ('127.0.0.1','::1') then raise exception 'Loopback database required'; end if;
 if has_function_privilege('anon','public.integration_amazon_credential_snapshot(uuid,uuid,uuid)','execute') or has_function_privilege('authenticated','public.integration_amazon_credential_snapshot(uuid,uuid,uuid)','execute') then raise exception 'Frontend snapshot privilege'; end if;
 if exists(select 1 from public.integration_accounts where provider='amazon' and sp_api_app_key not in ('private_v1','public_v1')) then raise exception 'Invalid app identity'; end if;
 if exists(select 1 from pg_proc where oid='public.integration_amazon_credential_snapshot(uuid,uuid,uuid)'::regprocedure and prosecdef) then raise exception 'Invoker required'; end if;
end $$;
rollback;
