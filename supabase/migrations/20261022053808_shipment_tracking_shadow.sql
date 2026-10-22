-- Shadow tracking only: no UPDATE/DELETE of fulfillment_orders, labels or marketplaces.
create table public.shipment_tracking_settings(singleton boolean primary key default true check(singleton),enabled boolean not null default false,mode text not null default 'shadow' check(mode='shadow'));
insert into public.shipment_tracking_settings values(true,false,'shadow');
create table public.shipment_tracking_state(
 order_id uuid primary key references public.fulfillment_orders(id) on delete cascade,
 owner_id uuid not null,account_id uuid not null,provider text not null check(provider in ('mrw','sendcloud','envia')),
 tracking_number text not null,identity_key text not null,label_created_at timestamptz,
 normalized_state text check(normalized_state in ('pre_transit','in_transit','out_for_delivery','delivered','exception','returned','cancelled')),
 raw_code text,raw_message text,event_at timestamptz,observed_at timestamptz,movement_at timestamptz,
 last_checked_at timestamptz,next_poll_at timestamptz default now(),failures integer not null default 0,
 last_error text,lease_id uuid,lease_until timestamptz
);
create index shipment_tracking_due on public.shipment_tracking_state(next_poll_at,account_id) where next_poll_at is not null;
create table public.shipment_tracking_account_health(account_id uuid primary key,owner_id uuid not null,provider text not null,last_success_at timestamptz,last_error text,paused_until timestamptz,webhook_status text);
create table public.shipment_tracking_events(order_id uuid not null,owner_id uuid not null,account_id uuid not null,identity_key text not null,event_key text not null,normalized_state text,raw_code text,raw_message text,event_at timestamptz,observed_at timestamptz not null default now(),primary key(order_id,identity_key,event_key));
create table public.shipment_tracking_runs(id uuid primary key,started_at timestamptz not null default now(),completed_at timestamptz,claimed integer not null default 0,succeeded integer not null default 0,failed integer not null default 0,error text);

alter table public.shipment_tracking_settings enable row level security;
alter table public.shipment_tracking_state enable row level security;
alter table public.shipment_tracking_account_health enable row level security;
alter table public.shipment_tracking_events enable row level security;
alter table public.shipment_tracking_runs enable row level security;
revoke all on public.shipment_tracking_settings,public.shipment_tracking_state,public.shipment_tracking_account_health,public.shipment_tracking_events,public.shipment_tracking_runs from public,anon,authenticated;
grant all on public.shipment_tracking_settings,public.shipment_tracking_state,public.shipment_tracking_account_health,public.shipment_tracking_events,public.shipment_tracking_runs to service_role;
-- UI access is via a later reviewed RPC release. Shadow state is not exposed yet.
create function private.shipment_tracking_identity(o public.fulfillment_orders) returns text language sql immutable set search_path='' as $$
 select md5(jsonb_build_array(o.owner_id,o.shipping_integration_account_id,o.shipping_provider,o.tracking_number,o.shipping_remote_id,o.sendcloud_parcel_id,o.label_created_at,o.label_cancelled_at)::text);
$$;
revoke all on function private.shipment_tracking_identity(public.fulfillment_orders) from public,anon,authenticated;
grant execute on function private.shipment_tracking_identity(public.fulfillment_orders) to service_role;

create function public.tracking_seed_shadow() returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 insert into public.shipment_tracking_state(order_id,owner_id,account_id,provider,tracking_number,identity_key,label_created_at)
 select o.id,o.owner_id,a.id,a.provider,o.tracking_number,private.shipment_tracking_identity(o),o.label_created_at
 from public.fulfillment_orders o join public.integration_accounts a on a.id=o.shipping_integration_account_id and a.owner_id=o.owner_id
 join public.workspaces w on w.id=o.owner_id and w.status in('active','trialing')
 where a.enabled and a.status<>'disabled' and a.provider in('mrw','sendcloud','envia')
 and (o.shipping_provider=a.provider or (o.shipping_provider is null and a.provider='sendcloud' and o.sendcloud_parcel_id is not null))
 and nullif(o.tracking_number,'') is not null and o.label_cancelled_at is null
 and upper(replace(coalesce(o.tracking_status_code,''),' ','_')) not in('DELIVERED','RETURNED','CANCELLED','CANCELED','DELIVERED_AT_ORIGIN','SHIPMENT_COLLECTED_BY_CUSTOMER')
 order by o.label_created_at desc nulls last limit 1000
 on conflict(order_id) do update set owner_id=excluded.owner_id,account_id=excluded.account_id,provider=excluded.provider,tracking_number=excluded.tracking_number,identity_key=excluded.identity_key,label_created_at=excluded.label_created_at,
 normalized_state=null,raw_code=null,raw_message=null,event_at=null,observed_at=null,movement_at=null,last_checked_at=null,next_poll_at=now(),failures=0,last_error=null,lease_id=null,lease_until=null
 where shipment_tracking_state.identity_key<>excluded.identity_key;
 get diagnostics n=row_count;return n;
