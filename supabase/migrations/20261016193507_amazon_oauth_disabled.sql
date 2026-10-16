-- No scheduler and no feature activation. All writes below are local transactions.
create table public.amazon_seller_owners(
 seller_id text primary key check(seller_id ~ '^[A-Z0-9]{1,64}$'),
 workspace_id uuid not null references public.workspaces(id),owner_id uuid not null references public.workspaces(id),
 integration_account_id uuid not null unique references public.integration_accounts(id));
do $$ begin
 if exists(select 1 from public.integration_accounts i where i.provider='amazon' and
 (i.external_account_id is null or exists(select 1 from public.integration_accounts j where j.provider='amazon' and j.external_account_id=i.external_account_id and j.id<>i.id)))
 or exists(select 1 from public.amazon_accounts a left join public.integration_accounts i on i.id=a.integration_account_id
 where i.id is null or i.provider<>'amazon' or i.owner_id<>a.owner_id or i.external_account_id is distinct from a.seller_id)
 then raise exception 'Amazon seller registry preflight failed'; end if;
end $$;
insert into public.amazon_seller_owners select external_account_id,owner_id,owner_id,id from public.integration_accounts where provider='amazon';
create table public.amazon_oauth_attempts(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
 workspace_id uuid not null references public.workspaces(id),owner_id uuid not null references public.workspaces(id),
 app_key text not null default 'public_v1' check(app_key='public_v1'),purpose text not null default 'connect' check(purpose='connect'),
 target_integration_id uuid references public.integration_accounts(id),expected_seller_id text,expected_version bigint,
 nonce_hash text not null unique check(nonce_hash ~ '^[a-f0-9]{64}$'),ticket_hash text not null unique check(ticket_hash ~ '^[a-f0-9]{64}$'),
 browser_hash text check(browser_hash ~ '^[a-f0-9]{64}$'),ticket_consumed_at timestamptz,
 created_at timestamptz not null default now(),expires_at timestamptz not null,ticket_expires_at timestamptz not null,
 continuation jsonb,
 status text not null default 'pending' check(status in ('pending','exchanging','complete','failed')),reason_code text,
 check(expires_at>created_at and expires_at<=created_at+interval '10 minutes'),
 check(ticket_expires_at>created_at and ticket_expires_at<=created_at+interval '30 seconds'));
alter table public.amazon_oauth_attempts enable row level security;
alter table public.amazon_seller_owners enable row level security;
revoke all on public.amazon_oauth_attempts,public.amazon_seller_owners from public,anon,authenticated;
grant select,insert,update,delete on public.amazon_oauth_attempts,public.amazon_seller_owners to service_role;
create function public.integration_amazon_assert_context(p_user uuid,p_workspace uuid,p_owner uuid) returns void
language plpgsql security invoker set search_path='' as $$ begin
 if not exists(select 1 from public.app_users u join public.workspaces w on w.id=u.workspace_id
 join public.workspaces o on o.id=u.data_owner_id where u.user_id=p_user and u.active and u.role='admin'
 and u.workspace_id=p_workspace and u.data_owner_id=p_owner and w.status in ('active','trialing') and o.status in ('active','trialing'))
 then raise exception 'Amazon authorization denied'; end if;
end $$;
create function public.integration_amazon_quota(p_workspace uuid,p_owner uuid,p_target uuid default null,p_attempt uuid default null) returns void
language plpgsql security invoker set search_path='' as $$ declare q jsonb; k text; lim numeric; used bigint; begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('amazon-workspace:'||p_workspace::text,0));
 foreach k in array array['integration.amazon','amazon_accounts'] loop
 q:=null;
 select s.entitlements->k into q from public.app_subscription_state s where s.workspace_id=p_workspace and s.status in ('active','trialing');
 if q is null then select pg_catalog.jsonb_build_object('enabled',e.enabled,'limit',e.limit_value) into q from public.workspace_subscriptions s join public.plan_entitlements e on e.plan_key=s.plan_key and e.entitlement_key=k where s.workspace_id=p_workspace and s.status in ('active','trialing'); end if;
 if coalesce((q->>'enabled')::boolean,true)=false then raise exception 'Amazon plan unavailable'; end if;
 if k='amazon_accounts' and not exists(select 1 from public.integration_accounts i where i.id=p_target and i.owner_id=p_owner and i.provider='amazon' and i.enabled and i.status<>'disabled' and not i.config ? 'archivedAt') then
 lim:=nullif(q->>'limit','')::numeric;
 select (select count(*) from public.integration_accounts i where i.owner_id=p_owner and i.provider='amazon' and i.enabled and i.status<>'disabled' and not i.config ? 'archivedAt')+
 (select count(*) from public.amazon_oauth_attempts a where a.workspace_id=p_workspace and a.target_integration_id is null and a.status in ('pending','exchanging') and a.expires_at>now() and a.id is distinct from p_attempt) into used;
 if lim is not null and used>=lim then raise exception 'Amazon account limit reached'; end if;
 end if;
 end loop;
