-- Service-only RPCs keep their existing signatures, OIDs and ACLs.
-- No backfill or invocation of cancellation operations.
create function private.cancellation_matches_generation(item public.fulfillment_orders,op public.order_cancellation_operations)
returns boolean language sql immutable set search_path='' as $$
 select op.provider is not distinct from coalesce(item.shipping_provider,'sendcloud')
  and (op.details->>'shipmentRef') is not distinct from coalesce(nullif(item.shipping_remote_id,''),item.sendcloud_parcel_id::text,item.tracking_number,'')
  and (op.details->>'shippingAccountId') is not distinct from item.shipping_integration_account_id::text
  and (op.details->>'trackingNumber') is not distinct from item.tracking_number
  and (op.details ? 'labelCreatedAt') and (op.details->>'labelCreatedAt')::timestamptz is not distinct from item.label_created_at
$$;
revoke all on function private.cancellation_matches_generation(public.fulfillment_orders,public.order_cancellation_operations) from public,anon,authenticated;
grant execute on function private.cancellation_matches_generation(public.fulfillment_orders,public.order_cancellation_operations) to service_role;
create or replace function public.integration_start_cancellation(p_order_id uuid,p_owner_id uuid,p_kind text,p_provider text,p_reference text,p_user_id uuid,p_details jsonb)
returns jsonb language plpgsql set search_path='public' as $$
declare item public.fulfillment_orders;op public.order_cancellation_operations;
begin
 select * into item from fulfillment_orders where id=p_order_id and owner_id=p_owner_id for update;
 if not found then raise exception 'Pedido no encontrado.';end if;
 if item.pii_purged_at is not null then raise exception 'Los datos personales del pedido se han eliminado.';end if;
 if item.order_action_lease_until>now() or item.shopify_tracking_lease_until>now() then raise exception 'Hay una operación de envío en curso. Espera antes de cancelar.';end if;
 if p_kind not in('label','order') then raise exception 'Tipo de cancelación no válido.';end if;
 if p_kind='label' then
  if item.external_shipment is not null then raise exception 'El envío externo se mantiene protegido. Gestiona la anulación con su agencia.';end if;
  if nullif(coalesce(nullif(item.shipping_remote_id,''),item.sendcloud_parcel_id::text,item.tracking_number,''),'') is null then raise exception 'No existe una etiqueta activa.';end if;
  if p_provider is distinct from coalesce(item.shipping_provider,'sendcloud')
   or (p_details->>'shipmentRef') is distinct from coalesce(nullif(item.shipping_remote_id,''),item.sendcloud_parcel_id::text,item.tracking_number,'')
   or (p_details->>'shippingAccountId') is distinct from item.shipping_integration_account_id::text
   or (p_details->>'trackingNumber') is distinct from item.tracking_number
   or not(p_details ? 'labelCreatedAt')
   or (p_details->>'labelCreatedAt')::timestamptz is distinct from item.label_created_at
  then raise exception 'La identidad de la etiqueta ha cambiado. Actualiza antes de cancelar.';end if;
 end if;
 select * into op from order_cancellation_operations where order_id=p_order_id and owner_id=p_owner_id and kind=p_kind and reference=p_reference;
 if found and op.status<>'rejected' then return jsonb_build_object('claimed',false,'operation',to_jsonb(op));end if;
 if exists(select 1 from order_cancellation_operations c where c.order_id=p_order_id and c.owner_id=p_owner_id and c.status in('submitting','pending','unknown') and (op.id is null or c.id<>op.id)) then raise exception 'Existe otra cancelación pendiente. Comprueba su resultado.';end if;
 if op.id is not null then
  update order_cancellation_operations set status='submitting',message=null,remote_id=null,
   details=p_details||jsonb_build_object('attempts',coalesce(op.details->'attempts','[]'::jsonb)||jsonb_build_array(jsonb_build_object('requested_at',op.created_at,'requested_by',op.requested_by,'status',op.status,'options',op.details-'attempts'))),requested_by=p_user_id,created_at=now(),updated_at=now()
   where id=op.id returning * into op;
 else
  insert into order_cancellation_operations(owner_id,order_id,kind,provider,reference,requested_by,details)
  values(p_owner_id,p_order_id,p_kind,p_provider,p_reference,p_user_id,p_details) returning * into op;
 end if;
 return jsonb_build_object('claimed',true,'operation',to_jsonb(op));
