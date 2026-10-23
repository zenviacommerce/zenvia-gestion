-- Preserve public wrappers/OIDs/ACLs and the cache validity guard. Only reuse
-- the classifier fields already maintained by the projection refresh function.
SET LOCAL lock_timeout='3s';
DO $cache$
DECLARE f record;src text;needle text;replacement text;
BEGIN
 IF to_regclass('private.orders_dashboard_projection') IS NULL THEN RETURN;END IF;
 IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname IN('mfa_impl_orders_workbench_v1','mfa_impl_orders_dashboard_pickup_v1'))<>2 THEN RAISE EXCEPTION 'ORDERS_RPC_SIGNATURES_CHANGED';END IF;
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='private' AND p.proname IN('mfa_impl_orders_workbench_v1','mfa_impl_orders_dashboard_pickup_v1') LOOP
  src:=pg_get_functiondef(f.oid);
  needle:=$old$private.order_logistics_state(to_jsonb(p)) AS order_state$old$;
  IF position(needle IN src)=0 THEN RAISE EXCEPTION 'ORDERS_CACHE_LOGISTICS_SOURCE_CHANGED';END IF;
  src:=replace(src,needle,'p.order_state');
  needle:=$old$(coalesce(nullif(private.order_logistics_evidence(to_jsonb(p))->>'dispatchedAt',''),nullif(private.order_logistics_evidence(to_jsonb(p))->>'historicalDate',''))::timestamptz AT TIME ZONE 'Europe/Madrid')::date AS dispatched_day$old$;
  IF position(needle IN src)=0 THEN RAISE EXCEPTION 'ORDERS_CACHE_DATE_SOURCE_CHANGED';END IF;
  src:=replace(src,needle,'p.dispatched_day');
  needle:=$old$private.order_logistics_state(to_jsonb(original)) AS order_state$old$;
  IF position(needle IN src)=0 THEN RAISE EXCEPTION 'ORDERS_CACHE_FALLBACK_SOURCE_CHANGED';END IF;
  src:=replace(src,needle,'original.order_state');
  EXECUTE src;
 END LOOP;
END $cache$;

