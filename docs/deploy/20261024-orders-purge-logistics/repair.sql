-- Approved-count gate: 549 already-purged source rows, nine wrong projections.
-- No purge is executed again and no source order or document is updated.
CREATE TEMP TABLE logistics_retention_repair_targets ON COMMIT DROP AS
SELECT o.owner_id,o.id,private.orders_dashboard_group_key(o.source_channel,o.order_number,o.id) group_key
FROM public.fulfillment_orders o JOIN private.orders_dashboard_projection p ON p.owner_id=o.owner_id AND p.id=o.id
WHERE o.pii_purged_at IS NOT NULL AND p.order_state IN('pending','labelled');
DO $repair$
DECLARE n bigint;owners bigint;targets bigint;last_dirty bigint;r record;started timestamptz:=clock_timestamp();
BEGIN
 SELECT count(*),count(DISTINCT owner_id) INTO n,owners FROM public.fulfillment_orders WHERE pii_purged_at IS NOT NULL;
 SELECT count(*) INTO targets FROM logistics_retention_repair_targets;
 IF n=0 AND targets=0 THEN RETURN;END IF; -- Empty fresh installations have nothing to repair.
 IF n<>549 OR owners<>1 OR targets<>9 THEN RAISE EXCEPTION 'RETENTION_RECOUNT_REQUIRED rows=%, owners=%, targets=%',n,owners,targets;END IF;
 PERFORM private.order_logistics_store_retention(to_jsonb(o)) FROM public.fulfillment_orders o WHERE o.pii_purged_at IS NOT NULL;
 FOR r IN SELECT DISTINCT owner_id,group_key FROM logistics_retention_repair_targets ORDER BY owner_id,group_key LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended(r.owner_id::text||':'||r.group_key,719)) THEN RAISE EXCEPTION 'RETENTION_GROUP_BUSY';END IF;
  SELECT max(id) INTO last_dirty FROM private.orders_projection_dirty WHERE owner_id=r.owner_id AND group_key=r.group_key;
  PERFORM private.orders_dashboard_projection_refresh(r.owner_id,r.group_key);
  DELETE FROM private.orders_projection_dirty WHERE owner_id=r.owner_id AND group_key=r.group_key AND id<=last_dirty;
 END LOOP;
 IF EXISTS(SELECT 1 FROM private.orders_dashboard_projection p JOIN logistics_retention_repair_targets t ON t.owner_id=p.owner_id AND t.id=p.id WHERE p.order_state IN('pending','labelled')) THEN RAISE EXCEPTION 'RETENTION_REPAIR_FAILED';END IF;
 EXECUTE format('COMMENT ON TABLE private.order_logistics_retention IS %L',jsonb_build_object('deployment','20261024-purge-logistics','retained_rows',n,'refreshed_groups',targets,'repair_ms',extract(epoch from clock_timestamp()-started)*1000,'completed_at',clock_timestamp())::text);
END $repair$;
