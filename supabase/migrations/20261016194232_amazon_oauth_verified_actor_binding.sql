-- Hold authorization rows until the surrounding writer/claim transaction ends.
create or replace function public.integration_amazon_assert_context(p_user uuid,p_workspace uuid,p_owner uuid) returns void
language plpgsql security invoker set search_path='' as $$ begin
 perform 1 from public.app_users u
 join public.workspaces w on w.id=u.workspace_id
 join public.workspaces o on o.id=u.data_owner_id
 where u.user_id=p_user and u.active and u.role='admin'
 and u.workspace_id=p_workspace and u.data_owner_id=p_owner
 and w.status in ('active','trialing') and o.status in ('active','trialing')
 for share of u,w,o;
 if not found then raise exception 'Amazon authorization denied'; end if;
end $$;
-- Existing attempts have no human-session proof and can never become eligible.
alter table public.amazon_oauth_attempts add column actor_session_id uuid,add column actor_factor_id uuid,add column mfa_verified_at numeric;
update public.amazon_oauth_attempts set status='failed',reason_code='configuration_unavailable' where status in ('pending','exchanging');
create function public.integration_amazon_oauth_hooks_ready() returns boolean
language sql stable security invoker set search_path='' as $$
 select pg_catalog.to_regprocedure('public.security_mfa_oauth_actor_assert(uuid,uuid,uuid,numeric,uuid)') is not null
 and pg_catalog.to_regprocedure('public.security_mfa_oauth_start_context()') is not null
$$;
create function public.integration_amazon_oauth_assert_actor(p_user uuid,p_session uuid,p_factor uuid,p_verified numeric,p_owner uuid) returns void
language plpgsql security invoker set search_path='' as $$ begin
 if p_user is null or p_session is null or p_factor is null or p_verified is null or p_owner is null or not public.integration_amazon_oauth_hooks_ready() then raise exception 'Amazon MFA authorization denied'; end if;
 perform public.security_mfa_oauth_actor_assert(p_user,p_session,p_factor,p_verified,p_owner);
end $$;
-- Remove the old overload: there is no path to reserve without human-JWT proof.
drop function public.integration_amazon_oauth_reserve(uuid,uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,jsonb);
create function public.integration_amazon_oauth_reserve(p_user_id uuid,p_workspace_id uuid,p_owner_id uuid,p_target_integration_id uuid,p_expected_seller_id text,p_nonce_hash text,p_ticket_hash text,p_expires_at timestamptz,p_ticket_expires_at timestamptz,p_actor_session_id uuid,p_actor_factor_id uuid,p_mfa_verified_at numeric,p_continuation jsonb default null) returns uuid
language plpgsql security invoker set search_path='' as $$ declare i public.integration_accounts; result uuid; begin
 perform public.integration_amazon_oauth_assert_actor(p_user_id,p_actor_session_id,p_actor_factor_id,p_mfa_verified_at,p_owner_id);
 perform public.integration_amazon_assert_context(p_user_id,p_workspace_id,p_owner_id);
 if p_target_integration_id is null and p_expected_seller_id is not null then
 select r.integration_account_id into p_target_integration_id from public.amazon_seller_owners r where r.seller_id=p_expected_seller_id and r.workspace_id=p_workspace_id and r.owner_id=p_owner_id;
 end if;
 perform public.integration_amazon_quota(p_workspace_id,p_owner_id,p_target_integration_id);
 if p_target_integration_id is not null then
 select * into i from public.integration_accounts where id=p_target_integration_id and owner_id=p_owner_id and provider='amazon';
 if not found or (p_expected_seller_id is not null and p_expected_seller_id<>i.external_account_id) then raise exception 'Amazon authorization denied'; end if;
 end if;
 insert into public.amazon_oauth_attempts(user_id,workspace_id,owner_id,target_integration_id,expected_seller_id,expected_version,nonce_hash,ticket_hash,expires_at,ticket_expires_at,continuation,actor_session_id,actor_factor_id,mfa_verified_at)
 values(p_user_id,p_workspace_id,p_owner_id,p_target_integration_id,coalesce(i.external_account_id,p_expected_seller_id),i.amazon_credential_version,p_nonce_hash,p_ticket_hash,p_expires_at,p_ticket_expires_at,p_continuation,p_actor_session_id,p_actor_factor_id,p_mfa_verified_at) returning id into result; return result;
