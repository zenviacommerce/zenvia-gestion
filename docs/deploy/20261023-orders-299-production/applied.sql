SET LOCAL application_name='orders_299_cache_approved_20261023';
-- Preserve public wrappers/OIDs/ACLs and the cache validity guard. Only reuse
-- the classifier fields already maintained by the projection refresh function.
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $cache$
DECLARE f record;src text;needle text;replacement text;
BEGIN
 IF to_regclass('private.orders_dashboard_projection') IS NULL THEN RETURN;END IF;
 IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname IN('mfa_impl_orders_workbench_v1','mfa_impl_orders_dashboard_pickup_v1'))<>2 THEN RAISE EXCEPTION 'ORDERS_RPC_SIGNATURES_CHANGED';END IF;
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='private' AND p.proname IN('mfa_impl_orders_workbench_v1','mfa_impl_orders_dashboard_pickup_v1') LOOP
  src:=pg_get_functiondef(f.oid);
  needle:=$old$private.order_logistics_state(to_jsonb(p)) AS order_state$old$;
  IF position(needle IN src)=0 AND position('p.print_sort,p.order_state,p.created_day,p.dispatched_day,p.shipping_cost_day' IN src)=0 THEN RAISE EXCEPTION 'ORDERS_CACHE_LOGISTICS_SOURCE_CHANGED';END IF;
  src:=replace(src,needle,'p.order_state');
  needle:=$old$(coalesce(nullif(private.order_logistics_evidence(to_jsonb(p))->>'dispatchedAt',''),nullif(private.order_logistics_evidence(to_jsonb(p))->>'historicalDate',''))::timestamptz AT TIME ZONE 'Europe/Madrid')::date AS dispatched_day$old$;
  IF position(needle IN src)=0 AND position('p.created_day,p.dispatched_day,p.shipping_cost_day' IN src)=0 THEN RAISE EXCEPTION 'ORDERS_CACHE_DATE_SOURCE_CHANGED';END IF;
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

-- Token-aware auxiliary fragments keep large JSON out of the classified CTEs.
-- The projection tuple token is checked again on every read; missing, outdated
-- or dirty fragments always use the live classified row. No parameter cache.
CREATE FUNCTION pg_temp.orders_sql_call_end(p_src text,p_start integer) RETURNS integer
LANGUAGE plpgsql AS $parser$
DECLARE i integer:=strpos(substr(p_src,p_start),'(')+p_start;depth integer:=1;quoted boolean:=false;ch text;
BEGIN
 WHILE depth>0 AND i<=length(p_src) LOOP
  ch:=substr(p_src,i,1);
  IF ch='''' THEN
   IF quoted AND substr(p_src,i+1,1)='''' THEN i:=i+2;CONTINUE;END IF;
   quoted:=NOT quoted;
  ELSIF NOT quoted THEN
   IF ch='(' THEN depth:=depth+1;ELSIF ch=')' THEN depth:=depth-1;END IF;
  END IF;
  i:=i+1;
 END LOOP;
 IF depth<>0 THEN RAISE EXCEPTION 'ORDERS_PAYLOAD_SQL_SHAPE_CHANGED';END IF;
 RETURN i;
END $parser$;

DO $payloads$
DECLARE backfill_started timestamptz;backfill_ms numeric;backfill_rows bigint; src text;fields text;fallback text;fallback_old text;tariff text;remove_keys text;identity_expr text;
 insert_sql text;cache_cte text;page_joins text;tariff_join text;evidence text;logistics text;pickup text;
 a integer;b integer;c integer;d integer;start_at integer;end_at integer;f record;args text;body text;
