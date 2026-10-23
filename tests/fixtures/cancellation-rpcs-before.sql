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
 return jsonb_build_object('claimed',true,'operation',to_jsonb(op));end $function$;

CREATE OR REPLACE FUNCTION public.integration_finish_cancellation(p_operation_id uuid, p_owner_id uuid, p_status text, p_message text, p_remote_id text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
 end if;end $function$;
