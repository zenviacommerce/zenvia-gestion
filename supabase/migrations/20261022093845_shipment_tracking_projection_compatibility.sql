-- Additive compatibility for shadow and activated asynchronous projection.
-- No source DML and no synchronous rebuild. Preserve operator switch values.
SET LOCAL lock_timeout='3s';
CREATE FUNCTION private.tracking_normalize_dashboard_definition(src text) RETURNS text
LANGUAGE plpgsql SET search_path='' AS $normalize$
DECLARE anchor text;pos_start integer;pos_end integer;
BEGIN
 anchor:=' SELECT r.*,'||chr(10)||'   lower(trim';
 if position(anchor in src)=0 or position(' FROM merged r' in src)=0 then raise exception 'TRACKING_DASHBOARD_SOURCE_CHANGED';end if;
 src:=replace(src,anchor,' SELECT r.*, st.normalized_state as tracking_normalized_state,st.raw_code as tracking_raw_code,st.raw_message as tracking_raw_message,st.event_at as tracking_event_at,st.raw_event_time as tracking_event_time_raw,st.observed_at as tracking_observed_at,st.movement_at as tracking_movement_at,st.last_checked_at as tracking_checked_at,st.last_error as tracking_error,'||chr(10)||'   lower(trim');
 src:=replace(src,' FROM merged r',' FROM merged r LEFT JOIN public.shipment_tracking_state st ON st.order_id=r.id AND st.owner_id=r.owner_id AND r.pii_purged_at IS NULL AND st.account_id=r.shipping_integration_account_id AND st.identity_key=md5(jsonb_build_array(r.owner_id,r.shipping_integration_account_id,r.shipping_provider,r.tracking_number,r.shipping_remote_id,r.sendcloud_parcel_id,r.label_created_at,r.label_cancelled_at)::text)');
 anchor:='(n.source_code LIKE ''%cancel%'' OR n.tracking_text LIKE ''%cancelled%'' OR n.tracking_text LIKE ''%canceled%'') AS is_cancelled';
 if position(anchor in src)=0 then raise exception 'TRACKING_CANCEL_SOURCE_CHANGED';end if;
 src:=replace(src,anchor,'(n.source_code IN (''cancelled'',''canceled'',''cancelled_by_customer'',''cancelled_by_seller'') OR coalesce(n.tracking_normalized_state,private.tracking_legacy_state(n.shipping_provider,n.tracking_status_code))=''cancelled'') AS is_cancelled');
 pos_start:=position('  CASE'||chr(10)||'   WHEN (NOT n.has_label' in src);pos_end:=position('  END AS tracking_class' in src);
 if pos_start=0 or pos_end<=pos_start then raise exception 'TRACKING_CLASS_SOURCE_CHANGED';end if;
 anchor:=substring(src from pos_start for pos_end+length('  END AS tracking_class')-pos_start);
 src:=replace(src,anchor,$code$  CASE coalesce(n.tracking_normalized_state,CASE WHEN n.shipping_provider='mrw' THEN NULL ELSE private.tracking_legacy_state(n.shipping_provider,n.tracking_status_code) END)
 WHEN 'pre_transit' THEN 'ready' WHEN 'in_transit' THEN 'transit' WHEN 'out_for_delivery' THEN 'route'
 WHEN 'delivered' THEN 'delivered' WHEN 'exception' THEN 'issue' WHEN 'returned' THEN 'returned' WHEN 'cancelled' THEN 'cancelled' ELSE 'none' END AS tracking_class$code$);

 RETURN src;
END $normalize$;
REVOKE ALL ON FUNCTION private.tracking_normalize_dashboard_definition(text) FROM PUBLIC,anon,authenticated;
DO $compat$
DECLARE f record;def text;prefix text;old_prefix text;scoped text;boundary integer;
 cols text;projected text;original_cols text;classified_cols text;assignments text;stamps text;a record;current_prefix text;
