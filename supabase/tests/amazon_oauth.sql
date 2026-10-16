-- This is an ACL/preflight gate, not a substitute for real Vault concurrency tests.
\set ON_ERROR_STOP on
\ir amazon_credential_snapshot.sql
begin;
do $$ declare f record; begin
 for f in select oid,proname,prosecdef from pg_proc where pronamespace='public'::regnamespace and proname like 'integration_amazon_%' loop
 if f.prosecdef or has_function_privilege('anon',f.oid,'execute') or has_function_privilege('authenticated',f.oid,'execute') then raise exception 'Unsafe Amazon RPC ACL: %',f.proname; end if;
 end loop;
 if has_table_privilege('anon','public.amazon_oauth_attempts','select') or has_table_privilege('authenticated','public.amazon_oauth_attempts','select') then raise exception 'Attempt table exposed'; end if;
 if exists(select 1 from pg_class where oid in ('public.amazon_oauth_attempts'::regclass,'public.amazon_seller_owners'::regclass) and not relrowsecurity) then raise exception 'RLS required'; end if;
end $$;
rollback;
