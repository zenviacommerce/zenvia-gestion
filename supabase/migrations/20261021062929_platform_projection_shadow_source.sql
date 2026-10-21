-- Additive shadow replication. Disabled until explicitly configured.
create schema if not exists private;
create table private.platform_shadow_source_config(
 singleton boolean primary key default true check(singleton),enabled boolean not null default false,
 source_project_ref text,generation uuid,key_id text,receiver_url text,drain_lease uuid,drain_until timestamptz,period_start timestamptz,
 hmac_secret_name text not null default 'platform_shadow_hmac_v1',worker_secret_name text not null default 'platform_shadow_worker_v1'
);
insert into private.platform_shadow_source_config(singleton) values(true);
create table private.platform_shadow_source_workspaces(workspace_id uuid primary key references public.workspaces(id),bootstrap_completed_at timestamptz);
create table private.platform_shadow_versions(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,entity_type text not null check(entity_type in ('metrics','ticket')),
 entity_id uuid not null,revision bigint not null default 1,updated_at timestamptz not null default clock_timestamp(),deleted boolean not null default false,fingerprint text,
 unique(workspace_id,entity_type,entity_id)
);
create index platform_shadow_versions_cursor_idx on private.platform_shadow_versions(updated_at,id);
create table private.platform_shadow_outbox(
 event_id uuid primary key default gen_random_uuid(),version_id uuid not null references private.platform_shadow_versions(id),
 created_at timestamptz not null default clock_timestamp(),available_at timestamptz not null default clock_timestamp(),
 attempts int not null default 0 check(attempts>=0),lease_token uuid,lease_until timestamptz,payload jsonb,
 delivered_at timestamptz,failed_at timestamptz,last_error_code text
);
create index platform_shadow_outbox_pending_idx on private.platform_shadow_outbox(available_at,created_at) where delivered_at is null and failed_at is null;