end $$;
create function public.integration_amazon_oauth_reserve(p_user_id uuid,p_workspace_id uuid,p_owner_id uuid,p_target_integration_id uuid,p_expected_seller_id text,p_nonce_hash text,p_ticket_hash text,p_expires_at timestamptz,p_ticket_expires_at timestamptz,p_continuation jsonb default null) returns uuid
language plpgsql security invoker set search_path='' as $$ declare i public.integration_accounts; result uuid; begin
 perform public.integration_amazon_assert_context(p_user_id,p_workspace_id,p_owner_id);
 if p_target_integration_id is null and p_expected_seller_id is not null then
 select r.integration_account_id into p_target_integration_id from public.amazon_seller_owners r where r.seller_id=p_expected_seller_id and r.workspace_id=p_workspace_id and r.owner_id=p_owner_id;
 end if;
 perform public.integration_amazon_quota(p_workspace_id,p_owner_id,p_target_integration_id);
 if p_target_integration_id is not null then
 select * into i from public.integration_accounts where id=p_target_integration_id and owner_id=p_owner_id and provider='amazon';
 if not found or (p_expected_seller_id is not null and p_expected_seller_id<>i.external_account_id) then raise exception 'Amazon authorization denied'; end if;
 end if;
 insert into public.amazon_oauth_attempts(user_id,workspace_id,owner_id,target_integration_id,expected_seller_id,expected_version,nonce_hash,ticket_hash,expires_at,ticket_expires_at,continuation)
 values(p_user_id,p_workspace_id,p_owner_id,p_target_integration_id,coalesce(i.external_account_id,p_expected_seller_id),i.amazon_credential_version,p_nonce_hash,p_ticket_hash,p_expires_at,p_ticket_expires_at,p_continuation) returning id into result; return result;