end $$;
create or replace function public.integration_finish_cancellation(p_operation_id uuid,p_owner_id uuid,p_status text,p_message text,p_remote_id text default null)
returns void language plpgsql set search_path='public' as $$
declare op public.order_cancellation_operations;item public.fulfillment_orders;matches boolean;
begin
 select * into op from order_cancellation_operations where id=p_operation_id and owner_id=p_owner_id;
 if not found then raise exception 'Operación no encontrada.';end if;
 select * into item from fulfillment_orders where id=op.order_id and owner_id=p_owner_id for update;
 select * into op from order_cancellation_operations where id=p_operation_id and owner_id=p_owner_id for update;
 if op.status='confirmed' then return;end if;
 if p_status not in('pending','unknown','confirmed','rejected') then raise exception 'Resultado de cancelación no válido.';end if;
 if p_status='confirmed' and op.kind='label' and not(op.details ? 'labelCreatedAt') then
  p_status:='unknown';p_message:='La operación antigua requiere comprobar la identidad de la etiqueta con la agencia.';
 end if;
 update order_cancellation_operations set status=p_status,message=p_message,remote_id=coalesce(p_remote_id,remote_id),updated_at=now() where id=p_operation_id and owner_id=p_owner_id;
 if item.pii_purged_at is not null then return;end if;
 if p_status='confirmed' and op.kind='order' then
  update fulfillment_orders set source_status='cancelled' where id=op.order_id and owner_id=p_owner_id;
 elsif p_status='confirmed' and op.kind='label' then
  matches:=private.cancellation_matches_generation(item,op);
  if matches and item.external_shipment is null then
   update fulfillment_orders set label_cancelled_at=now(),shipping_remote_id=null,shipping_label_url=null,sendcloud_parcel_id=null,sendcloud_shipment_id=null,label_created_at=null,label_printed_at=null,label_print_count=0,
    tracking_number=null,tracking_url=null,tracking_status_code=null,tracking_status_message=null,tracking_updated_at=null,fulfilled_at=null,
    amazon_tracking_synced_at=null,amazon_tracking_sync_error=null,amazon_tracking_last_attempt_at=null,shopify_tracking_synced_at=null,shopify_tracking_synced_number=null,shopify_tracking_sync_error=null,
    shipping_cost_amount=null,shipping_cost_net_amount=null,shipping_cost_tax_amount=null,shipping_cost_recorded_at=null
    where id=op.order_id and owner_id=p_owner_id;
  end if;
 end if;
end $$;

-- Preserve cancelled imports by their generation, never by a reused number alone.
create or replace function public.integration_preserve_cancellations() returns trigger
language plpgsql security definer set search_path='' as $$
declare restore_values jsonb;
begin
 if new.pii_purged_at is not null then return new;end if;
 if exists(select 1 from public.order_cancellation_operations where owner_id=new.owner_id and order_id=new.id and kind='order' and status='confirmed') then new.source_status:='cancelled';end if;
 if exists(select 1 from public.order_cancellation_operations c where c.owner_id=new.owner_id and c.order_id=new.id and c.kind='label' and c.status='confirmed'
  and c.provider is not distinct from coalesce(new.shipping_provider,'sendcloud')
  and (c.details->>'shippingAccountId') is not distinct from new.shipping_integration_account_id::text
  and (new.label_created_at is null or (c.details ? 'labelCreatedAt') and (c.details->>'labelCreatedAt')::timestamptz is not distinct from new.label_created_at)
  and ((c.details->>'shipmentRef')=coalesce(nullif(new.shipping_remote_id,''),new.sendcloud_parcel_id::text,new.tracking_number,'') or nullif(c.details->>'trackingNumber','')=new.tracking_number)
 ) then
  if old.label_created_at is not null and not exists(select 1 from public.order_cancellation_operations c where c.owner_id=old.owner_id and c.order_id=old.id and c.kind='label' and c.status='confirmed' and private.cancellation_matches_generation(old,c)) then
   select jsonb_object_agg(k,to_jsonb(old)->k) into restore_values from unnest(array[
    'shipping_provider','shipping_integration_account_id','shipping_remote_id','sendcloud_parcel_id','sendcloud_shipment_id','shipping_label_url','label_created_at','label_cancelled_at','label_printed_at','label_print_count',
    'tracking_number','tracking_url','tracking_status_code','tracking_status_message','tracking_updated_at','fulfilled_at','carrier_code','carrier_name','shipping_service_name','shipping_option_code','contract_id',
    'shipping_cost_amount','shipping_cost_currency','shipping_cost_source','shipping_cost_net_amount','shipping_cost_tax_amount','shipping_cost_recorded_at'
   ]) as k;
   new:=jsonb_populate_record(new,restore_values);return new;
  end if;
  new.label_cancelled_at:=coalesce(new.label_cancelled_at,now());new.shipping_remote_id:=null;new.sendcloud_parcel_id:=null;new.sendcloud_shipment_id:=null;new.shipping_label_url:=null;new.label_created_at:=null;new.label_printed_at:=null;new.label_print_count:=0;
  new.tracking_number:=null;new.tracking_url:=null;new.tracking_status_code:=null;new.tracking_status_message:=null;new.tracking_updated_at:=null;new.fulfilled_at:=null;
  new.shipping_cost_amount:=null;new.shipping_cost_net_amount:=null;new.shipping_cost_tax_amount:=null;new.shipping_cost_recorded_at:=null;
 end if;
 return new;
end $$;
