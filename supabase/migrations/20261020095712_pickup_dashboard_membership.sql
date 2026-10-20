-- Additive read RPC. Preserve original dashboard + existing MFA wrappers unchanged.
DO $clone$
DECLARE src text;
BEGIN
 SELECT pg_get_functiondef('private.pickup_report_dashboard_scope(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[])'::regprocedure) INTO src;
 IF position('FROM public.fulfillment_orders o WHERE o.owner_id=private.app_workspace_owner_id()' IN src)=0 OR position(') AS context_match' IN src)=0 THEN RAISE EXCEPTION 'PICKUP_DASHBOARD_SOURCE_CHANGED';END IF;
 src:=replace(src,'FUNCTION private.pickup_report_dashboard_scope(', 'FUNCTION public.orders_dashboard_pickup_v1(');
 src:=replace(src,$source$p_selected_ids uuid[] DEFAULT NULL::uuid[])$source$,$source$p_selected_ids uuid[] DEFAULT NULL::uuid[], p_pickup_report text DEFAULT 'all', p_selection_all boolean DEFAULT false)$source$);
 IF position('p_pickup_report text' IN src)=0 THEN RAISE EXCEPTION 'PICKUP_DASHBOARD_SIGNATURE_CHANGED';END IF;
 src:=replace(src,'STABLE','STABLE SECURITY DEFINER');
 src:=replace(src,') AS context_match', ' AND (p_pickup_report=''all'' OR (p_pickup_report=''in'' AND EXISTS (SELECT 1 FROM public.pickup_report_items pi WHERE pi.owner_id=c.owner_id AND (pi.order_id=c.id OR pi.order_key=CASE WHEN c.source_channel IN (''amazon'',''shopify'') AND nullif(trim(c.order_number),'''') IS NOT NULL THEN c.source_channel||'':''||coalesce(c.source_integration_account_id::text,''legacy'')||'':''||trim(c.order_number) ELSE c.id::text END))) OR (p_pickup_report=''none'' AND NOT EXISTS (SELECT 1 FROM public.pickup_report_items pi WHERE pi.owner_id=c.owner_id AND (pi.order_id=c.id OR pi.order_key=CASE WHEN c.source_channel IN (''amazon'',''shopify'') AND nullif(trim(c.order_number),'''') IS NOT NULL THEN c.source_channel||'':''||coalesce(c.source_integration_account_id::text,''legacy'')||'':''||trim(c.order_number) ELSE c.id::text END))))) AS context_match');
 src:=replace(src,$source$OR (id=ANY(p_selected_ids) AND order_state='pending' AND pii_purged_at IS NULL)$source$,'OR id=ANY(p_selected_ids)');
 src:=replace(src,E'SELECT id FROM eligible\n',E'SELECT id FROM eligible WHERE p_selection_all OR (order_state=\'pending\' AND pii_purged_at IS NULL)\n');
 src:=replace(src,$source$jsonb_build_object('shipping_measurement',$source$, $source$jsonb_build_object('pickup_reports',coalesce((SELECT jsonb_agg(jsonb_build_object('id',pr.id,'number',pr.number) ORDER BY pr.created_at DESC,pr.id DESC) FROM public.pickup_report_items pi JOIN public.pickup_reports pr ON pr.id=pi.report_id AND pr.owner_id=pi.owner_id WHERE pi.owner_id=p.owner_id AND (pi.order_id=p.id OR pi.order_key=CASE WHEN p.source_channel IN ('amazon','shopify') AND nullif(trim(p.order_number),'') IS NOT NULL THEN p.source_channel||':'||coalesce(p.source_integration_account_id::text,'legacy')||':'||trim(p.order_number) ELSE p.id::text END)),'[]'::jsonb),'shipping_measurement',$source$);
 EXECUTE src;
END $clone$;
REVOKE ALL ON FUNCTION public.orders_dashboard_pickup_v1(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[],text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.orders_dashboard_pickup_v1(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[],text,boolean) TO authenticated;
-- Same audited MFA wrapper/manifest contract as pickup_report_*.
DO $wrap$
DECLARE f record;original text;impl_oid regprocedure;args text;
BEGIN
 SELECT p.* INTO STRICT f FROM pg_proc p WHERE p.oid='public.orders_dashboard_pickup_v1(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[],text,boolean)'::regprocedure;
 original:=pg_get_functiondef(f.oid);
 EXECUTE replace(original,'FUNCTION public.orders_dashboard_pickup_v1(', 'FUNCTION private.mfa_impl_orders_dashboard_pickup_v1(');
 impl_oid:='private.mfa_impl_orders_dashboard_pickup_v1(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[],text,boolean)'::regprocedure;
 SELECT string_agg('$'||i,',' ORDER BY i) INTO args FROM generate_series(1,f.pronargs)i;
 EXECUTE format('CREATE OR REPLACE FUNCTION public.orders_dashboard_pickup_v1(%s) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=%L AS %L',pg_get_function_arguments(f.oid),'',
 'BEGIN PERFORM private.pickup_report_owner(); IF $17 NOT IN (''all'',''in'',''none'') OR $17 IS NULL THEN RAISE EXCEPTION ''PICKUP_INVALID_FILTER'' USING ERRCODE=''22023'';END IF; RETURN private.mfa_impl_orders_dashboard_pickup_v1('||args||'); END');
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',impl_oid);
 INSERT INTO private.mfa_function_manifest(signature,function_oid,implementation,original_definition,wrapper_hash) VALUES(f.oid::regprocedure::text,f.oid,impl_oid,original,md5(pg_get_functiondef(f.oid)));
END $wrap$;