end $$;
create function public.integration_amazon_oauth_bind_browser(p_ticket_hash text,p_nonce_hash text,p_browser_hash text,p_previous_browser_hash text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$ declare a public.amazon_oauth_attempts; begin
 if p_browser_hash is null or p_browser_hash !~ '^[a-f0-9]{64}$' then raise exception 'Amazon attempt unavailable'; end if;
 select * into a from public.amazon_oauth_attempts where ticket_hash=p_ticket_hash and nonce_hash=p_nonce_hash for update;
 if not found or a.status<>'pending' or a.ticket_consumed_at is not null or a.ticket_expires_at<=now() or a.expires_at<=now() then raise exception 'Amazon attempt unavailable'; end if;
 perform public.integration_amazon_assert_context(a.user_id,a.workspace_id,a.owner_id);
 update public.amazon_oauth_attempts set status='failed',reason_code='superseded' where browser_hash=p_previous_browser_hash and id<>a.id and status in ('pending','exchanging');
 update public.amazon_oauth_attempts set browser_hash=p_browser_hash,ticket_consumed_at=now() where id=a.id;
 return pg_catalog.jsonb_build_object('attempt_id',a.id,'expected_seller_id',a.expected_seller_id,'continuation',a.continuation);
end $$;
create function public.integration_amazon_oauth_claim(p_nonce_hash text,p_browser_hash text,p_seller_id text) returns jsonb
language plpgsql security invoker set search_path='' as $$ declare a public.amazon_oauth_attempts; begin
 select * into a from public.amazon_oauth_attempts where nonce_hash=p_nonce_hash;
 if not found then raise exception 'Amazon attempt unavailable'; end if;
 perform public.integration_amazon_quota(a.workspace_id,a.owner_id,a.target_integration_id,a.id);
 select * into a from public.amazon_oauth_attempts where id=a.id for update;
 if a.status<>'pending' or a.expires_at<=now() or a.ticket_consumed_at is null or a.browser_hash is distinct from p_browser_hash or p_browser_hash is null or p_seller_id is null or p_seller_id !~ '^[A-Z0-9]{1,64}$' or (a.expected_seller_id is not null and a.expected_seller_id<>p_seller_id) then raise exception 'Amazon attempt unavailable'; end if;
 perform public.integration_amazon_assert_context(a.user_id,a.workspace_id,a.owner_id);
 if a.target_integration_id is null and exists(select 1 from public.amazon_seller_owners r where r.seller_id=p_seller_id) then raise exception 'Amazon authorization changed'; end if;
 if a.target_integration_id is not null and not exists(select 1 from public.integration_accounts i where i.id=a.target_integration_id and i.owner_id=a.owner_id and i.external_account_id=p_seller_id and i.amazon_credential_version=a.expected_version) then raise exception 'Amazon authorization denied'; end if;
 update public.amazon_oauth_attempts set status='exchanging',expected_seller_id=p_seller_id where id=a.id;
 return pg_catalog.jsonb_build_object('attempt_id',a.id,'user_id',a.user_id,'workspace_id',a.workspace_id,'owner_id',a.owner_id,'integration_account_id',a.target_integration_id,'app_key',a.app_key,'expected_version',a.expected_version);
end $$;
-- Shared transactional writer; registry ownership survives disabling or archiving.
create function public.integration_amazon_write(p_user uuid,p_workspace uuid,p_owner uuid,p_id uuid,p_seller text,p_token text,p_name text,p_config jsonb,p_version bigint,p_app text,p_attempt uuid default null)
returns table(integration_account_id uuid,amazon_account_id uuid,amazon_credential_version bigint)
language plpgsql security invoker set search_path='' as $$ declare i public.integration_accounts; aid uuid; sid uuid; registered public.amazon_seller_owners; begin
 perform public.integration_amazon_assert_context(p_user,p_workspace,p_owner);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('amazon-workspace:'||p_workspace::text,0));
 if p_seller is null or p_seller !~ '^[A-Z0-9]{1,64}$' or coalesce(btrim(p_token),'')='' then raise exception 'Amazon credentials invalid'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('amazon-seller:'||p_seller,0));
 select * into registered from public.amazon_seller_owners where seller_id=p_seller;
 if found then
 if registered.owner_id<>p_owner or registered.workspace_id<>p_workspace or (p_id is not null and p_id<>registered.integration_account_id) then raise exception 'Amazon seller unavailable'; end if;
 if p_id is null then
 if p_attempt is not null then raise exception 'Amazon authorization changed'; end if;
 p_id:=registered.integration_account_id;
 select x.amazon_credential_version into p_version from public.integration_accounts x where x.id=p_id;
 end if;
 end if;
 perform public.integration_amazon_quota(p_workspace,p_owner,p_id,p_attempt);
 if p_id is not null then
 select * into i from public.integration_accounts where id=p_id and owner_id=p_owner and provider='amazon' for update;
 if not found or i.external_account_id<>p_seller or p_version is null or i.amazon_credential_version<>p_version or (p_app='private_v1' and i.sp_api_app_key<>'private_v1') then raise exception 'Amazon authorization changed'; end if;
 else
 if p_version is not null then raise exception 'Amazon authorization changed'; end if;
 i.id:=gen_random_uuid(); i.amazon_credential_version:=0;
 end if;
 select public.integration_store_secret(pg_catalog.jsonb_build_object('refreshToken',p_token,'sellerId',p_seller)::text,'amazon-'||i.id::text,'Amazon account authorization',i.secret_id) into sid;
 if p_id is null then
 insert into public.integration_accounts(id,owner_id,provider,display_name,external_account_id,status,enabled,credential_source,secret_id,config,sp_api_app_key,amazon_credential_version)
 values(i.id,p_owner,'amazon',coalesce(nullif(p_name,''),'Amazon Europe'),p_seller,'pending',true,'vault',sid,coalesce(p_config,'{}')-'archivedAt'-'disconnectedAt'-'revoked'-'revokedAt'-'sp_api_app_key'-'spApiAppKey',p_app,1);
 else
 update public.integration_accounts set secret_id=sid,credential_source='vault',sp_api_app_key=p_app,amazon_credential_version=i.amazon_credential_version+1,status='pending',enabled=true,config=(config-'archivedAt'-'disconnectedAt'-'revoked'-'revokedAt')||(coalesce(p_config,'{}')-'archivedAt'-'disconnectedAt'-'revoked'-'revokedAt'-'sp_api_app_key'-'spApiAppKey'),updated_at=now() where id=i.id;
 end if;
 insert into public.amazon_seller_owners values(p_seller,p_workspace,p_owner,i.id) on conflict(seller_id) do nothing;
 insert into public.amazon_accounts(owner_id,seller_id,integration_account_id,status) values(p_owner,p_seller,i.id,'pending')
 on conflict(owner_id,seller_id) do update set integration_account_id=excluded.integration_account_id,status='pending',updated_at=now() returning id into aid;
 update public.integration_accounts set linked_resource_id=aid where id=i.id;
 return query select i.id,aid,i.amazon_credential_version+1;
