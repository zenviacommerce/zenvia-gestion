-- Activate only after shadow projection parity and actual production EXPLAIN.
-- Public wrappers, MFA manifest, ACLs and RPC signatures remain unchanged.
DO $activate$
DECLARE f record;original text;boundary integer;source_prefix text;prefix text;cols text;newdef text;
BEGIN
 SELECT c.source_prefix INTO STRICT prefix FROM private.orders_projection_classifier c WHERE singleton;
 -- All callers must use exactly the same pre-filter classifier. Fail closed if
 -- a release has introduced a different classifier; never silently cache it.
 FOR f IN SELECT p.oid,p.oid::regprocedure::text signature,p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='public' AND p.proname='orders_dashboard_page_v1' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='sql'))
 OR (n.nspname='private' AND p.proname IN ('mfa_impl_orders_dashboard_page_v1','mfa_impl_orders_dashboard_pickup_v1','pickup_report_dashboard_scope')) LOOP
  original:=pg_get_functiondef(f.oid);boundary:=position(E',\nmatched AS (' IN f.prosrc);
  IF boundary=0 THEN RAISE EXCEPTION 'ORDERS_PROJECTION_CALLER_CHANGED: %',f.signature;END IF;
  source_prefix:=left(f.prosrc,boundary-1);
  IF replace(source_prefix,'FROM public.fulfillment_orders o WHERE o.owner_id=private.app_workspace_owner_id()','FROM public.fulfillment_orders o')<>replace(prefix,'FROM public.fulfillment_orders o WHERE o.owner_id=private.app_workspace_owner_id()','FROM public.fulfillment_orders o') THEN
   RAISE EXCEPTION 'ORDERS_PROJECTION_CLASSIFIER_MISMATCH: %',f.signature;
  END IF;
  SELECT string_agg(format('p.%I',attname),',' ORDER BY attnum) INTO cols FROM pg_attribute
  WHERE attrelid='private.orders_dashboard_projection'::regclass AND attnum>0 AND NOT attisdropped AND attname<>'projection_group_key';
  newdef:=replace(original,source_prefix,'WITH classified AS MATERIALIZED (SELECT '||cols||' FROM private.orders_dashboard_projection p WHERE p.owner_id=(SELECT private.app_workspace_owner_id()))');
  EXECUTE newdef;
  INSERT INTO private.orders_projection_rpc_backup VALUES(f.signature,original,md5(pg_get_functiondef(f.oid)));
 END LOOP;
END $activate$;
