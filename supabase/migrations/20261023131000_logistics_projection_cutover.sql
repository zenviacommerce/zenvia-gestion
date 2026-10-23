-- Rebuild cached groups after the physical-dispatch classifier cutover, including
-- fresh pre_transit labels with no dispatch/history facts to invalidate them.
-- Queue-only maintenance: no business rows, evidence, epochs or operator switches
-- are changed. The existing dirty gate forces fallback until bounded cron batches
-- finish; existing/tombstoned groups and current source keys are both covered.
SET LOCAL lock_timeout='3s';
DO $cutover$
BEGIN
 IF to_regclass('private.orders_projection_groups') IS NULL THEN RETURN;END IF;
 IF position('private.order_logistics_state' IN pg_get_functiondef('private.orders_dashboard_projection_refresh(uuid,text)'::regprocedure))=0 THEN
  RAISE EXCEPTION 'LOGISTICS_PROJECTION_CLASSIFIER_REQUIRED';
 END IF;
 INSERT INTO private.orders_projection_dirty(owner_id,group_key)
 SELECT k.owner_id,k.group_key FROM (
  SELECT owner_id,group_key FROM private.orders_projection_groups
  UNION
  SELECT owner_id,private.orders_dashboard_group_key(source_channel,order_number,id)
  FROM public.fulfillment_orders
 ) k WHERE NOT EXISTS(SELECT 1 FROM private.orders_projection_dirty d
  WHERE d.owner_id=k.owner_id AND d.group_key=k.group_key);
END $cutover$;