end $$;
create function public.integration_amazon_commit_manual(p_user_id uuid,p_workspace_id uuid,p_owner_id uuid,p_integration_account_id uuid,p_seller_id text,p_refresh_token text,p_display_name text,p_config jsonb,p_expected_version bigint)
returns table(integration_account_id uuid,amazon_account_id uuid,amazon_credential_version bigint)
language sql security invoker set search_path='' as $$ select * from public.integration_amazon_write(p_user_id,p_workspace_id,p_owner_id,p_integration_account_id,p_seller_id,p_refresh_token,p_display_name,p_config,p_expected_version,'private_v1') $$;
create function public.integration_amazon_oauth_commit(p_attempt_id uuid,p_seller_id text,p_refresh_token text)
returns table(integration_account_id uuid,amazon_account_id uuid,amazon_credential_version bigint)
language plpgsql security invoker set search_path='' as $$ declare a public.amazon_oauth_attempts; begin
 select * into a from public.amazon_oauth_attempts where id=p_attempt_id;
 if not found then raise exception 'Amazon attempt unavailable'; end if;
 perform public.integration_amazon_quota(a.workspace_id,a.owner_id,a.target_integration_id,a.id);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('amazon-seller:'||p_seller_id,0));
 select * into a from public.amazon_oauth_attempts where id=p_attempt_id for update;
 if a.status<>'exchanging' or a.expires_at<=now() or a.expected_seller_id is distinct from p_seller_id then raise exception 'Amazon attempt unavailable'; end if;
 return query select * from public.integration_amazon_write(a.user_id,a.workspace_id,a.owner_id,a.target_integration_id,p_seller_id,p_refresh_token,'Amazon Europe','{}',a.expected_version,'public_v1',a.id);
 update public.amazon_oauth_attempts set status='complete' where id=a.id;
end $$;
create function public.integration_amazon_oauth_fail(p_attempt_id uuid,p_reason_code text) returns void
language plpgsql security invoker set search_path='' as $$ begin
 if p_reason_code is null or p_reason_code not in ('exchange_failed','commit_failed','configuration_unavailable','invalid_response','expired','superseded','cancelled') then raise exception 'Invalid failure reason'; end if;
 update public.amazon_oauth_attempts set status='failed',reason_code=p_reason_code where id=p_attempt_id and status in ('pending','exchanging');
end $$;
create function public.integration_amazon_oauth_cleanup(p_limit integer default 100) returns integer
language plpgsql security invoker set search_path='' as $$ declare n integer; begin
 if p_limit is null or p_limit<1 or p_limit>1000 then raise exception 'Invalid cleanup limit'; end if;
 with expired as(select id from public.amazon_oauth_attempts where expires_at<=now() and status in ('pending','exchanging') order by expires_at for update skip locked limit p_limit)
 update public.amazon_oauth_attempts set status='failed',reason_code='expired' where id in(select id from expired);
 get diagnostics n=row_count; return n;
end $$;
-- Direct writes must agree with the durable registry; RPC inserts are checked at commit.
create function public.integration_amazon_registry_guard() returns trigger
language plpgsql security invoker set search_path='' as $$ declare iid uuid; own uuid; seller text; begin
 if tg_table_name='integration_accounts' then
 if new.provider<>'amazon' then
 if tg_op='UPDATE' and old.provider='amazon' then raise exception 'Amazon identity is immutable'; end if;
 return new; end if;
 iid:=new.id; own:=new.owner_id; seller:=new.external_account_id;
 else iid:=new.integration_account_id; own:=new.owner_id; seller:=new.seller_id; end if;
 if not exists(select 1 from public.amazon_seller_owners r join public.integration_accounts i on i.id=r.integration_account_id where r.seller_id=seller and r.owner_id=own and r.integration_account_id=iid and i.owner_id=own and i.external_account_id=seller and i.provider='amazon') then raise exception 'Amazon seller registry mismatch'; end if;
 return new;
