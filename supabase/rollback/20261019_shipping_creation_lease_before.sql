-- Captured production definition/ACL, 2026-10-19, before the un-deployed PR.
-- Do not shorten leases already held: this changes only future acquisitions.
CREATE OR REPLACE FUNCTION public.integration_claim_order_shipping(p_order_id uuid,p_owner_id uuid,p_lease uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
declare item public.fulfillment_orders;begin
 select * into item from fulfillment_orders where id=p_order_id and owner_id=p_owner_id for update;
 if not found or (item.order_action_lease_until>now() or item.shopify_tracking_lease_until>now()) then return false;end if;
 if exists(select 1 from order_cancellation_operations where order_id=p_order_id and owner_id=p_owner_id and (status in('submitting','pending','unknown') or (kind='order' and status='confirmed'))) then raise exception 'El pedido tiene una cancelación pendiente o confirmada.';end if;
 if item.source_status ilike '%cancel%' then raise exception 'El pedido está cancelado.';end if;
 update fulfillment_orders set order_action_lease=p_lease,order_action_lease_until=now()+interval '5 minutes' where id=p_order_id;
 return true;end $function$;
REVOKE ALL ON FUNCTION public.integration_claim_order_shipping(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.integration_claim_order_shipping(uuid,uuid,uuid) TO service_role;