BEGIN
 IF to_regclass('private.orders_dashboard_projection') IS NULL THEN RETURN;END IF;
 SELECT p.prosrc INTO STRICT src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='private' AND p.proname='mfa_impl_orders_workbench_v1';
 a:=strpos(src,'classified AS MATERIALIZED (SELECT ')+length('classified AS MATERIALIZED (SELECT ');
 b:=strpos(substr(src,a),' FROM private.orders_dashboard_projection p')+a-1;
 IF a<length('classified AS MATERIALIZED (SELECT ')+1 OR b<a THEN RAISE EXCEPTION 'ORDERS_PAYLOAD_ROW_SHAPE_CHANGED';END IF;
 fields:=substr(src,a,b-a);
 a:=strpos(src,'UNION ALL SELECT original.');
 b:=strpos(src,') SELECT * FROM classified) original')+length(') SELECT * FROM classified) original');
 IF a=0 OR b<=a THEN RAISE EXCEPTION 'ORDERS_PAYLOAD_FALLBACK_CHANGED';END IF;
 fallback_old:=substr(src,a,b-a);fallback:=substr(fallback_old,length('UNION ALL ')+1);
 IF strpos(fallback,'FROM projection_source o')=0 THEN RAISE EXCEPTION 'ORDERS_PAYLOAD_SCOPE_CHANGED';END IF;
 fallback:=replace(fallback,'FROM projection_source o','FROM public.fulfillment_orders o WHERE o.owner_id=(SELECT private.app_workspace_owner_id()) AND (p_keys IS NULL OR private.orders_dashboard_group_key(o.source_channel,o.order_number,o.id)=ANY(p_keys))');
 -- A private schema-only view supplies the exact existing composite contract.
 EXECUTE 'CREATE VIEW private.orders_classified_shape AS SELECT '||fields||' FROM private.orders_dashboard_projection p WHERE false';
 EXECUTE format('CREATE FUNCTION private.orders_classified_fallback(p_keys text[]) RETURNS SETOF private.orders_classified_shape LANGUAGE sql STABLE SECURITY DEFINER SET search_path='''' AS %L',fallback);
 EXECUTE $ddl$CREATE TABLE private.orders_projection_payloads(
  owner_id uuid NOT NULL,group_key text NOT NULL,order_id uuid NOT NULL,
  projection_version text NOT NULL,format_generation integer NOT NULL,serialization_timezone text NOT NULL,
  identity_key text NOT NULL,row_payload jsonb NOT NULL,tariff_payload jsonb NOT NULL,
  PRIMARY KEY(owner_id,group_key),
  FOREIGN KEY(owner_id,group_key) REFERENCES private.orders_dashboard_projection(owner_id,projection_group_key) ON UPDATE CASCADE ON DELETE CASCADE
 )$ddl$;
 ALTER TABLE private.orders_projection_payloads ENABLE ROW LEVEL SECURITY;
 CREATE INDEX orders_projection_payload_order_idx ON private.orders_projection_payloads(owner_id,order_id);
 REVOKE ALL ON private.orders_projection_payloads,private.orders_classified_shape FROM PUBLIC,anon,authenticated;
 REVOKE ALL ON FUNCTION private.orders_classified_fallback(text[]) FROM PUBLIC,anon,authenticated;
 remove_keys:=$keys$ARRAY['raw_payload','dedupe_rank','source_code','tracking_text','has_label','country_code','carrier_label','is_cancelled','has_progress','tracking_class','order_state','created_day','dispatched_day','shipping_cost_day','weight_sort','units_sort','print_sort','vat_percent','context_match','in_order_period','in_shipped_period','in_cost_period','is_attention','ordinal']::text[]$keys$;
 identity_expr:=$identity$md5(jsonb_build_array(p.owner_id,p.shipping_integration_account_id,p.shipping_provider,p.tracking_number,p.shipping_remote_id,p.sendcloud_parcel_id,p.label_created_at,p.label_cancelled_at)::text)$identity$;
 start_at:=strpos(src,'''tariffCandidates'',coalesce((SELECT jsonb_agg(');
 a:=strpos(substr(src,start_at),'jsonb_build_object(')+start_at-1;
 b:=pg_temp.orders_sql_call_end(src,a);tariff:=substr(src,a,b-a);
 IF start_at=0 OR a<start_at THEN RAISE EXCEPTION 'ORDERS_PAYLOAD_TARIFF_CHANGED';END IF;
 insert_sql:='INSERT INTO private.orders_projection_payloads(owner_id,group_key,order_id,projection_version,format_generation,serialization_timezone,identity_key,row_payload,tariff_payload) SELECT p.owner_id,p.projection_group_key,p.id,p.xmin::text||'':''||p.ctid::text,1,current_setting(''TimeZone''),'||identity_expr||',to_jsonb(a)-'||remove_keys||','||replace(tariff,'s.','a.')||' FROM private.orders_dashboard_projection p CROSS JOIN LATERAL(SELECT '||fields||')a WHERE p.owner_id=p_owner AND p.projection_group_key=p_key ON CONFLICT(owner_id,group_key) DO UPDATE SET order_id=excluded.order_id,projection_version=excluded.projection_version,format_generation=excluded.format_generation,serialization_timezone=excluded.serialization_timezone,identity_key=excluded.identity_key,row_payload=excluded.row_payload,tariff_payload=excluded.tariff_payload';
 EXECUTE format('CREATE FUNCTION private.orders_projection_payload_refresh(p_owner uuid,p_key text) RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='''' AS %L',insert_sql);
 EXECUTE $ddl$CREATE FUNCTION private.orders_projection_payload_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $trigger$BEGIN PERFORM private.orders_projection_payload_refresh(new.owner_id,new.projection_group_key);RETURN new;END$trigger$$ddl$;
 REVOKE ALL ON FUNCTION private.orders_projection_payload_refresh(uuid,text),private.orders_projection_payload_changed() FROM PUBLIC,anon,authenticated;
 CREATE TRIGGER orders_projection_payload_changed AFTER INSERT OR UPDATE ON private.orders_dashboard_projection FOR EACH ROW EXECUTE FUNCTION private.orders_projection_payload_changed();
 -- Derived fragments only: business orders and immutable facts are untouched.
 -- Deployment preflight records the projected-row count before this backfill.
 backfill_started:=clock_timestamp();
 EXECUTE replace(insert_sql,' WHERE p.owner_id=p_owner AND p.projection_group_key=p_key','');
 GET DIAGNOSTICS backfill_rows=ROW_COUNT;
 backfill_ms:=extract(epoch FROM clock_timestamp()-backfill_started)*1000;

 -- Cached identity is valid only for this exact projection tuple and format.
 SELECT p.prosrc INTO STRICT body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='orders_projection_stale_keys';
 IF strpos(body,identity_expr||' identity_key')=0 THEN RAISE EXCEPTION 'ORDERS_PAYLOAD_FACT_GUARD_CHANGED';END IF;
 body:=replace(body,identity_expr||' identity_key','coalesce(x.identity_key,'||identity_expr||') identity_key');
 body:=replace(body,'FROM private.orders_dashboard_projection p WHERE p.owner_id=(SELECT id FROM own)','FROM private.orders_dashboard_projection p LEFT JOIN private.orders_projection_payloads x ON x.owner_id=p.owner_id AND x.group_key=p.projection_group_key AND x.order_id=p.id AND x.projection_version=p.xmin::text||'':''||p.ctid::text AND x.format_generation=1 AND x.serialization_timezone=current_setting(''TimeZone'') WHERE p.owner_id=(SELECT id FROM own)');
 EXECUTE format('CREATE OR REPLACE FUNCTION private.orders_projection_stale_keys() RETURNS TABLE(group_key text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='''' AS %L','BEGIN RETURN QUERY '||regexp_replace(body,'[;[:space:]]+$','')||';END;');

 cache_cte:=$cache$payload_cache AS NOT MATERIALIZED (
 SELECT c.* FROM private.orders_projection_payloads c JOIN private.orders_dashboard_projection p
 ON p.owner_id=c.owner_id AND p.projection_group_key=c.group_key AND p.id=c.order_id
 AND c.projection_version=p.xmin::text||':'||p.ctid::text
 WHERE c.owner_id=(SELECT private.app_workspace_owner_id()) AND c.format_generation=1 AND c.serialization_timezone=current_setting('TimeZone')
 AND (SELECT usable FROM projection_gate)
 AND NOT EXISTS(SELECT 1 FROM projection_stale k WHERE k.group_key=c.group_key)
 ),$cache$;
 page_joins:='FROM paged p LEFT JOIN payload_cache pc ON pc.owner_id=p.owner_id AND pc.order_id=p.id AND pc.group_key=private.orders_dashboard_group_key(p.source_channel,p.order_number,p.id) LEFT JOIN LATERAL(SELECT coalesce(pc.identity_key,'||identity_expr||') identity_key)li ON true LEFT JOIN private.order_dispatch_evidence d ON d.owner_id=p.owner_id AND d.identity_key=li.identity_key LEFT JOIN private.order_logistics_legacy h ON h.owner_id=p.owner_id AND h.order_id=p.id AND h.identity_key=li.identity_key)';
 tariff_join:='FROM scope s LEFT JOIN payload_cache tc ON tc.owner_id=s.owner_id AND tc.order_id=s.id AND tc.group_key=private.orders_dashboard_group_key(s.source_channel,s.order_number,s.id) WHERE s.has_label';
 evidence:=$evidence$CASE WHEN d.identity_key IS NOT NULL AND p.label_cancelled_at IS NULL AND p.pii_purged_at IS NULL AND(p.label_created_at IS NOT NULL OR p.sendcloud_parcel_id IS NOT NULL OR nullif(p.shipping_remote_id,'') IS NOT NULL)
 THEN jsonb_build_object('dispatchedAt',d.dispatched_at,'cause',d.cause,'actorId',d.actor_id,'reportId',d.report_id,'basis',d.evidence_basis,'observedOnly',d.evidence_basis LIKE '%_observed')
 WHEN h.identity_key IS NOT NULL AND d.identity_key IS NULL AND(h.basis='pre_cutover_label_without_evidence' OR(p.label_created_at IS NULL AND p.sendcloud_parcel_id IS NULL AND nullif(p.shipping_remote_id,'') IS NULL))
 THEN jsonb_build_object('historical',true,'historicalDate',h.historical_date,'basis',h.basis) END$evidence$;
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='private' AND p.proname IN('mfa_impl_orders_workbench_v1','mfa_impl_orders_dashboard_pickup_v1') LOOP
  SELECT prosrc,pg_get_function_arguments(oid) INTO src,args FROM pg_proc WHERE oid=f.oid;
  IF strpos(src,fallback_old)=0 OR strpos(src,'scope AS (SELECT * FROM matched WHERE context_match),')=0 OR strpos(src,'FROM scope s WHERE s.has_label')=0 OR strpos(src,'FROM paged p)')=0 THEN RAISE EXCEPTION 'ORDERS_PAYLOAD_RPC_SHAPE_CHANGED';END IF;
  src:=replace(src,fallback_old,'UNION ALL SELECT z.* FROM private.orders_classified_fallback(CASE WHEN(SELECT usable FROM projection_gate)THEN ARRAY(SELECT group_key FROM projection_stale)ELSE NULL END)z WHERE NOT(SELECT usable FROM projection_gate)OR EXISTS(SELECT 1 FROM projection_stale)');
  src:=replace(src,'scope AS (SELECT * FROM matched WHERE context_match),','scope AS (SELECT * FROM matched WHERE context_match),'||cache_cte);
  src:=replace(src,E'parent_scope AS (\n SELECT c.* FROM classified c',E'parent_scope AS (\n SELECT c.country_code,c.carrier_label FROM classified c');
  start_at:=strpos(src,'''rows'',coalesce');
  a:=strpos(substr(src,start_at),'SELECT jsonb_agg(')+start_at-1+length('SELECT jsonb_agg(');
  end_at:=strpos(substr(src,a),'ORDER BY p.ordinal')+a-1;
  b:=strpos(substr(src,a),'jsonb_build_object(''logistics_state''')+a-1;
  c:=pg_temp.orders_sql_call_end(src,b);
  logistics:=substr(src,b+length('jsonb_build_object('),c-b-length('jsonb_build_object(')-1);
  b:=strpos(logistics,'private.order_logistics_evidence(');c:=pg_temp.orders_sql_call_end(logistics,b);
  logistics:=substr(logistics,1,b-1)||evidence||substr(logistics,c);
  logistics:=replace(logistics,'''logistics_identity'','||identity_expr,'''logistics_identity'',li.identity_key');
  b:=strpos(substr(src,a),'jsonb_build_object(''pickup_reports''')+a-1;c:=pg_temp.orders_sql_call_end(src,b);
  pickup:=substr(src,b+length('jsonb_build_object('),c-b-length('jsonb_build_object(')-1);
  IF a<=start_at OR end_at<a OR b<a THEN RAISE EXCEPTION 'ORDERS_PAYLOAD_PAGE_CHANGED';END IF;
  src:=substr(src,1,a-1)||'(coalesce(pc.row_payload,to_jsonb(p)-'||remove_keys||')||jsonb_build_object('||logistics||','||pickup||')) '||substr(src,end_at);
  src:=replace(src,'FROM paged p)',page_joins);
  IF strpos(src,tariff)=0 THEN RAISE EXCEPTION 'ORDERS_PAYLOAD_TARIFF_RPC_CHANGED';END IF;
  src:=replace(src,tariff,'coalesce(tc.tariff_payload,'||tariff||')');
  src:=replace(src,'FROM scope s WHERE s.has_label',tariff_join);
  EXECUTE format('CREATE OR REPLACE FUNCTION private.%I(%s) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='''' SET plan_cache_mode=force_generic_plan AS %L',f.proname,args,'BEGIN RETURN ('||regexp_replace(src,'[;[:space:]]+$','')||');END;');
 END LOOP;
 EXECUTE format('COMMENT ON TABLE private.orders_projection_payloads IS %L',jsonb_build_object('deployment','orders_299_cache','backfill_rows',backfill_rows,'backfill_ms',backfill_ms,'server_elapsed_ms',extract(epoch FROM clock_timestamp()-transaction_timestamp())*1000,'finished_at',clock_timestamp(),'lock_timeout','3s','statement_timeout','15s','summary_api_deferred',true)::text);
END $payloads$;



