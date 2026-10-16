-- Disposable local Supabase PostgreSQL 17 only. Real Auth/session lifecycle
-- fixtures belong to the MFA integration suite; this checks installed contracts.
\set ON_ERROR_STOP on
\ir amazon_oauth.sql
begin;
do $$ declare before_count bigint; after_count bigint; denied boolean:=false; begin
 if not has_table_privilege('service_role','public.app_users','SELECT') or not has_table_privilege('service_role','public.app_users','UPDATE') or not has_table_privilege('service_role','public.workspaces','SELECT') or not has_table_privilege('service_role','public.workspaces','UPDATE') then raise exception 'Service role authorization row-lock privileges missing'; end if;
 if not public.integration_amazon_oauth_hooks_ready() then raise exception 'MFA OAuth hooks not installed'; end if;
 if pg_catalog.to_regprocedure('public.integration_amazon_oauth_reserve(uuid,uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,jsonb)') is not null then raise exception 'Unbound OAuth reserve overload remains'; end if;
 if has_function_privilege('authenticated','public.integration_amazon_oauth_assert_actor(uuid,uuid,uuid,numeric,uuid)','execute') then raise exception 'Actor assertion exposed'; end if;
 select count(*) into before_count from vault.secrets;
 begin perform public.integration_amazon_oauth_assert_actor(null,null,null,null,null);
 exception when others then denied:=true; end;
 if not denied then raise exception 'Absent actor proof was accepted'; end if;
 select count(*) into after_count from vault.secrets;
 if before_count<>after_count then raise exception 'Denied actor changed Vault'; end if;
end $$;
rollback;
