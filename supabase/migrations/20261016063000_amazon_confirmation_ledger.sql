-- Additive, review-only migration. Do not apply before reconciliation and release approval.
create table public.amazon_confirmation_operations (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null unique references public.fulfillment_orders(id),
 owner_id uuid not null,
 amazon_account_id uuid not null references public.amazon_accounts(id),
 integration_account_id uuid not null references public.integration_accounts(id),
 amazon_order_id text not null,
 marketplace_id text not null,
 package_reference_id text,
 revision integer not null default 1,
 payload jsonb,
 payload_hash text,
 original_tracking_number text,
 state text not null check(state in('prepared','pending_verification','confirmed','rejected','needs_review')),
 attempt_id uuid not null default gen_random_uuid(),
 holder uuid,
 fence bigint not null default 1,
 lease_until timestamptz,
 submission_started_at timestamptz,
 dispatch_started_at timestamptz,
 last_request_id text,
 verification_attempts integer not null default 0,
 next_verification_at timestamptz not null default now(),
 last_http_status integer,
 message text,
 history jsonb not null default '[]'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index amazon_confirmation_due_idx on public.amazon_confirmation_operations(next_verification_at) where state='pending_verification';
create index amazon_confirmation_owner_idx on public.amazon_confirmation_operations(owner_id,amazon_account_id);
alter table public.amazon_confirmation_operations enable row level security;
revoke all on public.amazon_confirmation_operations from public,anon,authenticated;
grant all on public.amazon_confirmation_operations to service_role;

create function public.amazon_confirmation_begin(p_order_id uuid,p_owner_id uuid,p_account_id uuid,p_marketplace_id text,p_payload jsonb,p_holder uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp set statement_timeout='3s' set lock_timeout='500ms' as $$
declare item public.fulfillment_orders; acct public.amazon_accounts; integration public.integration_accounts; op public.amazon_confirmation_operations; fresh boolean:=false; legacy boolean; hash text;
begin
 if p_holder is null then raise exception 'Missing holder'; end if;
 select * into item from public.fulfillment_orders where id=p_order_id and owner_id=p_owner_id for update;
 if not found or item.source_channel<>'amazon' then raise exception 'Pedido/tenant no válido'; end if;
 select * into acct from public.amazon_accounts where id=p_account_id and owner_id=p_owner_id;
 if not found then raise exception 'Cuenta/tenant no válido'; end if;
 select * into integration from public.integration_accounts where id=acct.integration_account_id and owner_id=p_owner_id and provider='amazon' and enabled and status<>'disabled';
 if not found or (item.source_integration_account_id is not null and item.source_integration_account_id<>integration.id) then raise exception 'Cuenta/owner de integración no válido'; end if;
 if not exists(select 1 from public.amazon_orders where owner_id=p_owner_id and amazon_account_id=p_account_id and amazon_order_id=item.order_id and marketplace_id=p_marketplace_id and fulfillment_channel='MFN') then raise exception 'Pedido/marketplace FBM no válido'; end if;
 if item.source_integration_account_id is null and (select count(*) from public.amazon_orders where owner_id=p_owner_id and amazon_order_id=item.order_id)<>1 then raise exception 'Cuenta del pedido ambigua'; end if;
 if exists(select 1 from public.order_cancellation_operations where order_id=p_order_id and owner_id=p_owner_id and (status in('submitting','pending','unknown') or (kind='order' and status='confirmed'))) or item.source_status ilike '%cancel%' then raise exception 'Cancelación pendiente o confirmada'; end if;
 if p_payload->>'marketplaceId' is distinct from p_marketplace_id or coalesce(btrim(p_payload#>>'{packageDetail,trackingNumber}'),'')='' or jsonb_typeof(p_payload#>'{packageDetail,orderItems}') is distinct from 'array' then raise exception 'Payload inválido'; end if;
 hash:=encode(sha256(convert_to((p_payload#-'{packageDetail,shipDate}')::text,'UTF8')),'hex');
 select * into op from public.amazon_confirmation_operations where order_id=p_order_id for update;
 if found then
  if op.owner_id<>p_owner_id or op.amazon_account_id<>p_account_id or op.integration_account_id<>integration.id or op.marketplace_id<>p_marketplace_id then raise exception 'Cuenta/tenant del intento no válido'; end if;
  if op.state<>'prepared' and op.payload_hash is not null and op.payload_hash<>hash then raise exception '409: payload distinto con confirmación pendiente o confirmada'; end if;
  if op.state in('confirmed','rejected','needs_review') then return to_jsonb(op)||jsonb_build_object('send',false,'verify',false); end if;
  if op.lease_until>clock_timestamp() or (op.state='pending_verification' and op.next_verification_at>clock_timestamp()) then return to_jsonb(op)||jsonb_build_object('send',false,'verify',false); end if;
  if op.payload is null then
   update public.amazon_confirmation_operations set payload=p_payload,payload_hash=hash,package_reference_id=p_payload#>>'{packageDetail,packageReferenceId}',original_tracking_number=item.tracking_number where id=op.id returning * into op;
  end if;
  fresh:=op.state='prepared';
 else
  legacy:=coalesce(item.amazon_tracking_sync_attempts,0)>0 or item.amazon_tracking_synced_at is not null;
  fresh:=not legacy;
  if fresh and (item.order_action_lease_until>now() or item.shopify_tracking_lease_until>now()) then raise exception 'Operación de envío en curso'; end if;
  insert into public.amazon_confirmation_operations(order_id,owner_id,amazon_account_id,integration_account_id,amazon_order_id,marketplace_id,package_reference_id,payload,payload_hash,original_tracking_number,state)
  values(p_order_id,p_owner_id,p_account_id,integration.id,item.order_id,p_marketplace_id,p_payload#>>'{packageDetail,packageReferenceId}',p_payload,hash,item.tracking_number,case when item.amazon_tracking_synced_at is not null then 'confirmed' else 'pending_verification' end) returning * into op;
  if op.state='confirmed' then return to_jsonb(op)||jsonb_build_object('send',false,'verify',false); end if;
 end if;
 if fresh and coalesce(p_payload#>>'{packageDetail,packageReferenceId}','')!~'^[1-9][0-9]*$' then raise exception 'Package reference requerido para enviar'; end if;
 update public.amazon_confirmation_operations set holder=p_holder,fence=fence+1,lease_until=clock_timestamp()+interval '60 seconds',state='pending_verification',payload=case when fresh then p_payload else payload end,payload_hash=case when fresh then hash else payload_hash end,package_reference_id=case when fresh then p_payload#>>'{packageDetail,packageReferenceId}' else package_reference_id end,submission_started_at=case when fresh then clock_timestamp() else submission_started_at end,updated_at=clock_timestamp() where id=op.id returning * into op;
 if fresh then
  update public.fulfillment_orders set amazon_tracking_synced_at=null,amazon_tracking_sync_error='Verificando confirmación en Amazon',amazon_tracking_sync_attempts=coalesce(amazon_tracking_sync_attempts,0)+1,amazon_tracking_last_attempt_at=clock_timestamp() where id=p_order_id and owner_id=p_owner_id;
 end if;
 return to_jsonb(op)||jsonb_build_object('send',fresh,'verify',not fresh);
end $$;

create function public.amazon_confirmation_finish(p_order_id uuid,p_owner_id uuid,p_holder uuid,p_fence bigint,p_state text,p_message text,p_http_status integer,p_request_id text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp set statement_timeout='3s' set lock_timeout='500ms' as $$
declare item public.fulfillment_orders;op public.amazon_confirmation_operations; next_state text; tries integer;
begin
 select * into item from public.fulfillment_orders where id=p_order_id and owner_id=p_owner_id for update;
 if not found then raise exception 'Pedido/tenant no válido'; end if;
 select * into op from public.amazon_confirmation_operations where order_id=p_order_id and owner_id=p_owner_id for update;
 if not found or op.holder is distinct from p_holder or op.fence<>p_fence or op.lease_until<=clock_timestamp() or op.state<>'pending_verification' then raise exception 'Stale holder/fence/lease'; end if;
 if p_state not in('confirmed','pending_verification','rejected','needs_review') then raise exception 'Estado inválido'; end if;
 tries:=op.verification_attempts+case when p_state='pending_verification' then 1 else 0 end;
 next_state:=case when p_state='pending_verification' and tries>=5 then 'needs_review' else p_state end;
 if next_state='confirmed' then
  if item.tracking_number is distinct from op.original_tracking_number and item.tracking_number is distinct from op.payload#>>'{packageDetail,trackingNumber}' then raise exception 'El tracking local ha cambiado; requiere revisión'; end if;
  update public.fulfillment_orders set tracking_number=op.payload#>>'{packageDetail,trackingNumber}',amazon_tracking_synced_at=clock_timestamp(),amazon_tracking_last_attempt_at=clock_timestamp(),amazon_tracking_sync_error=null,source_status='shipped',fulfilled_at=coalesce(fulfilled_at,clock_timestamp()) where id=p_order_id and owner_id=p_owner_id;
 else
  update public.fulfillment_orders set amazon_tracking_sync_error=case when next_state='rejected' then 'Confirmación rechazada; requiere revisión' when next_state='needs_review' then 'Confirmación requiere revisión' else 'Verificando confirmación en Amazon' end where id=p_order_id and owner_id=p_owner_id and amazon_tracking_synced_at is null;
 end if;
 update public.amazon_confirmation_operations set state=next_state,verification_attempts=tries,next_verification_at=clock_timestamp()+make_interval(secs=>least(3600,30*power(2,least(tries,6)))::integer),message=left(p_message,800),last_http_status=p_http_status,last_request_id=coalesce(p_request_id,last_request_id),holder=null,lease_until=null,updated_at=clock_timestamp() where id=op.id returning * into op;
 return to_jsonb(op);
end $$;

-- Explicit operator authorization is the only way to arm another attempt/revision.
create function public.amazon_confirmation_authorize(p_order_id uuid,p_owner_id uuid,p_actor uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp set statement_timeout='3s' set lock_timeout='500ms' as $$
declare item public.fulfillment_orders;op public.amazon_confirmation_operations;
begin
 if p_actor is null or length(btrim(p_reason))<20 then raise exception 'Debes documentar la revisión y su evidencia'; end if;
 select * into item from public.fulfillment_orders where id=p_order_id and owner_id=p_owner_id for update;
 if not found then raise exception 'Pedido/tenant no válido';end if;
 select * into op from public.amazon_confirmation_operations where order_id=p_order_id and owner_id=p_owner_id for update;
 if not found or op.state not in('rejected','needs_review','confirmed') or op.lease_until>clock_timestamp() then raise exception '409: primero reconcilia la confirmación pendiente'; end if;
 update public.amazon_confirmation_operations set history=history||jsonb_build_array(to_jsonb(op)||jsonb_build_object('reviewed_by',p_actor,'review_reason',left(p_reason,800))),revision=revision+1,state='prepared',attempt_id=gen_random_uuid(),payload=null,payload_hash=null,holder=null,lease_until=null,verification_attempts=0,submission_started_at=null,dispatch_started_at=null,original_tracking_number=item.tracking_number,updated_at=clock_timestamp() where id=op.id returning * into op;
 return to_jsonb(op);
end $$;

revoke all on function public.amazon_confirmation_begin(uuid,uuid,uuid,text,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.amazon_confirmation_finish(uuid,uuid,uuid,bigint,text,text,integer,text) from public,anon,authenticated;
revoke all on function public.amazon_confirmation_authorize(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.amazon_confirmation_begin(uuid,uuid,uuid,text,jsonb,uuid) to service_role;
grant execute on function public.amazon_confirmation_finish(uuid,uuid,uuid,bigint,text,text,integer,text) to service_role;
grant execute on function public.amazon_confirmation_authorize(uuid,uuid,uuid,text) to service_role;

-- Seed only unambiguous legacy attempts. Unresolved account context cannot submit through begin either.
insert into public.amazon_confirmation_operations(order_id,owner_id,amazon_account_id,integration_account_id,amazon_order_id,marketplace_id,original_tracking_number,state)
select f.id,f.owner_id,a.id,i.id,f.order_id,o.marketplace_id,f.tracking_number,'pending_verification'
from public.fulfillment_orders f
join public.integration_accounts i on i.id=f.source_integration_account_id and i.owner_id=f.owner_id and i.provider='amazon'
join public.amazon_accounts a on a.integration_account_id=i.id and a.owner_id=f.owner_id
join public.amazon_orders o on o.amazon_account_id=a.id and o.owner_id=f.owner_id and o.amazon_order_id=f.order_id and o.fulfillment_channel='MFN'
where f.source_channel='amazon' and f.amazon_tracking_synced_at is null and coalesce(f.amazon_tracking_sync_attempts,0)>0
and (select count(*) from public.amazon_orders x where x.owner_id=f.owner_id and x.amazon_account_id=a.id and x.amazon_order_id=f.order_id)=1
on conflict(order_id) do nothing;
CREATE OR REPLACE FUNCTION public.integration_claim_order_shipping(p_order_id uuid, p_owner_id uuid, p_lease uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare item public.fulfillment_orders;begin
 select * into item from fulfillment_orders where id=p_order_id and owner_id=p_owner_id for update;
 if not found or (item.order_action_lease_until>now() or item.shopify_tracking_lease_until>now()) then return false;end if;

 if exists(select 1 from public.amazon_confirmation_operations where order_id=p_order_id and owner_id=p_owner_id and state in('prepared','pending_verification','needs_review')) or (item.source_channel='amazon' and item.amazon_tracking_synced_at is null and coalesce(item.amazon_tracking_sync_attempts,0)>0 and not exists(select 1 from public.amazon_confirmation_operations where order_id=p_order_id)) then raise exception 'La confirmación Amazon requiere verificación antes de otra operación.';end if;
 if exists(select 1 from order_cancellation_operations where order_id=p_order_id and owner_id=p_owner_id and (status in('submitting','pending','unknown') or (kind='order' and status='confirmed'))) then raise exception 'El pedido tiene una cancelación pendiente o confirmada.';end if;
 if item.source_status ilike '%cancel%' then raise exception 'El pedido está cancelado.';end if;
 update fulfillment_orders set order_action_lease=p_lease,order_action_lease_until=now()+interval '5 minutes' where id=p_order_id;
 return true;end $function$
;

CREATE OR REPLACE FUNCTION public.integration_start_cancellation(p_order_id uuid, p_owner_id uuid, p_kind text, p_provider text, p_reference text, p_user_id uuid, p_details jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare item public.fulfillment_orders; op public.order_cancellation_operations;begin
 select * into item from fulfillment_orders where id=p_order_id and owner_id=p_owner_id for update;
 if not found then raise exception 'Pedido no encontrado.';end if;

 if exists(select 1 from public.amazon_confirmation_operations where order_id=p_order_id and owner_id=p_owner_id and state in('prepared','pending_verification','needs_review')) or (item.source_channel='amazon' and item.amazon_tracking_synced_at is null and coalesce(item.amazon_tracking_sync_attempts,0)>0 and not exists(select 1 from public.amazon_confirmation_operations where order_id=p_order_id)) then raise exception 'La confirmación Amazon requiere verificación antes de otra operación.';end if;
 if item.order_action_lease_until>now() or item.shopify_tracking_lease_until>now() then raise exception 'Hay una operación de envío en curso. Espera antes de cancelar.';end if;
 if p_kind='label' and coalesce(item.shipping_remote_id,item.sendcloud_parcel_id::text,item.tracking_number,'') is distinct from p_details->>'shipmentRef' then raise exception 'La etiqueta del pedido ha cambiado. Actualiza antes de cancelar.';end if;
 select * into op from order_cancellation_operations where order_id=p_order_id and kind=p_kind and reference=p_reference;
 if found then
  if op.status='rejected' then
   update order_cancellation_operations set status='submitting',message=null,remote_id=null,details=p_details||jsonb_build_object('attempts',coalesce(op.details->'attempts','[]'::jsonb)||jsonb_build_array(jsonb_build_object('requested_at',op.created_at,'requested_by',op.requested_by,'status',op.status,'message',op.message,'options',op.details-'attempts'))),requested_by=p_user_id,created_at=now(),updated_at=now() where id=op.id returning * into op;
   return jsonb_build_object('claimed',true,'operation',to_jsonb(op));
  end if;
  return jsonb_build_object('claimed',false,'operation',to_jsonb(op));
 end if;
 insert into order_cancellation_operations(owner_id,order_id,kind,provider,reference,requested_by,details)
 values(p_owner_id,p_order_id,p_kind,p_provider,p_reference,p_user_id,p_details) returning * into op;
 return jsonb_build_object('claimed',true,'operation',to_jsonb(op));end $function$
;


-- Consume the one allowed send only if the original fence still owns the live lease.
create function public.amazon_confirmation_dispatch(p_order_id uuid,p_owner_id uuid,p_holder uuid,p_fence bigint)
returns boolean language plpgsql security definer set search_path=public,pg_temp set statement_timeout='3s' set lock_timeout='500ms' as $$
begin
 perform 1 from public.fulfillment_orders where id=p_order_id and owner_id=p_owner_id for update;
 if not found then return false;end if;
 update public.amazon_confirmation_operations set dispatch_started_at=clock_timestamp() where order_id=p_order_id and owner_id=p_owner_id and holder=p_holder and fence=p_fence and lease_until>clock_timestamp() and state='pending_verification' and submission_started_at is not null and dispatch_started_at is null;
 return found;
end $$;
revoke all on function public.amazon_confirmation_dispatch(uuid,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.amazon_confirmation_dispatch(uuid,uuid,uuid,bigint) to service_role;

create function public.amazon_confirmation_due(p_owner_id uuid,p_limit integer default 5,p_include_fresh boolean default false)
returns setof public.fulfillment_orders language sql security definer set search_path=public,pg_temp set statement_timeout='3s' as $$
 select f.* from public.fulfillment_orders f
 left join public.amazon_confirmation_operations op on op.order_id=f.id and op.owner_id=f.owner_id
 where f.owner_id=p_owner_id and f.source_channel='amazon' and f.tracking_number is not null
 and (
  (op.state='pending_verification' and op.next_verification_at<=clock_timestamp() and (op.lease_until is null or op.lease_until<=clock_timestamp()))
  or op.state='prepared'
  or (op.id is null and f.amazon_tracking_synced_at is null and (coalesce(f.amazon_tracking_sync_attempts,0)>0 or p_include_fresh))
 )
 order by case when op.id is not null then 0 else 1 end,coalesce(op.next_verification_at,f.amazon_tracking_last_attempt_at,'epoch'::timestamptz)
 limit greatest(1,least(coalesce(p_limit,5),25))
$$;
revoke all on function public.amazon_confirmation_due(uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.amazon_confirmation_due(uuid,integer,boolean) to service_role;