end $$;
create or replace function public.integration_amazon_oauth_claim(p_nonce_hash text,p_browser_hash text,p_seller_id text) returns jsonb
language plpgsql security invoker set search_path='' as $$ declare a public.amazon_oauth_attempts; begin
 select * into a from public.amazon_oauth_attempts where nonce_hash=p_nonce_hash;
 if not found then raise exception 'Amazon attempt unavailable'; end if;
 perform public.integration_amazon_quota(a.workspace_id,a.owner_id,a.target_integration_id,a.id);
 select * into a from public.amazon_oauth_attempts where id=a.id for update;
 if a.status<>'pending' or a.expires_at<=now() or a.ticket_consumed_at is null or a.browser_hash is distinct from p_browser_hash or p_browser_hash is null or p_seller_id is null or p_seller_id !~ '^[A-Z0-9]{1,64}$' or (a.expected_seller_id is not null and a.expected_seller_id<>p_seller_id) then raise exception 'Amazon attempt unavailable'; end if;
 perform public.integration_amazon_oauth_assert_actor(a.user_id,a.actor_session_id,a.actor_factor_id,a.mfa_verified_at,a.owner_id);
 perform public.integration_amazon_assert_context(a.user_id,a.workspace_id,a.owner_id);
 if a.target_integration_id is null and exists(select 1 from public.amazon_seller_owners r where r.seller_id=p_seller_id) then raise exception 'Amazon authorization changed'; end if;
 if a.target_integration_id is not null and not exists(select 1 from public.integration_accounts i where i.id=a.target_integration_id and i.owner_id=a.owner_id and i.external_account_id=p_seller_id and i.amazon_credential_version=a.expected_version) then raise exception 'Amazon authorization denied'; end if;
 update public.amazon_oauth_attempts set status='exchanging',expected_seller_id=p_seller_id where id=a.id;
 return pg_catalog.jsonb_build_object('attempt_id',a.id,'user_id',a.user_id,'workspace_id',a.workspace_id,'owner_id',a.owner_id,'integration_account_id',a.target_integration_id,'app_key',a.app_key,'expected_version',a.expected_version);
end $$;
create or replace function public.integration_amazon_oauth_commit(p_attempt_id uuid,p_seller_id text,p_refresh_token text)
returns table(integration_account_id uuid,amazon_account_id uuid,amazon_credential_version bigint)
language plpgsql security invoker set search_path='' as $$ declare a public.amazon_oauth_attempts; begin
 select * into a from public.amazon_oauth_attempts where id=p_attempt_id;
 if not found then raise exception 'Amazon attempt unavailable'; end if;
 perform public.integration_amazon_quota(a.workspace_id,a.owner_id,a.target_integration_id,a.id);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('amazon-seller:'||p_seller_id,0));
 select * into a from public.amazon_oauth_attempts where id=p_attempt_id for update;
 if a.status<>'exchanging' or a.expires_at<=now() or a.expected_seller_id is distinct from p_seller_id then raise exception 'Amazon attempt unavailable'; end if;
 perform public.integration_amazon_oauth_assert_actor(a.user_id,a.actor_session_id,a.actor_factor_id,a.mfa_verified_at,a.owner_id);
 return query select * from public.integration_amazon_write(a.user_id,a.workspace_id,a.owner_id,a.target_integration_id,p_seller_id,p_refresh_token,'Amazon Europe','{}',a.expected_version,'public_v1',a.id);
 update public.amazon_oauth_attempts set status='complete' where id=a.id;
end $$;
create function public.integration_amazon_oauth_actor_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$ begin
 if row(new.user_id,new.workspace_id,new.owner_id,new.actor_session_id,new.actor_factor_id,new.mfa_verified_at)
 is distinct from row(old.user_id,old.workspace_id,old.owner_id,old.actor_session_id,old.actor_factor_id,old.mfa_verified_at) then raise exception 'Amazon actor context is immutable'; end if;
 return new;
end $$;
create trigger amazon_oauth_actor_immutable before update on public.amazon_oauth_attempts for each row execute function public.integration_amazon_oauth_actor_immutable();
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'integration_amazon_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
