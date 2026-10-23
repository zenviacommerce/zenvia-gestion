-- Install paused. Activation is an explicit, separately reviewed release step.
create table private.shipping_creation_worker_control(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
alter table private.shipping_creation_worker_control enable row level security;
revoke all on private.shipping_creation_worker_control from public,anon,authenticated;
insert into private.shipping_creation_worker_control(singleton,enabled) values(true,false);
create function public.shipping_creation_worker_enabled() returns boolean language sql stable security definer set search_path='' as $$select coalesce((select enabled from private.shipping_creation_worker_control where singleton),false)$$;
revoke all on function public.shipping_creation_worker_enabled() from public,anon,authenticated;
grant execute on function public.shipping_creation_worker_enabled() to service_role;

-- Version only public account identity fields and Vault secret metadata; never decrypt credentials.
create or replace function private.shipping_creation_account_revision(p_id uuid)
returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_array(a.secret_id,a.credential_source,a.config->>'environment',(select s.updated_at from vault.secrets s where s.id=a.secret_id)) from public.integration_accounts a where a.id=p_id
$$;
revoke all on function private.shipping_creation_account_revision(uuid) from public,anon,authenticated;
create table if not exists private.shipping_creation_operations (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.workspaces(id),
 order_id uuid not null references public.fulfillment_orders(id),
 account_id uuid not null references public.integration_accounts(id),
 provider text not null check(provider in ('mrw','sendcloud','envia')),
 reference text not null check(length(reference) between 1 and 200),
 actor_id uuid,
 context jsonb not null default '{}'::jsonb,
 state text not null default 'creating' check(state in ('creating','uncertain','accepted','recovered','rejected','released')),
 started_at timestamptz not null default now(),
 next_check_at timestamptz not null default now()+interval '10 minutes',
 reconcile_token uuid,
 reconcile_until timestamptz,
 checks integer not null default 0,
 last_result text,
 closed_at timestamptz
);
alter table private.shipping_creation_operations enable row level security;
revoke all on private.shipping_creation_operations from public,anon,authenticated;
grant select,insert,update on private.shipping_creation_operations to service_role;
create unique index shipping_creation_one_open on private.shipping_creation_operations(owner_id,order_id) where closed_at is null;
create index shipping_creation_due on private.shipping_creation_operations(next_check_at,id) where closed_at is null;

create or replace function public.shipping_creation_begin(p_owner_id uuid,p_order_id uuid,p_provider text,p_account_id uuid,p_reference text,p_context jsonb default '{}'::jsonb,p_actor_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare o public.fulfillment_orders%rowtype; v_id uuid;
begin
 select * into o from public.fulfillment_orders where id=p_order_id and owner_id=p_owner_id for update;
 if not found then raise exception 'CREATION_ORDER_NOT_FOUND';end if;
 if o.pii_purged_at is not null then raise exception 'CREATION_ORDER_PURGED';end if;
 if not exists(select 1 from public.workspaces where id=p_owner_id and status in ('active','trialing')) then raise exception 'CREATION_WORKSPACE_DISABLED';end if;
 if not exists(select 1 from public.integration_accounts where id=p_account_id and owner_id=p_owner_id and provider=p_provider and enabled and status<>'disabled') then raise exception 'CREATION_ACCOUNT_INVALID';end if;
 if p_reference<>coalesce(nullif(o.order_number,''),nullif(o.order_id,''),o.id::text) then raise exception 'CREATION_REFERENCE_INVALID';end if;
 if exists(select 1 from private.shipping_creation_operations where owner_id=p_owner_id and order_id=p_order_id and closed_at is null) or o.tracking_status_code like '%\_CREATING' escape '\' then raise exception 'CREATION_RECONCILIATION_REQUIRED';end if;
 if o.external_shipment or o.shipping_remote_id is not null or o.sendcloud_parcel_id is not null or o.label_created_at is not null then raise exception 'CREATION_ALREADY_LABELLED';end if;
 insert into private.shipping_creation_operations(owner_id,order_id,account_id,provider,reference,actor_id,context)
 values(p_owner_id,p_order_id,p_account_id,p_provider,p_reference,p_actor_id,
 jsonb_strip_nulls(jsonb_build_object('accountRevision',private.shipping_creation_account_revision(p_account_id),'environment',coalesce(p_context->>'environment','production'),'credentialIdentity',left(p_context->>'credentialIdentity',64),'serviceCode',left(p_context->>'serviceCode',200),'serviceName',left(p_context->>'serviceName',200),'carrierCode',left(p_context->>'carrierCode',100),'carrierName',left(p_context->>'carrierName',100),'integrationId',p_context->'integrationId','externalOrderId',left(p_context->>'externalOrderId',200),'excludedIdentities',(select coalesce(jsonb_agg(distinct x.identity),'[]'::jsonb) from (select h.tracking_number identity from public.order_shipment_history h where h.owner_id=p_owner_id and h.order_id=p_order_id and h.provider=p_provider union select h.shipment_reference from public.order_shipment_history h where h.owner_id=p_owner_id and h.order_id=p_order_id and h.provider=p_provider) x where x.identity is not null),'previousRemoteId',o.shipping_remote_id,'previousParcelId',o.sendcloud_parcel_id))) returning id into v_id;
 update public.fulfillment_orders set tracking_status_code=upper(p_provider)||'_CREATING',tracking_status_message='Pendiente de confirmar la creación con el transportista',tracking_updated_at=now() where id=p_order_id and owner_id=p_owner_id;
 return v_id;
end $$;

create or replace function public.shipping_creation_note(p_id uuid,p_owner_id uuid,p_result text)
returns void language plpgsql security definer set search_path='' as $$
declare v private.shipping_creation_operations%rowtype; o public.fulfillment_orders%rowtype;
begin
 select f.* into o from public.fulfillment_orders f join private.shipping_creation_operations c on c.order_id=f.id and c.owner_id=f.owner_id where c.id=p_id and c.owner_id=p_owner_id for update of f;
 if not found then raise exception 'CREATION_ORDER_NOT_FOUND';end if;
 select * into v from private.shipping_creation_operations where id=p_id and owner_id=p_owner_id for update;
 if v.closed_at is not null then return;end if;
 if p_result in ('accepted','uncertain') and o.shipping_provider=v.provider and o.shipping_integration_account_id=v.account_id and (o.shipping_remote_id is not null or o.sendcloud_parcel_id is not null) then
  update private.shipping_creation_operations set state='accepted',closed_at=now(),last_result='accepted' where id=v.id;
 elsif p_result='rejected' and o.shipping_remote_id is null and o.sendcloud_parcel_id is null and o.label_created_at is null and o.tracking_status_code=upper(v.provider)||'_CREATING' then
  update public.fulfillment_orders set tracking_status_code=null,tracking_status_message=null,tracking_updated_at=now() where id=o.id and owner_id=v.owner_id;
  update private.shipping_creation_operations set state='rejected',closed_at=now(),last_result='rejected' where id=v.id;
 else
  update private.shipping_creation_operations set state='uncertain',last_result='awaiting_lookup' where id=v.id;
 end if;
end $$;

create or replace function public.shipping_creation_reconcile_claim(p_owner_id uuid,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.fulfillment_orders%rowtype;v private.shipping_creation_operations%rowtype; t uuid:=gen_random_uuid();
begin
 select * into o from public.fulfillment_orders where id=p_order_id and owner_id=p_owner_id for update;
 if not found then raise exception 'CREATION_ORDER_NOT_FOUND';end if;
 if o.pii_purged_at is not null then raise exception 'CREATION_ORDER_PURGED';end if;
 if o.order_action_lease_until>now() then raise exception 'CREATION_ORDER_BUSY';end if;
 if not exists(select 1 from public.workspaces where id=p_owner_id and status in ('active','trialing')) then raise exception 'CREATION_WORKSPACE_DISABLED';end if;
 select * into v from private.shipping_creation_operations where owner_id=p_owner_id and order_id=p_order_id and closed_at is null for update;
 if not found then raise exception 'CREATION_NO_OPEN_ATTEMPT';end if;
 if o.shipping_provider=v.provider and o.shipping_integration_account_id=v.account_id and (o.shipping_remote_id is not null or o.sendcloud_parcel_id is not null) then
  update private.shipping_creation_operations set state='accepted',closed_at=now(),last_result='already_persisted',reconcile_token=null,reconcile_until=null where id=v.id;
  return jsonb_build_object('status','recovered','alreadyAccepted',true,'orderId',o.id,'provider',v.provider);
 end if;
 if v.reconcile_until>now() then raise exception 'CREATION_CHECK_BUSY';end if;
 if not exists(select 1 from public.integration_accounts where id=v.account_id and owner_id=v.owner_id and provider=v.provider and enabled and status<>'disabled') then raise exception 'CREATION_ACCOUNT_INVALID';end if;
 update private.shipping_creation_operations set reconcile_token=t,reconcile_until=now()+interval '2 minutes',checks=checks+1 where id=v.id;
 update public.fulfillment_orders set order_action_lease=t,order_action_lease_until=now()+interval '2 minutes' where id=o.id and owner_id=p_owner_id;
 return jsonb_build_object('id',v.id,'ownerId',v.owner_id,'orderId',v.order_id,'provider',v.provider,'accountId',v.account_id,'reference',v.reference,'startedAt',v.started_at,'token',t,'context',v.context,'canRelease',v.started_at<=now()-interval '10 minutes' and coalesce((v.context->>'legacy')::boolean,false)=false);
end $$;

create or replace function public.shipping_creation_resolve(p_id uuid,p_token uuid,p_result text,p_shipment jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v private.shipping_creation_operations%rowtype;o public.fulfillment_orders%rowtype; n text; remote text;parcel bigint;
begin
 select f.* into o from public.fulfillment_orders f join private.shipping_creation_operations c on c.order_id=f.id and c.owner_id=f.owner_id where c.id=p_id for update of f;
 if not found then raise exception 'CREATION_ORDER_NOT_FOUND';end if;
 select * into v from private.shipping_creation_operations where id=p_id for update;
 if v.closed_at is not null or v.reconcile_token is distinct from p_token or v.reconcile_until<=now() then raise exception 'CREATION_STALE_TOKEN';end if;
 if o.order_action_lease_until>now() and o.order_action_lease is distinct from p_token then raise exception 'CREATION_ORDER_BUSY';end if;
 if not exists(select 1 from public.workspaces where id=v.owner_id and status in ('active','trialing')) or not exists(select 1 from public.integration_accounts where id=v.account_id and owner_id=v.owner_id and provider=v.provider and enabled and status<>'disabled') then raise exception 'CREATION_ACCOUNT_INVALID';end if;
 if o.pii_purged_at is not null then raise exception 'CREATION_ORDER_PURGED';end if;
 if o.shipping_remote_id is not null or o.sendcloud_parcel_id is not null or o.label_created_at is not null or o.external_shipment or o.tracking_status_code is distinct from upper(v.provider)||'_CREATING' then raise exception 'CREATION_SHIPMENT_CHANGED';end if;
 if p_result in ('absent','found') then
  perform 1 from public.integration_accounts where id=v.account_id for share;
  perform 1 from vault.secrets where id=(select a.secret_id from public.integration_accounts a where a.id=v.account_id) for share;
  if v.context->'accountRevision' is distinct from private.shipping_creation_account_revision(v.account_id) then raise exception 'CREATION_ACCOUNT_CHANGED';end if;
 end if;
 if p_result='absent' then
  if coalesce((v.context->>'legacy')::boolean,false) then raise exception 'CREATION_LEGACY_ABSENCE_UNPROVEN';end if;
  if v.started_at>now()-interval '10 minutes' then raise exception 'CREATION_GRACE_PERIOD';end if;
  update public.fulfillment_orders set tracking_status_code=null,tracking_status_message=null,tracking_updated_at=now() where id=o.id and owner_id=v.owner_id;
  update private.shipping_creation_operations set state='released',closed_at=now(),last_result='confirmed_absent',reconcile_token=null,reconcile_until=null where id=v.id;
 elsif p_result='found' then
  n=nullif(btrim(p_shipment->>'trackingNumber'),'');remote=nullif(btrim(p_shipment->>'remoteId'),'');
  if v.provider='sendcloud' then parcel=nullif(p_shipment->>'parcelId','')::bigint;end if;
  if n is null or length(n)>200 or (v.provider='sendcloud' and coalesce(parcel,0)<=0) or (v.provider<>'sendcloud' and remote is null) then raise exception 'CREATION_SHIPMENT_INVALID';end if;
  if coalesce(v.context->'excludedIdentities','[]'::jsonb) ? n or coalesce(v.context->'excludedIdentities','[]'::jsonb) ? remote or coalesce(v.context->'excludedIdentities','[]'::jsonb) ? parcel::text then raise exception 'CREATION_OLD_SHIPMENT';end if;
  if (v.context->>'previousRemoteId' is not null and remote=v.context->>'previousRemoteId') or (v.context->>'previousParcelId' is not null and parcel::text=v.context->>'previousParcelId') then raise exception 'CREATION_OLD_SHIPMENT';end if;
  update public.fulfillment_orders set shipping_provider=v.provider,shipping_integration_account_id=v.account_id,shipping_remote_id=case when v.provider='sendcloud' then null else remote end,sendcloud_parcel_id=case when v.provider='sendcloud' then parcel else null end,sendcloud_shipment_id=case when v.provider='sendcloud' then nullif(p_shipment->>'shipmentId','') else null end,
   tracking_number=n,tracking_url=nullif(p_shipment->>'trackingUrl',''),shipping_label_url=nullif(p_shipment->>'labelUrl',''),label_created_at=v.started_at,label_cancelled_at=null,tracking_status_code='READY_TO_SEND',tracking_status_message='Expedición recuperada del transportista',tracking_updated_at=now(),carrier_code=v.context->>'carrierCode',carrier_name=v.context->>'carrierName',shipping_option_code=v.context->>'serviceCode',shipping_service_name=v.context->>'serviceName' where id=o.id and owner_id=v.owner_id;
  update private.shipping_creation_operations set state='recovered',closed_at=now(),last_result='found',reconcile_token=null,reconcile_until=null where id=v.id;
 elsif p_result='unknown' then
  update private.shipping_creation_operations set state='uncertain',last_result='lookup_inconclusive',next_check_at=now()+interval '5 minutes',reconcile_token=null,reconcile_until=null where id=v.id;
 else raise exception 'CREATION_RESULT_INVALID';end if;
 update public.fulfillment_orders set order_action_lease=null,order_action_lease_until=null where id=o.id and owner_id=v.owner_id and order_action_lease=p_token;
 return jsonb_build_object('status',case p_result when 'found' then 'recovered' when 'absent' then 'released' else 'pending' end,'orderId',v.order_id,'provider',v.provider);
end $$;

create or replace function public.shipping_creation_adopt(p_owner_id uuid,p_order_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare o public.fulfillment_orders%rowtype;v_provider text;v_account uuid;v_count integer;v_id uuid;
begin
 select * into o from public.fulfillment_orders where id=p_order_id and owner_id=p_owner_id for update;
 if not found then raise exception 'CREATION_ORDER_NOT_FOUND';end if;
 if o.pii_purged_at is not null then raise exception 'CREATION_ORDER_PURGED';end if;
 if o.order_action_lease_until>now() then raise exception 'CREATION_ORDER_BUSY';end if;
 select id into v_id from private.shipping_creation_operations where owner_id=p_owner_id and order_id=p_order_id and closed_at is null;
 if found then return v_id;end if;
 if o.tracking_status_code not in ('MRW_CREATING','SENDCLOUD_CREATING','ENVIA_CREATING') or o.shipping_remote_id is not null or o.sendcloud_parcel_id is not null or o.label_created_at is not null or o.external_shipment then raise exception 'CREATION_NO_LEGACY_ATTEMPT';end if;
 if not exists(select 1 from public.workspaces where id=p_owner_id and status in ('active','trialing')) then raise exception 'CREATION_WORKSPACE_DISABLED';end if;
 v_provider:=lower(replace(o.tracking_status_code,'_CREATING',''));
 if o.shipping_integration_account_id is not null then
  select id into v_account from public.integration_accounts where id=o.shipping_integration_account_id and owner_id=p_owner_id and provider=v_provider and enabled and status<>'disabled';
  if not found then raise exception 'CREATION_ACCOUNT_INVALID';end if;
 end if;
 if v_account is null then
  select count(*),(array_agg(id))[1] into v_count,v_account from public.integration_accounts where owner_id=p_owner_id and provider=v_provider and enabled and status<>'disabled';
  if v_count<>1 then raise exception 'CREATION_LEGACY_ACCOUNT_AMBIGUOUS';end if;
 end if;
 insert into private.shipping_creation_operations(owner_id,order_id,account_id,provider,reference,context,state)
 values(p_owner_id,p_order_id,v_account,v_provider,coalesce(nullif(o.order_number,''),nullif(o.order_id,''),o.id::text),
 jsonb_build_object('accountRevision',private.shipping_creation_account_revision(v_account),'legacy',true,'lookupStartedAt',coalesce(o.order_created_at,now()-interval '24 hours'),'environment',(select case when v_provider='envia' then case when a.config->>'environment'='production' then 'production' else 'test' end else case when a.config->>'environment'='test' then 'test' else 'production' end end from public.integration_accounts a where a.id=v_account),'serviceCode',o.shipping_option_code,'serviceName',o.shipping_service_name,'carrierCode',coalesce(o.carrier_code,v_provider),'carrierName',coalesce(o.carrier_name,case v_provider when 'mrw' then 'MRW' else null end),'excludedIdentities',(select coalesce(jsonb_agg(distinct x.identity),'[]'::jsonb) from (select tracking_number identity from public.order_shipment_history where owner_id=p_owner_id and order_id=p_order_id and provider=v_provider union select shipment_reference from public.order_shipment_history where owner_id=p_owner_id and order_id=p_order_id and provider=v_provider)x where x.identity is not null)), 'uncertain') returning id into v_id;
 return v_id;
end $$;
create or replace function public.shipping_creation_candidates(p_limit integer default 5)
returns table(owner_id uuid,order_id uuid) language sql security definer set search_path='' as $$
 select q.owner_id,q.order_id from (
  select c.owner_id,c.order_id,c.account_id,c.provider,c.next_check_at from private.shipping_creation_operations c where c.closed_at is null and c.next_check_at<=now() and c.started_at<=now()-interval '10 minutes' and coalesce(c.reconcile_until,'-infinity')<=now()
  union all
  select o.owner_id,o.id,o.shipping_integration_account_id,lower(replace(o.tracking_status_code,'_CREATING','')),now() from public.fulfillment_orders o where o.tracking_status_code in ('MRW_CREATING','SENDCLOUD_CREATING','ENVIA_CREATING') and o.pii_purged_at is null and o.shipping_remote_id is null and o.sendcloud_parcel_id is null and o.label_created_at is null and coalesce(o.order_action_lease_until,'-infinity')<=now() and not exists(select 1 from private.shipping_creation_operations c where c.owner_id=o.owner_id and c.order_id=o.id and c.closed_at is null)
 ) q join public.workspaces w on w.id=q.owner_id and w.status in ('active','trialing')
 join public.fulfillment_orders f on f.owner_id=q.owner_id and f.id=q.order_id and f.pii_purged_at is null and coalesce(f.order_action_lease_until,'-infinity')<=now()
 where (f.tracking_status_code=upper(q.provider)||'_CREATING' or (f.shipping_provider=q.provider and f.shipping_integration_account_id=q.account_id and (f.shipping_remote_id is not null or f.sendcloud_parcel_id is not null)))
 and ((q.account_id is not null and exists(select 1 from public.integration_accounts a where a.id=q.account_id and a.owner_id=q.owner_id and a.provider=q.provider and a.enabled and a.status<>'disabled')) or (q.account_id is null and (select count(*) from public.integration_accounts a where a.owner_id=q.owner_id and a.provider=q.provider and a.enabled and a.status<>'disabled')=1)) order by q.next_check_at,q.order_id limit greatest(1,least(coalesce(p_limit,5),5))
$$;
revoke all on function public.shipping_creation_adopt(uuid,uuid) from public,anon,authenticated;
grant execute on function public.shipping_creation_adopt(uuid,uuid) to service_role;
revoke all on function public.shipping_creation_begin(uuid,uuid,text,uuid,text,jsonb,uuid),public.shipping_creation_note(uuid,uuid,text),public.shipping_creation_reconcile_claim(uuid,uuid),public.shipping_creation_resolve(uuid,uuid,text,jsonb),public.shipping_creation_candidates(integer) from public,anon,authenticated;
grant execute on function public.shipping_creation_begin(uuid,uuid,text,uuid,text,jsonb,uuid),public.shipping_creation_note(uuid,uuid,text),public.shipping_creation_reconcile_claim(uuid,uuid),public.shipping_creation_resolve(uuid,uuid,text,jsonb),public.shipping_creation_candidates(integer) to service_role;

-- Follow the canonical order retention boundary without enabling a purge job.
create or replace function private.shipping_creation_pii_boundary() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.pii_purged_at is not null and old.pii_purged_at is null then
  update private.shipping_creation_operations set reference='PII_PURGED',context='{}'::jsonb,state='rejected',closed_at=coalesce(closed_at,now()),last_result='pii_purged',reconcile_token=null,reconcile_until=null where owner_id=new.owner_id and order_id=new.id;
 end if;return null;
end $$;
revoke all on function private.shipping_creation_pii_boundary() from public,anon,authenticated;
create trigger zz_shipping_creation_pii_boundary after update of pii_purged_at on public.fulfillment_orders for each row execute function private.shipping_creation_pii_boundary();

create index if not exists fulfillment_orders_pending_creation on public.fulfillment_orders(owner_id,id)
where tracking_status_code in ('MRW_CREATING','SENDCLOUD_CREATING','ENVIA_CREATING') and pii_purged_at is null and shipping_remote_id is null and sendcloud_parcel_id is null and label_created_at is null;
