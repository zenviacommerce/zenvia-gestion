-- Pending owner approval. One private implementation; no business rows or settings modified.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
DO $guard$
BEGIN
 IF md5(pg_get_functiondef('private.mfa_impl_order_logistics_read(uuid[])'::regprocedure)) <> 'cee0a2fd0383f31d83f715788b7c7156'
 THEN RAISE EXCEPTION 'LOGISTICS_READ_CHANGED_CONCURRENTLY'; END IF;
END $guard$;
CREATE OR REPLACE FUNCTION private.mfa_impl_order_logistics_read(p_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_owner uuid:=private.pickup_report_owner();
BEGIN
 IF p_ids IS NULL OR cardinality(p_ids)>10000 THEN RAISE EXCEPTION 'LOGISTICS_INVALID_SELECTION';END IF;
 RETURN (
 WITH requested AS MATERIALIZED (
  SELECT o.id,o.owner_id,o.source_status,o.label_cancelled_at,o.pii_purged_at,
   o.shipping_provider,o.tracking_status_code,
   (o.label_created_at IS NOT NULL OR o.sendcloud_parcel_id IS NOT NULL OR nullif(o.shipping_remote_id,'') IS NOT NULL) has_label,
   private.shipment_tracking_identity(o) identity_key
  FROM public.fulfillment_orders o WHERE o.owner_id=v_owner AND o.id=ANY(p_ids)
 ), facts AS MATERIALIZED (
  SELECT o.*,s.normalized_state,
   CASE
    WHEN d.identity_key IS NOT NULL AND o.label_cancelled_at IS NULL AND o.pii_purged_at IS NULL AND o.has_label
     THEN jsonb_build_object('dispatchedAt',d.dispatched_at,'cause',d.cause,'actorId',d.actor_id,'reportId',d.report_id,'basis',d.evidence_basis,'observedOnly',d.evidence_basis LIKE '%_observed')
    WHEN d.identity_key IS NULL AND h.order_id IS NOT NULL AND (h.basis='pre_cutover_label_without_evidence' OR NOT o.has_label)
     THEN jsonb_build_object('historical',true,'historicalDate',h.historical_date,'basis',h.basis)
   END evidence
  FROM requested o
  LEFT JOIN private.order_dispatch_evidence d ON d.owner_id=o.owner_id AND d.identity_key=o.identity_key
  LEFT JOIN private.order_logistics_legacy h ON h.owner_id=o.owner_id AND h.order_id=o.id AND h.identity_key=o.identity_key
  LEFT JOIN public.shipment_tracking_state s ON s.owner_id=o.owner_id AND s.order_id=o.id AND s.identity_key=o.identity_key
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'logistics_identity',identity_key,'logistics',evidence,
  'logistics_state',CASE
   WHEN lower(trim(coalesce(source_status,''))) IN ('cancelled','canceled','cancelled_by_customer','cancelled_by_seller')
    OR label_cancelled_at IS NOT NULL
    OR coalesce(normalized_state,private.tracking_legacy_state(shipping_provider,tracking_status_code))='cancelled' THEN 'cancelled'
   WHEN evidence->>'historical'='true' THEN 'shipped'
   WHEN NOT has_label THEN 'pending'
   WHEN evidence IS NOT NULL THEN 'shipped'
   ELSE 'labelled' END)),'[]'::jsonb) FROM facts);
END
$function$;

COMMIT;

