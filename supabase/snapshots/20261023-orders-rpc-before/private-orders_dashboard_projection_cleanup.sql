CREATE OR REPLACE FUNCTION private.orders_dashboard_projection_cleanup(p_limit integer DEFAULT 100)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE n integer;g record;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>1000 THEN RAISE EXCEPTION 'INVALID_PROJECTION_BATCH_LIMIT';END IF;
 n:=0;
 FOR g IN SELECT p.owner_id,p.projection_group_key FROM private.orders_dashboard_projection p
 WHERE NOT EXISTS(SELECT 1 FROM public.fulfillment_orders o WHERE o.owner_id=p.owner_id
  AND private.orders_dashboard_group_key(o.source_channel,o.order_number,o.id)=p.projection_group_key)
 OR EXISTS(SELECT 1 FROM private.orders_projection_versions v LEFT JOIN public.fulfillment_orders o ON o.id=v.id
  WHERE v.kind='orders' AND v.owner_id=p.owner_id AND v.group_key=p.projection_group_key
  AND (o.id IS NULL OR o.owner_id IS DISTINCT FROM v.owner_id OR
   private.orders_dashboard_group_key(o.source_channel,o.order_number,o.id) IS DISTINCT FROM v.group_key))
 OR EXISTS(SELECT 1 FROM public.fulfillment_orders o LEFT JOIN private.orders_projection_versions v ON v.kind='orders' AND v.id=o.id
  WHERE o.owner_id=p.owner_id AND private.orders_dashboard_group_key(o.source_channel,o.order_number,o.id)=p.projection_group_key
  AND o.pii_purged_at IS NOT NULL AND (v.id IS NULL OR v.version IS DISTINCT FROM (o.xmin::text||':'||o.ctid::text)))
 ORDER BY p.owner_id,p.projection_group_key LIMIT p_limit LOOP
  -- No source-write path takes this lock. A busy worker is retried next tick.
  IF NOT pg_try_advisory_xact_lock(hashtextextended(g.owner_id::text||':'||g.projection_group_key,719)) THEN CONTINUE;END IF;
  DELETE FROM private.orders_dashboard_projection WHERE owner_id=g.owner_id AND projection_group_key=g.projection_group_key;
  n:=n+1;
  BEGIN
   INSERT INTO private.orders_projection_dirty(owner_id,group_key) VALUES(g.owner_id,g.projection_group_key);
  EXCEPTION WHEN OTHERS THEN PERFORM private.orders_projection_record_failure(SQLSTATE,g.owner_id,g.projection_group_key);
  END;
 END LOOP;
 RETURN n;
END $function$