BEGIN
 IF to_regclass('private.orders_projection_classifier') IS NULL THEN RETURN;END IF;
 SELECT source_prefix INTO STRICT old_prefix FROM private.orders_projection_classifier WHERE singleton;
 -- Clean-install ordering: the original projection can already be tracking-aware.
 IF position('tracking_normalized_state' IN old_prefix)>0 THEN
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='private.orders_dashboard_projection_refresh(uuid,text)'::regprocedure AND position('''tracking''' IN prosrc)>0) THEN RAISE EXCEPTION 'TRACKING_EXISTING_PROJECTION_INCOMPLETE';END IF;
  RETURN;
 END IF;
 CREATE TEMP TABLE tracking_normalized_callers(oid oid,signature text,definition text,prefix text,active boolean) ON COMMIT DROP;
 FOR f IN SELECT p.oid,p.oid::regprocedure::text signature,p.prosrc,pg_get_functiondef(p.oid) definition,b.original_definition,b.optimized_hash
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 LEFT JOIN private.orders_projection_rpc_backup b ON b.signature=p.oid::regprocedure::text
 WHERE (n.nspname='public' AND p.proname='orders_dashboard_page_v1' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='sql'))
 OR (n.nspname='private' AND p.proname IN('mfa_impl_orders_dashboard_page_v1','mfa_impl_orders_dashboard_pickup_v1','pickup_report_dashboard_scope')) LOOP
  IF f.original_definition IS NOT NULL AND md5(f.definition)<>f.optimized_hash THEN
   RAISE EXCEPTION 'TRACKING_PROJECTION_RPC_DRIFT: %',f.signature;
  END IF;
  def:=coalesce(f.original_definition,f.definition);
  -- Validate the preserved classifier, never the nested optimized UNION.
  current_prefix:=old_prefix;
  IF position(current_prefix||E',\nmatched AS (' IN def)=0 THEN current_prefix:=replace(old_prefix,'FROM public.fulfillment_orders o WHERE o.owner_id=private.app_workspace_owner_id()','FROM public.fulfillment_orders o');END IF;
  IF position(current_prefix||E',\nmatched AS (' IN def)=0 THEN
   RAISE EXCEPTION 'TRACKING_PROJECTION_CLASSIFIER_DRIFT: %',f.signature;
  END IF;
  def:=private.tracking_normalize_dashboard_definition(def);
  prefix:=private.tracking_normalize_dashboard_definition(current_prefix);
  INSERT INTO tracking_normalized_callers VALUES(f.oid,f.signature,def,prefix,f.original_definition IS NOT NULL);
 END LOOP;
 IF (SELECT count(*) FROM tracking_normalized_callers)<>3 OR (SELECT count(DISTINCT replace(c.prefix,'FROM public.fulfillment_orders o WHERE o.owner_id=private.app_workspace_owner_id()','FROM public.fulfillment_orders o')) FROM tracking_normalized_callers c)<>1 THEN
  RAISE EXCEPTION 'TRACKING_PROJECTION_CALLERS_CHANGED';
 END IF;
 prefix:=private.tracking_normalize_dashboard_definition(old_prefix);
 -- The temporary shape is the canonical classifier name/type/order contract.
 EXECUTE 'CREATE TEMP TABLE tracking_projection_shape ON COMMIT DROP AS '||
 replace(prefix,'FROM public.fulfillment_orders o WHERE o.owner_id=private.app_workspace_owner_id()',
 'FROM public.fulfillment_orders o WHERE false')||' SELECT * FROM classified WITH NO DATA';
 FOR a IN SELECT attname,atttypid,atttypmod FROM pg_attribute WHERE attrelid='private.orders_dashboard_projection'::regclass
 AND attnum>0 AND NOT attisdropped AND attname<>'projection_group_key' LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='tracking_projection_shape'::regclass AND attname=a.attname AND atttypid=a.atttypid AND atttypmod=a.atttypmod) THEN
   RAISE EXCEPTION 'TRACKING_PROJECTION_COLUMN_DRIFT: %',a.attname;
  END IF;
 END LOOP;
 FOR a IN SELECT attname,format_type(atttypid,atttypmod) typ FROM pg_attribute WHERE attrelid='tracking_projection_shape'::regclass
 AND attnum>0 AND NOT attisdropped AND NOT EXISTS(SELECT 1 FROM pg_attribute p WHERE p.attrelid='private.orders_dashboard_projection'::regclass AND p.attname=pg_attribute.attname AND NOT p.attisdropped) LOOP
  IF a.attname<>ALL(ARRAY['tracking_normalized_state','tracking_raw_code','tracking_raw_message','tracking_event_at','tracking_event_time_raw','tracking_observed_at','tracking_movement_at','tracking_checked_at','tracking_error']) THEN RAISE EXCEPTION 'TRACKING_PROJECTION_UNEXPECTED_NEW_COLUMN: %',a.attname;END IF;
  EXECUTE format('ALTER TABLE private.orders_dashboard_projection ADD COLUMN %I %s',a.attname,a.typ);
 END LOOP;
 SELECT string_agg(format('%I',attname),',' ORDER BY attnum),
 string_agg(format('p.%I',attname),',' ORDER BY attnum),string_agg(format('original.%I',attname),',' ORDER BY attnum),
 string_agg(format('c.%I',attname),',' ORDER BY attnum),string_agg(format('%1$I=excluded.%1$I',attname),',' ORDER BY attnum)
 INTO cols,projected,original_cols,classified_cols,assignments FROM pg_attribute
 WHERE attrelid='tracking_projection_shape'::regclass AND attnum>0 AND NOT attisdropped;
 ALTER TABLE private.orders_projection_classifier ADD COLUMN required_generation integer NOT NULL DEFAULT 2;
 ALTER TABLE private.orders_projection_groups ADD COLUMN classifier_generation integer NOT NULL DEFAULT 1;
 UPDATE private.orders_projection_classifier SET source_prefix=prefix WHERE singleton;
 scoped:=replace(prefix,'FROM public.fulfillment_orders o WHERE o.owner_id=private.app_workspace_owner_id()',
 'FROM public.fulfillment_orders o WHERE o.owner_id=p_owner AND private.orders_dashboard_group_key(o.source_channel,o.order_number,o.id)=p_key');
 stamps:='DELETE FROM private.orders_projection_versions WHERE owner_id=p_owner AND group_key=p_key;
 INSERT INTO private.orders_projection_versions SELECT ''orders'',o.id,o.owner_id,p_key,(o.xmin::text||'':''||o.ctid::text)
 FROM public.fulfillment_orders o WHERE o.owner_id=p_owner AND private.orders_dashboard_group_key(o.source_channel,o.order_number,o.id)=p_key;
 INSERT INTO private.orders_projection_versions SELECT ''tracking'',t.order_id,o.owner_id,p_key,(t.xmin::text||'':''||t.ctid::text)
 FROM public.shipment_tracking_state t JOIN public.fulfillment_orders o ON o.id=t.order_id
 WHERE o.owner_id=p_owner AND private.orders_dashboard_group_key(o.source_channel,o.order_number,o.id)=p_key;';
 EXECUTE format('CREATE OR REPLACE FUNCTION private.orders_dashboard_projection_refresh(p_owner uuid,p_key text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS %L',
 'BEGIN '||stamps||'
 WITH refreshed AS MATERIALIZED ('||scoped||' SELECT '||classified_cols||',p_key AS projection_group_key FROM classified c),
 upserted AS (INSERT INTO private.orders_dashboard_projection('||cols||',projection_group_key) SELECT '||cols||',projection_group_key FROM refreshed WHERE true
 ON CONFLICT(owner_id,projection_group_key) DO UPDATE SET '||assignments||' RETURNING 1)
 DELETE FROM private.orders_dashboard_projection p WHERE p.owner_id=p_owner AND p.projection_group_key=p_key AND NOT EXISTS(SELECT 1 FROM refreshed);
 INSERT INTO private.orders_projection_groups(owner_id,group_key,has_row,classifier_generation)
 SELECT p_owner,p_key,EXISTS(SELECT 1 FROM private.orders_dashboard_projection WHERE owner_id=p_owner AND projection_group_key=p_key),required_generation
 FROM private.orders_projection_classifier WHERE singleton
 ON CONFLICT(owner_id,group_key) DO UPDATE SET has_row=excluded.has_row,classifier_generation=excluded.classifier_generation;
 END');
 FOR f IN SELECT * FROM tracking_normalized_callers LOOP
  def:=f.definition;
  IF f.active THEN
   def:=replace(def,f.prefix,'WITH projection_gate AS MATERIALIZED (SELECT private.orders_dashboard_projection_usable() usable),classified AS MATERIALIZED ('||
   'SELECT '||projected||' FROM private.orders_dashboard_projection p WHERE (SELECT usable FROM projection_gate) AND p.owner_id=(SELECT private.app_workspace_owner_id()) UNION ALL SELECT '||original_cols||' FROM ('||
   f.prefix||' SELECT * FROM classified) original WHERE NOT (SELECT usable FROM projection_gate))');
  END IF;
  EXECUTE def;
  IF f.active THEN UPDATE private.orders_projection_rpc_backup SET original_definition=f.definition,optimized_hash=md5(pg_get_functiondef(f.oid)) WHERE signature=f.signature;END IF;
 END LOOP;
 -- Existing groups deliberately remain generation 1 until a bounded worker succeeds.
 -- Repair discovery includes excluded groups with has_row=false.
 SELECT pg_get_functiondef('private.orders_dashboard_projection_usable()'::regprocedure) INTO def;
 IF position('RETURN true;' IN def)=0 THEN RAISE EXCEPTION 'TRACKING_USABILITY_CHANGED';END IF;
 EXECUTE replace(def,'RETURN true;', $gate$IF EXISTS(SELECT 1 FROM private.orders_projection_groups g CROSS JOIN private.orders_projection_classifier c
 WHERE g.owner_id=own AND g.classifier_generation<>c.required_generation) THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM public.fulfillment_orders o WHERE o.owner_id=own AND NOT EXISTS(SELECT 1 FROM private.orders_projection_groups g WHERE g.owner_id=o.owner_id AND g.group_key=private.orders_dashboard_group_key(o.source_channel,o.order_number,o.id))) THEN RETURN false;END IF;
 RETURN true;$gate$);
 SELECT pg_get_functiondef('private.orders_dashboard_projection_repair_enqueue(uuid,integer)'::regprocedure) INTO def;
 IF position('UNION'||chr(10)||'  SELECT coalesce' IN def)=0 THEN RAISE EXCEPTION 'TRACKING_REPAIR_CHANGED';END IF;
 EXECUTE replace(def,'UNION'||chr(10)||'  SELECT coalesce',$repair$UNION
 SELECT g.group_key FROM private.orders_projection_groups g CROSS JOIN private.orders_projection_classifier c
 WHERE g.owner_id=p_owner AND g.classifier_generation<>c.required_generation
 UNION
 SELECT private.orders_dashboard_group_key(o.source_channel,o.order_number,o.id) FROM public.fulfillment_orders o
 WHERE o.owner_id=p_owner AND NOT EXISTS(SELECT 1 FROM private.orders_projection_groups g WHERE g.owner_id=o.owner_id AND g.group_key=private.orders_dashboard_group_key(o.source_channel,o.order_number,o.id))
 UNION
  SELECT coalesce$repair$);
 -- Queue derived groups only; workers rebuild under their existing bounded budget.
 INSERT INTO private.orders_projection_dirty(owner_id,group_key) SELECT owner_id,group_key FROM private.orders_projection_groups;
