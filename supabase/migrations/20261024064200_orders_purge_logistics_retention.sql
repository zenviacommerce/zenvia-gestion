-- Definition-only portion. No production execution or existing-row update here.
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
CREATE TABLE private.order_logistics_retention(
 owner_id uuid NOT NULL REFERENCES public.workspaces(id),order_id uuid NOT NULL,
 operational_state text NOT NULL CHECK(operational_state IN('shipped','cancelled')),
 dispatched_at timestamptz,evidence_basis text NOT NULL,cause text,
 observed_only boolean NOT NULL DEFAULT false,had_label boolean NOT NULL,
 shipping_cost_day date,recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,order_id)
);
ALTER TABLE private.order_logistics_retention ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.order_logistics_retention FROM PUBLIC,anon,authenticated;
CREATE TRIGGER order_logistics_retention_immutable BEFORE UPDATE OR DELETE ON private.order_logistics_retention
 FOR EACH ROW EXECUTE FUNCTION private.pickup_report_immutable();
CREATE INDEX IF NOT EXISTS order_dispatch_retention_lookup ON private.order_dispatch_evidence(owner_id,order_id,recorded_at DESC);

-- Only operational metadata survives. No tracking, address, payload or label capability.
CREATE FUNCTION private.order_logistics_retained_evidence(p_row jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $retained$
 SELECT jsonb_build_object('historical',true,'retainedAfterPurge',true,'retainedState',coalesce(r.operational_state,'shipped'),
 'historicalDate',CASE WHEN r.order_id IS NOT NULL THEN r.dispatched_at ELSE coalesce(d.dispatched_at,h.historical_date,
  nullif(p_row->>'fulfilled_at','')::timestamptz,
  CASE WHEN s.normalized_state IN('in_transit','out_for_delivery','delivered','exception','returned') THEN coalesce(s.movement_at,s.event_at) END) END,
 'basis',coalesce(r.evidence_basis,CASE WHEN d.order_id IS NOT NULL THEN 'pii_retained_dispatch_fact'
  WHEN h.order_id IS NOT NULL THEN 'pii_retained_channel_history'
  WHEN p_row->>'fulfilled_at' IS NOT NULL THEN 'pii_retained_fulfilled_history'
  WHEN s.normalized_state IN('in_transit','out_for_delivery','delivered','exception','returned') THEN 'pii_retained_tracking_history'
  ELSE 'pii_retained_date_unknown' END),
 'cause',coalesce(r.cause,d.cause),'observedOnly',coalesce(r.observed_only,d.evidence_basis LIKE '%_observed',false))
 FROM (VALUES(1)) seed(n)
 LEFT JOIN private.order_logistics_retention r ON r.owner_id=(p_row->>'owner_id')::uuid AND r.order_id=(p_row->>'id')::uuid
 LEFT JOIN LATERAL(SELECT f.* FROM private.order_dispatch_evidence f WHERE f.owner_id=(p_row->>'owner_id')::uuid AND f.order_id=(p_row->>'id')::uuid ORDER BY f.recorded_at DESC,f.identity_key LIMIT 1)d ON true
 LEFT JOIN private.order_logistics_legacy h ON h.owner_id=(p_row->>'owner_id')::uuid AND h.order_id=(p_row->>'id')::uuid
 LEFT JOIN public.shipment_tracking_state s ON s.owner_id=(p_row->>'owner_id')::uuid AND s.order_id=(p_row->>'id')::uuid
 WHERE p_row->>'pii_purged_at' IS NOT NULL;
$retained$;
REVOKE ALL ON FUNCTION private.order_logistics_retained_evidence(jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.order_logistics_store_retention(original jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $capture$
DECLARE e jsonb;v_state text;v_has_label boolean;v_cost_day date;v_owner uuid:=(original->>'owner_id')::uuid;v_id uuid:=(original->>'id')::uuid;
BEGIN
 IF EXISTS(SELECT 1 FROM private.order_logistics_retention WHERE owner_id=v_owner AND order_id=v_id) THEN RETURN;END IF;
 v_state:=private.order_logistics_state(original);
 e:=private.order_logistics_retained_evidence(original||jsonb_build_object('pii_purged_at',coalesce(nullif(original->>'pii_purged_at','')::timestamptz,statement_timestamp())));
 v_has_label:=(original->>'label_created_at' IS NOT NULL OR original->>'sendcloud_parcel_id' IS NOT NULL OR nullif(original->>'shipping_remote_id','') IS NOT NULL)
  OR (original->>'pii_purged_at' IS NOT NULL AND (EXISTS(SELECT 1 FROM private.order_dispatch_evidence WHERE owner_id=v_owner AND order_id=v_id)
  OR EXISTS(SELECT 1 FROM private.order_logistics_legacy WHERE owner_id=v_owner AND order_id=v_id AND basis='pre_cutover_label_without_evidence')));
 v_cost_day:=(coalesce(nullif(original->>'shipping_cost_recorded_at',''),nullif(original->>'fulfilled_at',''),nullif(original->>'label_created_at',''),nullif(original->>'tracking_updated_at',''),original->>'order_created_at')::timestamptz AT TIME ZONE 'Europe/Madrid')::date;
 INSERT INTO private.order_logistics_retention(owner_id,order_id,operational_state,dispatched_at,evidence_basis,cause,observed_only,had_label,shipping_cost_day)
 VALUES(v_owner,v_id,CASE WHEN v_state='cancelled' THEN 'cancelled' ELSE 'shipped' END,
 CASE WHEN v_state='cancelled' AND e->>'basis'='pii_retained_fulfilled_history' THEN NULL ELSE nullif(e->>'historicalDate','')::timestamptz END,e->>'basis',e->>'cause',coalesce((e->>'observedOnly')::boolean,false),v_has_label,v_cost_day)
 ON CONFLICT DO NOTHING;
END $capture$;
REVOKE ALL ON FUNCTION private.order_logistics_store_retention(jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION private.order_logistics_capture_retention() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $trigger$
BEGIN
 IF new.pii_purged_at IS NOT NULL THEN
  PERFORM private.order_logistics_store_retention(CASE WHEN TG_OP='UPDATE' AND old.owner_id=new.owner_id AND old.id=new.id THEN to_jsonb(old)||jsonb_build_object(
   'source_status',CASE WHEN lower(trim(coalesce(new.source_status,''))) IN('cancelled','canceled','cancelled_by_customer','cancelled_by_seller') THEN new.source_status ELSE old.source_status END,
   'fulfilled_at',coalesce(old.fulfilled_at,new.fulfilled_at),'label_cancelled_at',coalesce(new.label_cancelled_at,old.label_cancelled_at)) ELSE to_jsonb(new) END);
 END IF;
 RETURN new;
END $trigger$;
REVOKE ALL ON FUNCTION private.order_logistics_capture_retention() FROM PUBLIC,anon,authenticated;
-- Runs after zzzz_amazon_pii_guard, including tombstone-driven inserts, but OLD
-- is still available before the AFTER tracking/history privacy cleanup.
CREATE TRIGGER zzzzb_order_logistics_retention BEFORE INSERT OR UPDATE ON public.fulfillment_orders
 FOR EACH ROW EXECUTE FUNCTION private.order_logistics_capture_retention();

CREATE OR REPLACE FUNCTION private.mfa_impl_order_logistics_read(p_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_owner uuid:=private.pickup_report_owner();
BEGIN
 IF p_ids IS NULL OR cardinality(p_ids)>10000 THEN RAISE EXCEPTION 'LOGISTICS_INVALID_SELECTION';END IF;
 RETURN (
 WITH requested AS MATERIALIZED (
  SELECT o.id,o.owner_id,o.source_status,o.label_cancelled_at,o.pii_purged_at,
   o.shipping_provider,o.tracking_status_code,o.fulfilled_at,
   (o.label_created_at IS NOT NULL OR o.sendcloud_parcel_id IS NOT NULL OR nullif(o.shipping_remote_id,'') IS NOT NULL) has_label,
   private.shipment_tracking_identity(o) identity_key
  FROM public.fulfillment_orders o WHERE o.owner_id=v_owner AND o.id=ANY(p_ids)
 ), facts AS MATERIALIZED (
  SELECT o.*,s.normalized_state,
   CASE
    WHEN o.pii_purged_at IS NOT NULL THEN private.order_logistics_retained_evidence(jsonb_build_object('id',o.id,'owner_id',o.owner_id,'pii_purged_at',o.pii_purged_at,'fulfilled_at',o.fulfilled_at))
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
   WHEN pii_purged_at IS NOT NULL THEN coalesce(evidence->>'retainedState','shipped') WHEN evidence->>'historical'='true' THEN 'shipped'
   WHEN NOT has_label THEN 'pending'
   WHEN evidence IS NOT NULL THEN 'shipped'
   ELSE 'labelled' END)),'[]'::jsonb) FROM facts);
END
$function$
;

DO $patch$
DECLARE src text;needle text;f record;body text;a integer;b integer;
BEGIN
 src:=pg_get_functiondef('private.order_logistics_evidence(jsonb)'::regprocedure);
 SELECT prosrc INTO body FROM pg_proc WHERE oid='private.order_logistics_evidence(jsonb)'::regprocedure;
 body:=regexp_replace(body,'[;[:space:]]+$','');
 EXECUTE format('CREATE OR REPLACE FUNCTION private.order_logistics_evidence(p_row jsonb) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='''' AS %L',
 'SELECT CASE WHEN p_row->>''pii_purged_at'' IS NOT NULL THEN private.order_logistics_retained_evidence(p_row) ELSE (SELECT x.e FROM ('||body||')x(e) LIMIT 1) END');
 src:=pg_get_functiondef('private.order_logistics_state(jsonb)'::regprocedure);
 needle:='when private.order_logistics_evidence(p_row)->>''historical''=''true'' then ''shipped''';
 IF strpos(src,needle)=0 THEN RAISE EXCEPTION 'RETENTION_STATE_SOURCE_CHANGED';END IF;
 src:=replace(src,needle,'when p_row->>''pii_purged_at'' IS NOT NULL then coalesce((SELECT operational_state FROM private.order_logistics_retention WHERE owner_id=(p_row->>''owner_id'')::uuid AND order_id=(p_row->>''id'')::uuid),''shipped'') '||needle);EXECUTE src;

 src:=pg_get_functiondef('private.orders_projection_stale_keys()'::regprocedure);
 src:=replace(src,'p.label_cancelled_at,p.pii_purged_at,','p.label_cancelled_at,p.pii_purged_at,p.fulfilled_at,');
 src:=replace(src,'h.basis history_basis','h.basis history_basis,r.operational_state retained_state,r.dispatched_at retained_at,r.order_id retained_order_id');
 src:=replace(src,'FROM fact_identity p','FROM fact_identity p LEFT JOIN private.order_logistics_retention r ON r.owner_id=p.owner_id AND r.order_id=p.id');
 src:=replace(src,'''cancelled'' WHEN historical','''cancelled'' WHEN pii_purged_at IS NOT NULL THEN coalesce(retained_state,''shipped'') WHEN historical');
 src:=replace(src,'CASE WHEN physical THEN dispatched_at WHEN historical THEN historical_date END','CASE WHEN pii_purged_at IS NOT NULL THEN CASE WHEN retained_order_id IS NOT NULL THEN retained_at ELSE coalesce(historical_date,fulfilled_at) END WHEN physical THEN dispatched_at WHEN historical THEN historical_date END');
 EXECUTE src;

 -- Retained cost period, without changing row/composite shapes or label identity.
 FOR f IN SELECT oid FROM pg_proc WHERE oid IN('private.orders_dashboard_projection_refresh(uuid,text)'::regprocedure,'private.orders_classified_fallback(text[])'::regprocedure) LOOP
  src:=pg_get_functiondef(f.oid);
  needle:='(coalesce(f.shipping_cost_recorded_at,f.fulfilled_at,f.label_created_at,f.tracking_updated_at,f.order_created_at) AT TIME ZONE ''Europe/Madrid'')::date AS shipping_cost_day';
  IF strpos(src,needle)=0 THEN RAISE EXCEPTION 'RETENTION_COST_DATE_SOURCE_CHANGED';END IF;
  src:=replace(src,needle,'CASE WHEN f.pii_purged_at IS NOT NULL THEN coalesce((f.shipping_cost_recorded_at AT TIME ZONE ''Europe/Madrid'')::date,(SELECT r.shipping_cost_day FROM private.order_logistics_retention r WHERE r.owner_id=f.owner_id AND r.order_id=f.id),(coalesce(f.fulfilled_at,f.label_created_at,f.tracking_updated_at,f.order_created_at) AT TIME ZONE ''Europe/Madrid'')::date) ELSE '||needle);
  -- Complete CASE before the original AS alias.
  src:=replace(src,'ELSE '||needle,'ELSE '||replace(needle,' AS shipping_cost_day',' END AS shipping_cost_day'));
  EXECUTE src;
 END LOOP;

 FOR f IN SELECT oid FROM pg_proc WHERE pronamespace='private'::regnamespace AND proname IN('mfa_impl_orders_workbench_v1','mfa_impl_orders_dashboard_pickup_v1') LOOP
  src:=pg_get_functiondef(f.oid);
  needle:='''logistics'',CASE WHEN d.identity_key';
  IF strpos(src,needle)=0 THEN RAISE EXCEPTION 'RETENTION_PAGE_SOURCE_CHANGED';END IF;
  src:=replace(src,needle,'''logistics'',CASE WHEN p.pii_purged_at IS NOT NULL THEN private.order_logistics_retained_evidence(jsonb_build_object(''id'',p.id,''owner_id'',p.owner_id,''pii_purged_at'',p.pii_purged_at,''fulfilled_at'',p.fulfilled_at)) WHEN d.identity_key');
  a:=strpos(src,'shipping AS (');b:=strpos(substr(src,a),'counts AS (')+a-1;
  IF a=0 OR b<a THEN RAISE EXCEPTION 'RETENTION_SHIPPING_CTE_CHANGED';END IF;
  body:=substr(src,a,b-a);
  body:=replace(body,'has_label AND in_cost_period','(has_label OR coalesce(retention_cost.had_label,false)) AND in_cost_period');
  body:=replace(body,E'FROM scope\n)',E'FROM scope LEFT JOIN private.order_logistics_retention retention_cost ON retention_cost.owner_id=scope.owner_id AND retention_cost.order_id=scope.id AND scope.pii_purged_at IS NOT NULL\n)');
  src:=substr(src,1,a-1)||body||substr(src,b);
  src:=replace(src,'WHERE s.has_label AND s.in_cost_period','WHERE s.has_label AND s.pii_purged_at IS NULL AND s.in_cost_period');
  EXECUTE src;
 END LOOP;
END $patch$;

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
