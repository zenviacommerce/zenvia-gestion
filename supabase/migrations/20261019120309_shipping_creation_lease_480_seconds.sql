-- Canonical definition of the existing production RPC. Eight minutes exceeds
-- the 400-second Edge wall-clock limit for every source channel.
CREATE OR REPLACE FUNCTION public.integration_claim_order_shipping(p_order_id uuid,p_owner_id uuid,p_lease uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER
SET search_path = '' SET statement_timeout = '3s' SET lock_timeout = '500ms'
AS $function$
DECLARE item public.fulfillment_orders%rowtype;
BEGIN
 IF p_order_id IS NULL OR p_owner_id IS NULL OR p_lease IS NULL THEN
  RAISE EXCEPTION 'Invalid shipping lease parameters' USING errcode='22023';
 END IF;
 SELECT * INTO item FROM public.fulfillment_orders
 WHERE id=p_order_id AND owner_id=p_owner_id FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF item.pii_purged_at IS NOT NULL THEN RETURN false; END IF;
 IF item.order_action_lease_until>clock_timestamp() OR item.shopify_tracking_lease_until>clock_timestamp() THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.order_cancellation_operations WHERE order_id=p_order_id AND owner_id=p_owner_id
  AND (status IN('submitting','pending','unknown') OR (kind='order' AND status='confirmed'))) THEN
  RAISE EXCEPTION 'El pedido tiene una cancelación pendiente o confirmada.';
 END IF;
 IF item.source_status ILIKE '%cancel%' THEN RAISE EXCEPTION 'El pedido está cancelado.'; END IF;
 UPDATE public.fulfillment_orders SET order_action_lease=p_lease,order_action_lease_until=clock_timestamp()+interval '480 seconds'
 WHERE id=p_order_id AND owner_id=p_owner_id;
 RETURN true;
END $function$;
REVOKE ALL ON FUNCTION public.integration_claim_order_shipping(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.integration_claim_order_shipping(uuid,uuid,uuid) TO service_role;