end;$$;

create function public.tracking_claim(p_run uuid,p_limit integer default 25) returns setof public.shipment_tracking_state language plpgsql security invoker set search_path='' as $$
begin
 return query with ranked as (
 select s.order_id,row_number() over(partition by s.account_id order by s.next_poll_at,s.order_id) as rank
 from public.shipment_tracking_state s join public.fulfillment_orders o on o.id=s.order_id and o.owner_id=s.owner_id
 join public.integration_accounts a on a.id=s.account_id and a.owner_id=s.owner_id and a.enabled and a.status<>'disabled'
 join public.workspaces w on w.id=s.owner_id and w.status in('active','trialing')
 left join public.shipment_tracking_account_health h on h.account_id=s.account_id
 where s.next_poll_at<=now() and (s.lease_until is null or s.lease_until<now())
 and (h.paused_until is null or h.paused_until<=now())
 and o.label_cancelled_at is null and private.shipment_tracking_identity(o)=s.identity_key
 and coalesce(s.normalized_state,'') not in('delivered','returned','cancelled')
 and upper(replace(coalesce(o.tracking_status_code,''),' ','_')) not in('DELIVERED','RETURNED','CANCELLED','CANCELED','DELIVERED_AT_ORIGIN','SHIPMENT_COLLECTED_BY_CUSTOMER')
 ), candidates as (
 select s.order_id from public.shipment_tracking_state s join ranked r using(order_id)
 order by r.rank,s.next_poll_at,s.account_id,s.order_id limit greatest(0,least(p_limit,25)) for update of s skip locked
 ) update public.shipment_tracking_state s set lease_id=p_run,lease_until=now()+interval '3 minutes'
 from candidates c where c.order_id=s.order_id and (s.lease_until is null or s.lease_until<now()) returning s.*;
end;$$;

create function public.tracking_finish(p_order uuid,p_run uuid,p_identity text,p_event jsonb,p_next timestamptz,p_error text) returns boolean language plpgsql security invoker set search_path='' as $$
declare s public.shipment_tracking_state; o public.fulfillment_orders;
begin
 select * into s from public.shipment_tracking_state where order_id=p_order and lease_id=p_run and identity_key=p_identity and lease_until>now() for update;
 if not found then return false;end if;
 select * into o from public.fulfillment_orders where id=p_order and owner_id=s.owner_id for share;
 if not found or private.shipment_tracking_identity(o)<>p_identity or o.label_cancelled_at is not null
 or upper(replace(coalesce(o.tracking_status_code,''),' ','_')) in('DELIVERED','RETURNED','CANCELLED','CANCELED','DELIVERED_AT_ORIGIN','SHIPMENT_COLLECTED_BY_CUSTOMER') then return false;end if;
 if p_error is null and p_event is not null then
 insert into public.shipment_tracking_events(order_id,owner_id,account_id,identity_key,event_key,normalized_state,raw_code,raw_message,event_at)
 values(p_order,s.owner_id,s.account_id,p_identity,md5(p_event::text),p_event->>'state',left(p_event->>'code',120),left(p_event->>'message',500),nullif(p_event->>'eventAt','')::timestamptz) on conflict do nothing;
 end if;
 update public.shipment_tracking_state set
 normalized_state=case when p_error is null then p_event->>'state' else normalized_state end,
 raw_code=case when p_error is null then left(p_event->>'code',120) else raw_code end,
 raw_message=case when p_error is null then left(p_event->>'message',500) else raw_message end,
 event_at=case when p_error is null then nullif(p_event->>'eventAt','')::timestamptz else event_at end,
 observed_at=case when p_error is null then nullif(p_event->>'observedAt','')::timestamptz else observed_at end,
 movement_at=case when p_error is null then nullif(p_event->>'movementAt','')::timestamptz else movement_at end,
 last_checked_at=case when p_error is null then now() else last_checked_at end,
 next_poll_at=p_next,failures=case when p_error is null then 0 else failures+1 end,
 last_error=left(p_error,100),lease_id=null,lease_until=null where order_id=p_order;
 return true;
end;$$;
revoke all on function public.tracking_seed_shadow(),public.tracking_claim(uuid,integer),public.tracking_finish(uuid,uuid,text,jsonb,timestamptz,text) from public,anon,authenticated;
grant execute on function public.tracking_seed_shadow(),public.tracking_claim(uuid,integer),public.tracking_finish(uuid,uuid,text,jsonb,timestamptz,text) to service_role;