END $compat$;
DO $tracking_dependency$
DECLARE def text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='orders_dashboard_projection_tracking_changed' AND tgrelid='public.shipment_tracking_state'::regclass) AND to_regprocedure('private.orders_dashboard_projection_refresh(uuid,text)') IS NOT NULL AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.orders_dashboard_projection_refresh(uuid,text)') AND position('public.shipment_tracking_state' IN prosrc)>0) THEN
  EXECUTE $function$CREATE FUNCTION private.orders_dashboard_projection_tracking_changed() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='25ms' AS $body$
  DECLARE old_id uuid;new_id uuid;
  BEGIN
   BEGIN
    IF NOT coalesce((SELECT maintenance_enabled FROM private.orders_projection_control WHERE singleton),false) THEN RETURN NULL;END IF;
    IF TG_OP='UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NULL;END IF;
    IF TG_OP<>'INSERT' THEN old_id:=OLD.order_id;END IF;
    IF TG_OP<>'DELETE' THEN new_id:=NEW.order_id;END IF;
    INSERT INTO private.orders_projection_dirty(owner_id,group_key)
    SELECT f.owner_id,private.orders_dashboard_group_key(f.source_channel,f.order_number,f.id)
    FROM public.fulfillment_orders f WHERE f.id IN(old_id,new_id);
   EXCEPTION WHEN OTHERS THEN
    BEGIN PERFORM private.orders_projection_record_failure(SQLSTATE);
    EXCEPTION WHEN OTHERS THEN RAISE LOG 'orders tracking projection queue and recorder unavailable';END;
   END;
   RETURN NULL;
  END $body$ $function$;
  EXECUTE 'REVOKE ALL ON FUNCTION private.orders_dashboard_projection_tracking_changed() FROM PUBLIC,anon,authenticated';
  EXECUTE 'CREATE TRIGGER orders_dashboard_projection_tracking_changed AFTER INSERT OR UPDATE OR DELETE ON public.shipment_tracking_state FOR EACH ROW EXECUTE FUNCTION private.orders_dashboard_projection_tracking_changed()';
  SELECT pg_get_functiondef('private.orders_dashboard_projection_repair_enqueue(uuid,integer)'::regprocedure) INTO def;
  EXECUTE replace(def,'UNION'||chr(10)||'  SELECT coalesce', $repair$UNION
  SELECT private.orders_dashboard_group_key(o.source_channel,o.order_number,o.id) FROM public.shipment_tracking_state t
   JOIN public.fulfillment_orders o ON o.id=t.order_id
   LEFT JOIN private.orders_projection_versions v ON v.kind='tracking' AND v.id=t.order_id
   WHERE o.owner_id=p_owner AND (v.id IS NULL OR (t.xmin::text||':'||t.ctid::text) IS DISTINCT FROM v.version)
  UNION
  SELECT v.group_key FROM private.orders_projection_versions v LEFT JOIN public.shipment_tracking_state t ON t.order_id=v.id
   WHERE v.kind='tracking' AND v.owner_id=p_owner AND t.order_id IS NULL
  UNION
  SELECT coalesce$repair$);
  SELECT pg_get_functiondef('private.orders_dashboard_projection_usable()'::regprocedure) INTO def;
  EXECUTE replace(def,'RETURN true;', $guard$IF EXISTS(
   SELECT 1 FROM (SELECT t.order_id,(t.xmin::text||':'||t.ctid::text) version FROM public.shipment_tracking_state t
    JOIN public.fulfillment_orders o ON o.id=t.order_id WHERE o.owner_id=own) t
   FULL JOIN (SELECT * FROM private.orders_projection_versions WHERE kind='tracking' AND owner_id=own) v ON v.id=t.order_id
   WHERE t.order_id IS NULL OR v.id IS NULL OR t.version IS DISTINCT FROM v.version
  ) THEN RETURN false;END IF;
  RETURN true;$guard$);
 END IF;
END $tracking_dependency$;


DROP FUNCTION private.tracking_normalize_dashboard_definition(text);