end $$;
create constraint trigger amazon_integration_registry after insert or update on public.integration_accounts deferrable initially deferred for each row execute function public.integration_amazon_registry_guard();
create constraint trigger amazon_account_registry after insert or update on public.amazon_accounts deferrable initially deferred for each row execute function public.integration_amazon_registry_guard();
-- Metadata reactivation uses the same quota lock as authorization writers.
create function public.integration_amazon_set_enabled(p_user_id uuid,p_workspace_id uuid,p_owner_id uuid,p_integration_account_id uuid,p_expected_version bigint,p_enabled boolean)
returns uuid language plpgsql security invoker set search_path='' as $$ declare i public.integration_accounts; begin
 perform public.integration_amazon_assert_context(p_user_id,p_workspace_id,p_owner_id);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('amazon-workspace:'||p_workspace_id::text,0));
 select * into i from public.integration_accounts where id=p_integration_account_id and owner_id=p_owner_id and provider='amazon' for update;
 if not found or p_expected_version is null or i.amazon_credential_version<>p_expected_version or p_enabled is null then raise exception 'Amazon authorization changed'; end if;
 if p_enabled then
 if i.config ? 'archivedAt' then raise exception 'Amazon account archived'; end if;
 perform public.integration_amazon_quota(p_workspace_id,p_owner_id,i.id);
 end if;
 if not p_enabled then update public.amazon_oauth_attempts set status='failed',reason_code='cancelled' where target_integration_id=i.id and status in ('pending','exchanging'); end if;
 update public.integration_accounts set enabled=p_enabled,amazon_credential_version=amazon_credential_version+case when not p_enabled then 1 else 0 end,status=case when p_enabled and status='disabled' then 'pending' else status end,updated_at=now() where id=i.id;
 return i.id;
end $$;
-- Archive/disconnect invalidates any authorization snapshot and in-flight callback.
create function public.integration_amazon_archive(p_user_id uuid,p_workspace_id uuid,p_owner_id uuid,p_integration_account_id uuid,p_expected_version bigint,p_archive boolean default true)
returns uuid language plpgsql security invoker set search_path='' as $$ declare i public.integration_accounts; sid uuid; begin
 perform public.integration_amazon_assert_context(p_user_id,p_workspace_id,p_owner_id);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('amazon-workspace:'||p_workspace_id::text,0));
 select * into i from public.integration_accounts where id=p_integration_account_id and owner_id=p_owner_id and provider='amazon';
 if not found then raise exception 'Amazon authorization changed'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('amazon-seller:'||i.external_account_id,0));
 select * into i from public.integration_accounts where id=p_integration_account_id for update;
 if p_expected_version is null or i.amazon_credential_version<>p_expected_version or p_archive is null then raise exception 'Amazon authorization changed'; end if;
 select public.integration_store_secret(pg_catalog.jsonb_build_object('sellerId',i.external_account_id,'revoked',true)::text,'amazon-'||i.id::text,'Disconnected Amazon authorization',i.secret_id) into sid;
 update public.integration_accounts set enabled=false,is_default=false,status='disabled',secret_id=sid,amazon_credential_version=i.amazon_credential_version+1,
 config=case when p_archive then config||pg_catalog.jsonb_build_object('archivedAt',now()) else config end,updated_at=now() where id=i.id;
 if i.is_default then
 update public.integration_accounts set is_default=true where id=(select a.id from public.integration_accounts a where a.owner_id=p_owner_id and a.provider='amazon' and a.id<>i.id and a.enabled and a.status<>'disabled' and not a.config ? 'archivedAt' order by a.id limit 1);
 end if;
 update public.amazon_accounts set status='disabled',updated_at=now() where integration_account_id=i.id and owner_id=p_owner_id;
 update public.amazon_oauth_attempts set status='failed',reason_code='cancelled' where target_integration_id=i.id and status in ('pending','exchanging');
 return i.id;
end $$;
create function public.integration_amazon_update_metadata(p_user_id uuid,p_workspace_id uuid,p_owner_id uuid,p_integration_account_id uuid,p_expected_version bigint,p_display_name text,p_config jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$ declare i public.integration_accounts; begin
 perform public.integration_amazon_assert_context(p_user_id,p_workspace_id,p_owner_id);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('amazon-workspace:'||p_workspace_id::text,0));
 select * into i from public.integration_accounts where id=p_integration_account_id and owner_id=p_owner_id and provider='amazon' for update;
 if not found or p_expected_version is null or i.amazon_credential_version<>p_expected_version or i.config ? 'archivedAt' then raise exception 'Amazon authorization changed'; end if;
 if p_config is not null and (pg_catalog.jsonb_typeof(p_config)<>'object' or p_config ?| array['archivedAt','disconnectedAt','revoked','revokedAt','sp_api_app_key','spApiAppKey']) then raise exception 'Invalid Amazon metadata'; end if;
 update public.integration_accounts set display_name=coalesce(nullif(btrim(p_display_name),''),display_name),config=config||coalesce(p_config,'{}'),updated_at=now() where id=i.id;
 return i.id;
end $$;
-- Explicit service-only ACL for every new RPC and helper (including trigger helper).
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'integration_amazon_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
