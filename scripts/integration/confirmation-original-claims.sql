CREATE OR REPLACE FUNCTION public.integration_claim_order_shipping(p_order_id uuid, p_owner_id uuid, p_lease uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare item public.fulfillment_orders;begin
 select * into item from fulfillment_orders where id=p_order_id and owner_id=p_owner_id for update;
 if not found or (item.order_action_lease_until>now() or item.shopify_tracking_lease_until>now()) then return false;end if;
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
revoke all on function integration_claim_order_shipping(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function integration_start_cancellation(uuid,uuid,text,text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function integration_claim_order_shipping(uuid,uuid,uuid) to service_role;
grant execute on function integration_start_cancellation(uuid,uuid,text,text,text,uuid,jsonb) to service_role;
