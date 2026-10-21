-- Correct only shadow functions while source config remains disabled.
create table private.platform_shadow_capture_failures(
 id bigint generated always as identity primary key,failed_at timestamptz not null default clock_timestamp(),
 source_table text not null check(source_table in ('fulfillment_orders','support_tickets','app_users','amazon_accounts')),
 operation text not null check(operation in ('INSERT','UPDATE','DELETE')),error_code text not null check(error_code ~ '^[A-Z0-9]{5}$')
);
create index platform_shadow_capture_failures_time_idx on private.platform_shadow_capture_failures(failed_at);
alter table private.platform_shadow_capture_failures enable row level security;
revoke all on private.platform_shadow_capture_failures from public,anon,authenticated;

create or replace function private.platform_shadow_capture() returns trigger language plpgsql security definer set search_path='' as $$
declare oldrow jsonb;newrow jsonb;oldowner uuid;newowner uuid;code text;
begin
 -- AFTER trigger: exceptions roll back only the shadow subtransaction.
 -- No serialization of whole business rows; these are the complete allowlists.
 begin
  if not exists(select 1 from private.platform_shadow_source_config where enabled) then return null;end if;
  case TG_TABLE_NAME
  when 'fulfillment_orders' then
   if TG_OP<>'INSERT' then oldrow=jsonb_build_object('owner_id',old.owner_id,'order_created_at',old.order_created_at);end if;
   if TG_OP<>'DELETE' then newrow=jsonb_build_object('owner_id',new.owner_id,'order_created_at',new.order_created_at);end if;
  when 'app_users' then
   if TG_OP<>'INSERT' then oldrow=jsonb_build_object('owner_id',old.workspace_id,'active',old.active);end if;
   if TG_OP<>'DELETE' then newrow=jsonb_build_object('owner_id',new.workspace_id,'active',new.active);end if;
  when 'amazon_accounts' then
   if TG_OP<>'INSERT' then oldrow=jsonb_build_object('owner_id',old.owner_id,'status',old.status);end if;
   if TG_OP<>'DELETE' then newrow=jsonb_build_object('owner_id',new.owner_id,'status',new.status);end if;
  when 'support_tickets' then
   if TG_OP<>'INSERT' then oldrow=jsonb_build_object('id',old.id,'owner_id',old.owner_id,'ticket_number',old.ticket_number,'type',old.type,'status',old.status,'priority',old.priority,'assigned_to',old.assigned_to,'last_author_role',old.last_author_role,'created_at',old.created_at,'updated_at',old.updated_at,'last_activity_at',old.last_activity_at);end if;
   if TG_OP<>'DELETE' then newrow=jsonb_build_object('id',new.id,'owner_id',new.owner_id,'ticket_number',new.ticket_number,'type',new.type,'status',new.status,'priority',new.priority,'assigned_to',new.assigned_to,'last_author_role',new.last_author_role,'created_at',new.created_at,'updated_at',new.updated_at,'last_activity_at',new.last_activity_at);end if;
  else raise exception 'SHADOW_UNEXPECTED_TABLE';
  end case;
  if TG_OP='UPDATE' and oldrow is not distinct from newrow then return null;end if;
  oldowner=(oldrow->>'owner_id')::uuid;newowner=(newrow->>'owner_id')::uuid;
  if TG_TABLE_NAME='support_tickets' then
   if oldowner is not null and (TG_OP='DELETE' or oldowner is distinct from newowner) then perform private.platform_shadow_touch(oldowner,'ticket',(oldrow->>'id')::uuid,true);end if;
   if newowner is not null then perform private.platform_shadow_touch(newowner,'ticket',(newrow->>'id')::uuid,false);end if;
  else
   if oldowner is not null and (newowner is null or oldowner<newowner) then perform private.platform_shadow_touch(oldowner,'metrics',oldowner);end if;
   if newowner is not null then perform private.platform_shadow_touch(newowner,'metrics',newowner);end if;
   if oldowner is not null and newowner is not null and oldowner>newowner then perform private.platform_shadow_touch(oldowner,'metrics',oldowner);end if;
  end if;
 exception when others then
  code=SQLSTATE;
  -- Best effort, no SQLERRM/context/row values (may contain buyer data).
  begin
   insert into private.platform_shadow_capture_failures(source_table,operation,error_code) values(TG_TABLE_NAME,TG_OP,code);
  exception when others then
   raise log 'PLATFORM_SHADOW_CAPTURE_FAILURE table=% op=% sqlstate=% logger_failed=true',TG_TABLE_NAME,TG_OP,code;
  end;
 end;
 return null;
end;$$;

create or replace function private.platform_shadow_ticket_payload(p_workspace uuid,p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('ticket_number',t.ticket_number,'type',t.type,'status',t.status,'priority',t.priority,'assigned_to',t.assigned_to,'last_author_role',t.last_author_role,'created_at',t.created_at,'updated_at',t.updated_at,'last_activity_at',t.last_activity_at)
 from public.support_tickets t where t.owner_id=p_workspace and t.id=p_id;
$$;

create or replace function public.platform_shadow_source_snapshot(p_after timestamptz,p_id uuid,p_upper timestamptz,p_limit int default 100,p_metrics_after uuid default null)
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
 'outbox',jsonb_build_object('capture_failed_24h',(select count(*) from private.platform_shadow_capture_failures where failed_at>statement_timestamp()-interval '24 hours'),'last_capture_failure_at',(select max(failed_at) from private.platform_shadow_capture_failures),'pending',(select count(*) from private.platform_shadow_outbox where delivered_at is null and failed_at is null),
 'failed',(select count(*) from private.platform_shadow_outbox where failed_at is not null),
 'oldest_at',(select min(created_at) from private.platform_shadow_outbox where delivered_at is null)));
$$;

-- Never wait for another shadow version writer; reconcile repairs skipped captures.
create or replace function private.platform_shadow_touch(p_workspace uuid,p_type text,p_id uuid,p_deleted boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if not exists(select 1 from private.platform_shadow_source_config where enabled) or not exists(select 1 from private.platform_shadow_source_workspaces where workspace_id=p_workspace) then return;end if;
 if not pg_try_advisory_xact_lock(hashtextextended(p_workspace::text||p_type||p_id::text,72104215)) then raise exception using errcode='55P03',message='SHADOW_CAPTURE_BUSY';end if;
 insert into private.platform_shadow_versions(workspace_id,entity_type,entity_id,deleted,fingerprint) values(p_workspace,p_type,p_id,p_deleted,case when p_type='ticket' then md5((case when p_deleted then '{}'::jsonb else private.platform_shadow_ticket_payload(p_workspace,p_id) end)::text) end)
 on conflict(workspace_id,entity_type,entity_id) do update set revision=private.platform_shadow_versions.revision+1,updated_at=clock_timestamp(),deleted=excluded.deleted,fingerprint=excluded.fingerprint returning id into v_id;
 insert into private.platform_shadow_outbox(version_id) values(v_id);
end;$$;
