CREATE OR REPLACE FUNCTION public.integration_shopify_claim_shipment(p_order_id uuid, p_owner_id uuid, p_lease uuid)
 RETURNS SETOF fulfillment_orders
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare item public.fulfillment_orders;begin
 select * into item from fulfillment_orders where id=p_order_id and owner_id=p_owner_id for update;
 if not found or item.order_action_lease_until>now() or item.shopify_tracking_lease_until>now() then return;end if;
 if exists(select 1 from order_cancellation_operations where order_id=p_order_id and owner_id=p_owner_id and (status in('submitting','pending','unknown') or (kind='order' and status='confirmed'))) then raise exception 'El pedido tiene una cancelación pendiente o confirmada.';end if;
 if item.source_status ilike '%cancel%' then raise exception 'El pedido está cancelado.';end if;
 return query update fulfillment_orders set shopify_tracking_lease=p_lease,shopify_tracking_lease_until=now()+interval '5 minutes',shopify_tracking_last_attempt_at=now()
 where id=p_order_id and owner_id=p_owner_id and source_channel='shopify' and label_created_at is not null and nullif(tracking_number,'') is not null returning *;
end $function$
;
CREATE OR REPLACE FUNCTION public.integration_shopify_pending_shipments(p_owner_id uuid)
 RETURNS SETOF fulfillment_orders
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
 select * from public.fulfillment_orders where owner_id=p_owner_id and source_channel='shopify'
 and label_created_at is not null and nullif(tracking_number,'') is not null
 and (shopify_tracking_synced_at is null or shopify_tracking_synced_number is distinct from tracking_number)
 and (shopify_tracking_last_attempt_at is null or shopify_tracking_last_attempt_at<now()-interval '5 minutes')
 order by shopify_tracking_last_attempt_at asc nulls first limit 5;
$function$
;
-- Match the production ACLs captured on 22/10; these are internal service RPCs.
REVOKE ALL ON FUNCTION public.integration_shopify_claim_shipment(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.integration_shopify_pending_shipments(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.integration_shopify_claim_shipment(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.integration_shopify_pending_shipments(uuid) TO service_role;