create function private.platform_shadow_ticket_payload(p_workspace uuid,p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('ticket_number',t.ticket_number,'subject',t.subject,'type',t.type,'status',t.status,'priority',t.priority,'assigned_to',t.assigned_to,'last_author_role',t.last_author_role,'created_at',t.created_at,'updated_at',t.updated_at,'last_activity_at',t.last_activity_at)
 from public.support_tickets t where t.owner_id=p_workspace and t.id=p_id;
$$;

create function private.platform_shadow_touch(p_workspace uuid,p_type text,p_id uuid,p_deleted boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if not exists(select 1 from private.platform_shadow_source_config where enabled) or not exists(select 1 from private.platform_shadow_source_workspaces where workspace_id=p_workspace) then return;end if;
 insert into private.platform_shadow_versions(workspace_id,entity_type,entity_id,deleted,fingerprint) values(p_workspace,p_type,p_id,p_deleted,case when p_type='ticket' then md5((case when p_deleted then '{}'::jsonb else private.platform_shadow_ticket_payload(p_workspace,p_id) end)::text) end)
 on conflict(workspace_id,entity_type,entity_id) do update set revision=private.platform_shadow_versions.revision+1,updated_at=clock_timestamp(),deleted=excluded.deleted,fingerprint=excluded.fingerprint returning id into v_id;
 insert into private.platform_shadow_outbox(version_id) values(v_id);
end;$$;

create function private.platform_shadow_capture() returns trigger language plpgsql security definer set search_path='' as $$
declare oldrow jsonb;newrow jsonb;oldowner uuid;newowner uuid;ownercol text;
begin
 if not exists(select 1 from private.platform_shadow_source_config where enabled) then return null;end if;
 if TG_OP<>'INSERT' then oldrow=to_jsonb(old);end if;
 if TG_OP<>'DELETE' then newrow=to_jsonb(new);end if;
 ownercol=case when TG_TABLE_NAME='app_users' then 'workspace_id' else 'owner_id' end;
 oldowner=(oldrow->>ownercol)::uuid;newowner=(newrow->>ownercol)::uuid;
 if TG_TABLE_NAME='support_tickets' then
  if TG_OP='UPDATE' and oldrow=newrow then return null;end if;
  if oldowner is not null and (TG_OP='DELETE' or oldowner is distinct from newowner) then perform private.platform_shadow_touch(oldowner,'ticket',(oldrow->>'id')::uuid,true);end if;
  if newowner is not null then perform private.platform_shadow_touch(newowner,'ticket',(newrow->>'id')::uuid,false);end if;
 else
  if TG_OP='UPDATE' and oldowner is not distinct from newowner and
   (case TG_TABLE_NAME when 'app_users' then oldrow->'active' is not distinct from newrow->'active'
    when 'amazon_accounts' then oldrow->'status' is not distinct from newrow->'status'
    else oldrow->'order_created_at' is not distinct from newrow->'order_created_at' end) then return null;end if;
  -- Lock workspaces in UUID order when an entity moves between tenants.
  if oldowner is not null and (newowner is null or oldowner<newowner) then perform private.platform_shadow_touch(oldowner,'metrics',oldowner);end if;
  if newowner is not null then perform private.platform_shadow_touch(newowner,'metrics',newowner);end if;
  if oldowner is not null and newowner is not null and oldowner>newowner then perform private.platform_shadow_touch(oldowner,'metrics',oldowner);end if;
 end if;
 return null;
end;$$;
create trigger platform_shadow_users after insert or update or delete on public.app_users for each row execute function private.platform_shadow_capture();
create trigger platform_shadow_amazon after insert or update or delete on public.amazon_accounts for each row execute function private.platform_shadow_capture();
create trigger platform_shadow_orders after insert or update or delete on public.fulfillment_orders for each row execute function private.platform_shadow_capture();
create trigger platform_shadow_tickets after insert or update or delete on public.support_tickets for each row execute function private.platform_shadow_capture();

create function private.platform_shadow_event(p_version private.platform_shadow_versions,p_event_id text)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('protocol',1,'source_project_ref',c.source_project_ref,'generation',c.generation,'event_id',p_event_id,
 'workspace_id',p_version.workspace_id,'entity_type',p_version.entity_type,'entity_id',p_version.entity_id,
 'revision',p_version.revision::text,'observed_at',statement_timestamp(),'deleted',p_version.deleted,
 'payload',case when p_version.entity_type='metrics' then jsonb_build_object(
  'users_active',(select count(*) from public.app_users where workspace_id=p_version.workspace_id and active),
  'amazon_accounts',(select count(*) from public.amazon_accounts where owner_id=p_version.workspace_id and status<>'disabled'),
  'monthly_orders',(select count(*) from public.fulfillment_orders where owner_id=p_version.workspace_id
    and order_created_at>=date_trunc('month',statement_timestamp() at time zone 'UTC') at time zone 'UTC'
    and order_created_at<(date_trunc('month',statement_timestamp() at time zone 'UTC')+interval '1 month') at time zone 'UTC'),
  'period_start',date_trunc('month',statement_timestamp() at time zone 'UTC') at time zone 'UTC',
  'period_end',(date_trunc('month',statement_timestamp() at time zone 'UTC')+interval '1 month') at time zone 'UTC')
 when p_version.deleted then '{}'::jsonb else private.platform_shadow_ticket_payload(p_version.workspace_id,p_version.entity_id) end)
 from private.platform_shadow_source_config c where c.enabled;
$$;

create function public.platform_shadow_source_claim(p_lease uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.platform_shadow_outbox;body jsonb;
begin
 if not exists(select 1 from private.platform_shadow_source_config where enabled and drain_lease=p_lease and drain_until>clock_timestamp()) then return null;end if;
 update private.platform_shadow_outbox set failed_at=clock_timestamp(),last_error_code='LEASE_EXPIRED'
 where attempts>=10 and delivered_at is null and failed_at is null and lease_until<clock_timestamp();
 select * into r from private.platform_shadow_outbox where delivered_at is null and failed_at is null and available_at<=clock_timestamp()
 and (lease_until is null or lease_until<clock_timestamp()) order by created_at,event_id for update skip locked limit 1;
 if not found then return null;end if;
 body=r.payload;
 if body is null then select private.platform_shadow_event(v,r.event_id::text) into body from private.platform_shadow_versions v where v.id=r.version_id;end if;
 update private.platform_shadow_outbox set payload=body,lease_token=p_lease,lease_until=clock_timestamp()+interval '60 seconds',attempts=attempts+1 where event_id=r.event_id;
 return body;
end;$$;
create function public.platform_shadow_source_ack(p_event uuid,p_lease uuid,p_success boolean,p_error text default null,p_retry_after int default 0)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 update private.platform_shadow_outbox set delivered_at=case when p_success then clock_timestamp() end,
 failed_at=case when not p_success and attempts>=10 then clock_timestamp() end,
 last_error_code=case when p_success then null else left(coalesce(p_error,'DELIVERY_FAILED'),80) end,
 available_at=clock_timestamp()+make_interval(secs=>greatest(least(3600,greatest(0,p_retry_after)),least(3600,15*power(2,least(attempts-1,8))+floor(random()*5)))::int),lease_token=null,lease_until=null
 where event_id=p_event and lease_token=p_lease and lease_until>clock_timestamp() and delivered_at is null;
 return found;
end;$$;

-- Full authoritative repair; lock live rows before their versions, like business writes.
-- A delete/move cannot be overwritten by an ID captured before its commit.
create function public.platform_shadow_source_bootstrap() returns void language plpgsql security definer set search_path='' as $$
declare w record;t record;version_row record;fp text;
begin
 if not exists(select 1 from private.platform_shadow_source_config where enabled) then raise exception 'SHADOW_DISABLED';end if;
 if not pg_try_advisory_xact_lock(72104215) then raise exception 'REPAIR_BUSY';end if;
 for w in select workspace_id from private.platform_shadow_source_workspaces order by workspace_id loop
  perform private.platform_shadow_touch(w.workspace_id,'metrics',w.workspace_id);
  for t in select st.id from public.support_tickets st where st.owner_id=w.workspace_id order by st.id for share loop
   fp=md5(private.platform_shadow_ticket_payload(w.workspace_id,t.id)::text);
   if not exists(select 1 from private.platform_shadow_versions where workspace_id=w.workspace_id and entity_type='ticket' and entity_id=t.id and not deleted and fingerprint=fp) then
    perform private.platform_shadow_touch(w.workspace_id,'ticket',t.id);
   end if;
  end loop;
  for version_row in select * from private.platform_shadow_versions v where v.workspace_id=w.workspace_id and v.entity_type='ticket' and not v.deleted
   and not exists(select 1 from public.support_tickets st where st.owner_id=v.workspace_id and st.id=v.entity_id) order by v.id for update skip locked loop
   if not exists(select 1 from public.support_tickets st where st.owner_id=version_row.workspace_id and st.id=version_row.entity_id) then
    perform private.platform_shadow_touch(w.workspace_id,'ticket',version_row.entity_id,true);
   end if;
  end loop;
  update private.platform_shadow_source_workspaces set bootstrap_completed_at=clock_timestamp() where workspace_id=w.workspace_id;
 end loop;
end;$$;

create function public.platform_shadow_source_snapshot(p_after timestamptz,p_id uuid,p_upper timestamptz,p_limit int default 100,p_metrics_after uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
 with page as (
 select v.* from private.platform_shadow_versions v join private.platform_shadow_source_workspaces w using(workspace_id)
 where v.entity_type='ticket' and (p_after is null or (v.updated_at,v.id)>(p_after,coalesce(p_id,'00000000-0000-0000-0000-000000000000'::uuid)))
 and v.updated_at<=p_upper and exists(select 1 from private.platform_shadow_source_config where enabled)
 order by v.updated_at,v.id limit greatest(1,least(p_limit,100))
 ),metrics as (
 select v.* from private.platform_shadow_versions v join private.platform_shadow_source_workspaces w using(workspace_id)
 where v.entity_type='metrics' and (p_metrics_after is null or v.workspace_id>p_metrics_after) order by v.workspace_id limit 25
 ) select jsonb_build_object('events',coalesce((select jsonb_agg(private.platform_shadow_event(p::private.platform_shadow_versions,gen_random_uuid()::text) order by updated_at,id) from page p),'[]'::jsonb)
 ||coalesce((select jsonb_agg(private.platform_shadow_event(m::private.platform_shadow_versions,gen_random_uuid()::text) order by workspace_id) from metrics m),'[]'::jsonb),
 'cursor',(select jsonb_build_object('updated_at',updated_at,'id',id) from page order by updated_at desc,id desc limit 1),
 'has_more',(select count(*)>=greatest(1,least(p_limit,100)) from page),
 'metrics_cursor',(select workspace_id from metrics order by workspace_id desc limit 1),
 'metrics_has_more',(select count(*)>=25 from metrics),
 'workspaces',(select coalesce(jsonb_agg(workspace_id),'[]'::jsonb) from private.platform_shadow_source_workspaces where bootstrap_completed_at is not null),
 'observed_at',statement_timestamp(),
 'outbox',jsonb_build_object('pending',(select count(*) from private.platform_shadow_outbox where delivered_at is null and failed_at is null),
 'failed',(select count(*) from private.platform_shadow_outbox where failed_at is not null),
 'oldest_at',(select min(created_at) from private.platform_shadow_outbox where delivered_at is null)));
$$;

create function public.platform_shadow_source_credentials() returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(c)||jsonb_build_object('hmac_key',(select decrypted_secret from vault.decrypted_secrets where name=c.hmac_secret_name limit 1),
 'worker_token',(select decrypted_secret from vault.decrypted_secrets where name=c.worker_secret_name limit 1)) from private.platform_shadow_source_config c;
$$;
create table private.platform_shadow_source_nonces(nonce uuid primary key,created_at timestamptz not null default clock_timestamp());
create function public.platform_shadow_source_nonce(p_nonce uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 delete from private.platform_shadow_source_nonces where created_at<clock_timestamp()-interval '10 minutes';
 insert into private.platform_shadow_source_nonces(nonce) values(p_nonce) on conflict do nothing;return found;
end;$$;

create function public.platform_shadow_source_drain_lease(p_lease uuid,p_release boolean default false) returns boolean language plpgsql security definer set search_path='' as $$
declare w record;month_start timestamptz=date_trunc('month',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
begin
 if p_release then update private.platform_shadow_source_config set drain_lease=null,drain_until=null where drain_lease=p_lease;return found;end if;
 update private.platform_shadow_source_config set drain_lease=p_lease,drain_until=clock_timestamp()+interval '60 seconds'
 where enabled and (drain_until is null or drain_until<clock_timestamp());if not found then return false;end if;
 if exists(select 1 from private.platform_shadow_source_config where period_start is distinct from month_start) then
  for w in select workspace_id from private.platform_shadow_source_workspaces order by workspace_id loop perform private.platform_shadow_touch(w.workspace_id,'metrics',w.workspace_id);end loop;
  update private.platform_shadow_source_config set period_start=month_start;
 end if;
 delete from private.platform_shadow_outbox where delivered_at<clock_timestamp()-interval '7 days';
 return true;
end;$$;

do $$declare r record;begin
 for r in select tablename from pg_tables where schemaname='private' and tablename like 'platform_shadow_%' loop
 execute format('alter table private.%I enable row level security',r.tablename);execute format('revoke all on private.%I from public,anon,authenticated',r.tablename);
 end loop;
 for r in select p.oid::regprocedure f from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname like 'platform_shadow_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',r.f);execute format('grant execute on function %s to service_role',r.f);
 end loop;
end;$$;
