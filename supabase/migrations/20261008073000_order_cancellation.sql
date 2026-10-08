alter table public.fulfillment_orders add column if not exists label_cancelled_at timestamptz,
 add column if not exists order_action_lease uuid,add column if not exists order_action_lease_until timestamptz;
create table if not exists public.order_cancellation_operations(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.workspaces(id),
 order_id uuid not null references public.fulfillment_orders(id),kind text not null check(kind in('label','order')),
 provider text not null,reference text not null,status text not null default 'submitting' check(status in('submitting','pending','confirmed','rejected','unknown')),
 remote_id text,message text,details jsonb not null default '{}',requested_by uuid not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(order_id,kind,reference)
);
alter table public.order_cancellation_operations enable row level security;
revoke all on public.order_cancellation_operations from anon,authenticated;
grant select on public.order_cancellation_operations to authenticated;
grant all on public.order_cancellation_operations to service_role;
create policy order_cancellations_read on public.order_cancellation_operations for select to authenticated using(exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.data_owner_id=order_cancellation_operations.owner_id and u.active and (u.role='admin' or 'orders'=any(u.permissions))));

create or replace function public.integration_claim_order_shipping(p_order_id uuid,p_owner_id uuid,p_lease uuid)
returns boolean language plpgsql security invoker set search_path=public as $$
declare item public.fulfillment_orders;begin
 select * into item from fulfillment_orders where id=p_order_id and owner_id=p_owner_id for update;
 if not found or (item.order_action_lease_until>now() or item.shopify_tracking_lease_until>now()) then return false;end if;
 if exists(select 1 from order_cancellation_operations where order_id=p_order_id and owner_id=p_owner_id and (status in('submitting','pending','unknown') or (kind='order' and status='confirmed'))) then raise exception 'El pedido tiene una cancelación pendiente o confirmada.';end if;
 if item.source_status ilike '%cancel%' then raise exception 'El pedido está cancelado.';end if;
 update fulfillment_orders set order_action_lease=p_lease,order_action_lease_until=now()+interval '5 minutes' where id=p_order_id;
 return true;end $$;

create or replace function public.integration_start_cancellation(p_order_id uuid,p_owner_id uuid,p_kind text,p_provider text,p_reference text,p_user_id uuid,p_details jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare item public.fulfillment_orders; op public.order_cancellation_operations;begin
 select * into item from fulfillment_orders where id=p_order_id and owner_id=p_owner_id for update;
 if not found then raise exception 'Pedido no encontrado.';end if;
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
 return jsonb_build_object('claimed',true,'operation',to_jsonb(op));end $$;

create or replace function public.integration_finish_cancellation(p_operation_id uuid,p_owner_id uuid,p_status text,p_message text,p_remote_id text default null)
returns void language plpgsql security invoker set search_path=public as $$
declare op public.order_cancellation_operations; item public.fulfillment_orders;begin
 select * into op from order_cancellation_operations where id=p_operation_id and owner_id=p_owner_id;
 if not found then raise exception 'Operación no encontrada.';end if;

 select * into item from fulfillment_orders where id=op.order_id and owner_id=p_owner_id for update;
 select * into op from order_cancellation_operations where id=p_operation_id and owner_id=p_owner_id for update;
 if op.status='confirmed' then return;end if;
 update order_cancellation_operations set status=p_status,message=p_message,remote_id=coalesce(p_remote_id,remote_id),updated_at=now() where id=p_operation_id;
 if p_status='confirmed' and op.kind='order' then update fulfillment_orders set source_status='cancelled' where id=op.order_id and owner_id=p_owner_id;
 elsif p_status='confirmed' and op.kind='label' and coalesce(item.shipping_remote_id,item.sendcloud_parcel_id::text,item.tracking_number,'')=op.details->>'shipmentRef' then
 update fulfillment_orders set label_cancelled_at=now(),shipping_remote_id=null,shipping_label_url=null,sendcloud_parcel_id=null,sendcloud_shipment_id=null,label_created_at=null,label_printed_at=null,label_print_count=0,
 tracking_number=null,tracking_url=null,tracking_status_code=null,tracking_status_message=null,tracking_updated_at=null,fulfilled_at=null,
 amazon_tracking_synced_at=null,amazon_tracking_sync_error=null,amazon_tracking_last_attempt_at=null,shopify_tracking_synced_at=null,shopify_tracking_synced_number=null,shopify_tracking_sync_error=null,
 shipping_cost_amount=null,shipping_cost_net_amount=null,shipping_cost_tax_amount=null,shipping_cost_recorded_at=null where id=op.order_id and owner_id=p_owner_id;
 end if;end $$;
revoke all on function public.integration_claim_order_shipping(uuid,uuid,uuid),public.integration_start_cancellation(uuid,uuid,text,text,text,uuid,jsonb),public.integration_finish_cancellation(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.integration_claim_order_shipping(uuid,uuid,uuid),public.integration_start_cancellation(uuid,uuid,text,text,text,uuid,jsonb),public.integration_finish_cancellation(uuid,uuid,text,text,text) to service_role;

create or replace function public.integration_shopify_claim_shipment(p_order_id uuid,p_owner_id uuid,p_lease uuid)
returns setof public.fulfillment_orders language plpgsql security invoker set search_path=public as $$
declare item public.fulfillment_orders;begin
 select * into item from fulfillment_orders where id=p_order_id and owner_id=p_owner_id for update;
 if not found or item.order_action_lease_until>now() or item.shopify_tracking_lease_until>now() then return;end if;
 if exists(select 1 from order_cancellation_operations where order_id=p_order_id and owner_id=p_owner_id and (status in('submitting','pending','unknown') or (kind='order' and status='confirmed'))) then raise exception 'El pedido tiene una cancelación pendiente o confirmada.';end if;
 if item.source_status ilike '%cancel%' then raise exception 'El pedido está cancelado.';end if;
 return query update fulfillment_orders set shopify_tracking_lease=p_lease,shopify_tracking_lease_until=now()+interval '5 minutes',shopify_tracking_last_attempt_at=now()
 where id=p_order_id and owner_id=p_owner_id and source_channel='shopify' and label_created_at is not null and nullif(tracking_number,'') is not null returning *;
end $$;

-- Importers must not reinstate a cancelled order or an old carrier label.
create or replace function public.integration_preserve_cancellations()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from order_cancellation_operations where owner_id=new.owner_id and order_id=new.id and kind='order' and status='confirmed') then new.source_status='cancelled';end if;
 if exists(select 1 from order_cancellation_operations where owner_id=new.owner_id and order_id=new.id and kind='label' and status='confirmed' and details->>'shipmentRef'=coalesce(new.shipping_remote_id,new.sendcloud_parcel_id::text,new.tracking_number,'')) then
  new.label_cancelled_at=coalesce(new.label_cancelled_at,now());new.shipping_remote_id=null;new.sendcloud_parcel_id=null;new.sendcloud_shipment_id=null;new.shipping_label_url=null;new.label_created_at=null;new.label_printed_at=null;new.label_print_count=0;
  new.tracking_number=null;new.tracking_url=null;new.tracking_status_code=null;new.tracking_status_message=null;new.tracking_updated_at=null;new.fulfilled_at=null;
  new.shipping_cost_amount=null;new.shipping_cost_net_amount=null;new.shipping_cost_tax_amount=null;new.shipping_cost_recorded_at=null;
 end if;
 return new;
end $$;
revoke all on function public.integration_preserve_cancellations() from public,anon,authenticated;
create trigger fulfillment_preserve_cancellations before update on public.fulfillment_orders for each row execute function public.integration_preserve_cancellations();
