-- Operational repair, NOT an automatic migration. Run only after the read-only
-- same-owner Sendcloud API probe confirms this exact parcel and the preview
-- count is shown. Expected affected fulfillment_orders rows: exactly one.
-- Change its incorrect shipping account plus the existing updated_at audit trigger.
-- No state/status/label/PII changes.
BEGIN;
SET LOCAL lock_timeout='25ms';
DO $repair$
DECLARE shipment public.fulfillment_orders;correct_account uuid;before_row jsonb;after_row jsonb;n integer;
BEGIN
 SELECT * INTO STRICT shipment FROM public.fulfillment_orders
 WHERE order_number='407-0024766-5208363' AND tracking_number='01009F045746'
 AND shipping_provider='sendcloud' AND pii_purged_at IS NULL AND label_cancelled_at IS NULL
 FOR UPDATE;
 PERFORM 1 FROM public.integration_accounts a
 WHERE a.id=shipment.shipping_integration_account_id AND a.owner_id=shipment.owner_id AND a.provider='envia'
 FOR SHARE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM public.shipment_tracking_state s WHERE s.order_id=shipment.id)
  THEN RAISE EXCEPTION 'SENDCLOUD_REPAIR_PRECONDITION_CHANGED';END IF;
 SELECT id INTO STRICT correct_account FROM public.integration_accounts
 WHERE owner_id=shipment.owner_id AND provider='sendcloud' AND enabled AND status<>'disabled' FOR SHARE;
 before_row:=to_jsonb(shipment);
 UPDATE public.fulfillment_orders SET shipping_integration_account_id=correct_account
 WHERE id=shipment.id AND shipping_integration_account_id=shipment.shipping_integration_account_id;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'SENDCLOUD_REPAIR_ROW_COUNT_CHANGED';END IF;
 SELECT to_jsonb(o) INTO after_row FROM public.fulfillment_orders o WHERE o.id=shipment.id;
 IF before_row-ARRAY['shipping_integration_account_id','updated_at'] IS DISTINCT FROM after_row-ARRAY['shipping_integration_account_id','updated_at']
 THEN RAISE EXCEPTION 'SENDCLOUD_REPAIR_UNRELATED_FIELD_CHANGED';END IF;
END $repair$;
SELECT 1 AS repaired_account_associations;
COMMIT;