-- A dirty key invalidates only that canonical group. Version comparisons keep
-- this safe even if an enqueue was lost; switch/MFA failures use full fallback.
DO $hybrid$
DECLARE f record;src text;needle text;
BEGIN
 IF to_regclass('private.orders_dashboard_projection') IS NULL THEN RETURN;END IF;
 EXECUTE $ddl$CREATE FUNCTION private.orders_dashboard_hybrid_read_enabled() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $body$
 SELECT coalesce((SELECT read_enabled AND maintenance_enabled FROM private.orders_projection_control WHERE singleton),false)
 AND private.app_workspace_owner_id() IS NOT NULL
 AND private.app_has_permission('orders') AND private.mfa_allowed()
 AND EXISTS(SELECT 1 FROM private.orders_projection_classifier WHERE singleton)
 $body$$ddl$;
 EXECUTE $ddl$CREATE FUNCTION private.orders_projection_stale_keys() RETURNS TABLE(group_key text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $body$
 WITH own AS MATERIALIZED(SELECT private.app_workspace_owner_id() id),
 source_rows AS MATERIALIZED(
  SELECT o.id,o.owner_id,(CASE WHEN o.source_channel IN ('amazon','shopify') AND trim(coalesce(o.order_number,''))<>'' THEN o.source_channel||':'||trim(o.order_number) ELSE o.id::text END) group_key,(o.xmin::text||':'||o.ctid::text) version
  FROM public.fulfillment_orders o WHERE o.owner_id=(SELECT id FROM own)
 ), versions AS MATERIALIZED(SELECT v.* FROM private.orders_projection_versions v WHERE v.owner_id=(SELECT id FROM own)),
 source_mismatches AS MATERIALIZED(
  SELECT o.group_key current_key,v.group_key old_key FROM source_rows o
  FULL JOIN (SELECT * FROM versions WHERE kind='orders') v ON v.id=o.id
  WHERE o.id IS NULL OR v.id IS NULL OR o.version IS DISTINCT FROM v.version
 ),tracking_mismatches AS MATERIALIZED(
  SELECT o.group_key current_key,v.group_key old_key FROM
  (SELECT t.order_id,(t.xmin::text||':'||t.ctid::text) version,s.group_key FROM public.shipment_tracking_state t
   JOIN source_rows s ON s.id=t.order_id AND s.owner_id=t.owner_id) o
  FULL JOIN (SELECT * FROM versions WHERE kind='tracking') v ON v.id=o.order_id
  WHERE o.order_id IS NULL OR v.id IS NULL OR o.version IS DISTINCT FROM v.version
 ),fact_identity AS MATERIALIZED(
  SELECT p.id,p.owner_id,p.projection_group_key,p.order_state,p.dispatched_day,p.has_label,p.is_cancelled,
  p.label_cancelled_at,p.pii_purged_at,
  md5(jsonb_build_array(p.owner_id,p.shipping_integration_account_id,p.shipping_provider,p.tracking_number,p.shipping_remote_id,p.sendcloud_parcel_id,p.label_created_at,p.label_cancelled_at)::text) identity_key
  FROM private.orders_dashboard_projection p WHERE p.owner_id=(SELECT id FROM own)
 ),fact_rows AS (
  SELECT p.*,d.identity_key dispatch_key,d.dispatched_at,h.identity_key history_key,h.historical_date,h.basis history_basis
  FROM fact_identity p
  LEFT JOIN private.order_dispatch_evidence d ON d.owner_id=p.owner_id AND d.identity_key=p.identity_key
  LEFT JOIN private.order_logistics_legacy h ON h.owner_id=p.owner_id AND h.order_id=p.id AND h.identity_key=p.identity_key
 ),fact_effective AS (
  SELECT f.*,dispatch_key IS NOT NULL AND has_label AND label_cancelled_at IS NULL AND pii_purged_at IS NULL physical,
  history_key IS NOT NULL AND dispatch_key IS NULL AND (history_basis='pre_cutover_label_without_evidence' OR NOT has_label) historical FROM fact_rows f
 ),fact_mismatches AS (
  SELECT projection_group_key FROM fact_effective
  WHERE order_state IS DISTINCT FROM CASE WHEN is_cancelled OR label_cancelled_at IS NOT NULL THEN 'cancelled' WHEN historical THEN 'shipped' WHEN NOT has_label THEN 'pending' WHEN physical THEN 'shipped' ELSE 'labelled' END
  OR dispatched_day IS DISTINCT FROM ((CASE WHEN physical THEN dispatched_at WHEN historical THEN historical_date END) AT TIME ZONE 'Europe/Madrid')::date
 )
 SELECT d.group_key FROM private.orders_projection_dirty d WHERE d.owner_id=(SELECT id FROM own)
 UNION SELECT projection_group_key FROM fact_mismatches
 UNION SELECT current_key FROM source_mismatches WHERE current_key IS NOT NULL
 UNION SELECT old_key FROM source_mismatches WHERE old_key IS NOT NULL
 UNION SELECT current_key FROM tracking_mismatches WHERE current_key IS NOT NULL
 UNION SELECT old_key FROM tracking_mismatches WHERE old_key IS NOT NULL
 UNION SELECT s.group_key FROM source_rows s WHERE NOT EXISTS(SELECT 1 FROM private.orders_projection_groups g WHERE g.owner_id=s.owner_id AND g.group_key=s.group_key)
 UNION SELECT g.group_key FROM private.orders_projection_groups g CROSS JOIN private.orders_projection_classifier c
 WHERE g.owner_id=(SELECT id FROM own) AND g.classifier_generation<>c.required_generation
 UNION SELECT coalesce(p.projection_group_key,g.group_key) FROM
 (SELECT * FROM private.orders_dashboard_projection WHERE owner_id=(SELECT id FROM own)) p
 FULL JOIN (SELECT * FROM private.orders_projection_groups WHERE owner_id=(SELECT id FROM own) AND has_row) g ON g.group_key=p.projection_group_key
 WHERE p.projection_group_key IS NULL OR g.group_key IS NULL
 $body$$ddl$;
 REVOKE ALL ON FUNCTION private.orders_dashboard_hybrid_read_enabled(),private.orders_projection_stale_keys() FROM PUBLIC,anon,authenticated;
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='private' AND p.proname IN('mfa_impl_orders_workbench_v1','mfa_impl_orders_dashboard_pickup_v1') LOOP
  src:=pg_get_functiondef(f.oid);
  needle:='WITH projection_gate AS MATERIALIZED (SELECT private.orders_dashboard_projection_usable() usable),classified AS MATERIALIZED (';
  IF position(needle IN src)=0 THEN RAISE EXCEPTION 'ORDERS_HYBRID_GATE_SOURCE_CHANGED';END IF;
  src:=replace(src,needle,'WITH projection_gate AS MATERIALIZED (SELECT private.orders_dashboard_hybrid_read_enabled() usable),projection_stale AS MATERIALIZED (SELECT group_key FROM private.orders_projection_stale_keys() WHERE (SELECT usable FROM projection_gate)),projection_source AS MATERIALIZED (SELECT o.* FROM public.fulfillment_orders o WHERE o.owner_id=(SELECT private.app_workspace_owner_id()) AND NOT (SELECT usable FROM projection_gate) UNION ALL SELECT o.* FROM projection_stale s JOIN public.fulfillment_orders o ON o.owner_id=(SELECT private.app_workspace_owner_id()) AND private.orders_dashboard_group_key(o.source_channel,o.order_number,o.id)=s.group_key WHERE (SELECT usable FROM projection_gate)),classified AS MATERIALIZED (');
  needle:='AND p.owner_id=(SELECT private.app_workspace_owner_id()) UNION ALL';
  IF position(needle IN src)=0 THEN RAISE EXCEPTION 'ORDERS_HYBRID_CACHE_SOURCE_CHANGED';END IF;
  src:=replace(src,needle,'AND p.owner_id=(SELECT private.app_workspace_owner_id()) AND NOT EXISTS(SELECT 1 FROM projection_stale s WHERE s.group_key=p.projection_group_key) UNION ALL');
  needle:='FROM public.fulfillment_orders o WHERE o.owner_id=private.app_workspace_owner_id()';
  IF position(needle IN src)=0 THEN RAISE EXCEPTION 'ORDERS_HYBRID_RANK_SOURCE_CHANGED';END IF;
  src:=replace(src,needle,'FROM projection_source o');
  needle:=') SELECT * FROM classified) original WHERE NOT (SELECT usable FROM projection_gate)';
  IF position(needle IN src)=0 THEN RAISE EXCEPTION 'ORDERS_HYBRID_FALLBACK_SOURCE_CHANGED';END IF;
  src:=replace(src,needle,') SELECT * FROM classified) original');
  needle:=$pageold$'logistics_state',private.order_logistics_state(to_jsonb(p)),'logistics',private.order_logistics_evidence(to_jsonb(p)),'logistics_identity',private.order_logistics_identity(to_jsonb(p))$pageold$;
  IF position(needle IN src)=0 THEN RAISE EXCEPTION 'ORDERS_PAGE_LOGISTICS_SOURCE_CHANGED';END IF;
  src:=replace(src,needle,$pagenew$'logistics_state',p.order_state,'logistics',private.order_logistics_evidence(jsonb_build_object('id',p.id,'owner_id',p.owner_id,'shipping_integration_account_id',p.shipping_integration_account_id,'shipping_provider',p.shipping_provider,'tracking_number',p.tracking_number,'shipping_remote_id',p.shipping_remote_id,'sendcloud_parcel_id',p.sendcloud_parcel_id,'label_created_at',p.label_created_at,'label_cancelled_at',p.label_cancelled_at,'pii_purged_at',p.pii_purged_at)),'logistics_identity',md5(jsonb_build_array(p.owner_id,p.shipping_integration_account_id,p.shipping_provider,p.tracking_number,p.shipping_remote_id,p.sendcloud_parcel_id,p.label_created_at,p.label_cancelled_at)::text)$pagenew$);
  EXECUTE src;
 END LOOP;
END $hybrid$;
