-- Restore only this implementation. Retain the already-approved two-RPC mitigation.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
CREATE OR REPLACE FUNCTION private.mfa_impl_order_logistics_read(p_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid:=private.pickup_report_owner();begin
 if p_ids is null or cardinality(p_ids)>10000 then raise exception 'LOGISTICS_INVALID_SELECTION';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'logistics_identity',private.shipment_tracking_identity(o),
 'logistics',private.order_logistics_evidence(to_jsonb(o)),'logistics_state',private.order_logistics_state(to_jsonb(o))))
 from public.fulfillment_orders o where o.owner_id=v_owner and o.id=any(p_ids)),'[]'::jsonb);
end$function$
;

COMMIT;

