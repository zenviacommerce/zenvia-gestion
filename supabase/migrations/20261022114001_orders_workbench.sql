-- Additive workbench read API. Preserve existing wrappers, classifier and controls.
CREATE FUNCTION private.orders_workbench_civil_day(p_value text) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF p_value IS NULL OR p_value !~ '^\d{4}-\d{2}-\d{2}([ T]|$)' THEN RETURN NULL;END IF;
 RETURN make_date(substring(p_value,1,4)::integer,substring(p_value,6,2)::integer,substring(p_value,9,2)::integer);
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format OR numeric_value_out_of_range THEN RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.orders_workbench_civil_day(text) FROM PUBLIC,anon,authenticated;

DO $build$
DECLARE source text; patched text; args text; impl regprocedure; f record; anchor text;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO STRICT source FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='mfa_impl_orders_dashboard_pickup_v1';
 patched:=replace(source,'FUNCTION private.mfa_impl_orders_dashboard_pickup_v1(', 'FUNCTION private.mfa_impl_orders_workbench_v1(');
 anchor:='p_selection_all boolean DEFAULT false)';
 IF position(anchor IN patched)=0 OR position(E',\nmatched AS (' IN patched)=0 OR position('FROM classified c' IN patched)=0 THEN RAISE EXCEPTION 'ORDERS_WORKBENCH_SOURCE_CHANGED';END IF;
 patched:=replace(patched,anchor,'p_selection_all boolean DEFAULT false, p_tracking_stale_days integer DEFAULT 3)');
 patched:=replace(patched,E',\nmatched AS (',$attention$,
workbench_classified AS (
 SELECT c.*,
  (NOT c.is_cancelled AND c.tracking_class NOT IN ('delivered','returned','cancelled') AND
   (c.tracking_class='issue' OR (c.has_label AND c.tracking_class IN ('ready','transit','route') AND
    CASE WHEN private.orders_workbench_civil_day(c.tracking_event_time_raw) IS NOT NULL
     THEN (now() AT TIME ZONE 'Europe/Madrid')::date-private.orders_workbench_civil_day(c.tracking_event_time_raw)>=least(greatest(coalesce(p_tracking_stale_days,3),1),90)
     ELSE coalesce(c.tracking_movement_at,c.tracking_event_at)<=now()-make_interval(days=>least(greatest(coalesce(p_tracking_stale_days,3),1),90)) END))) IS TRUE AS is_attention
 FROM classified c
),
parent_scope AS (
 SELECT c.* FROM classified c WHERE (p_channel='all' OR c.source_channel=p_channel)
 AND (trim(coalesce(p_query,''))='' OR position(lower(trim(p_query)) IN lower(concat_ws(' ',c.order_number,c.order_id,c.customer_name,c.tracking_number,c.tracking_status_message,c.carrier_label,c.items::text,c.country_code)))>0)
),
matched AS ($attention$);
 -- Only the matched CTE consumes dynamic attention; never change projection shape.
 anchor:=E' FROM classified c\n),\nscope AS';
 IF position(anchor IN patched)=0 THEN RAISE EXCEPTION 'ORDERS_WORKBENCH_MATCHED_CHANGED';END IF;
 patched:=replace(patched,anchor,E' FROM workbench_classified c\n),\nscope AS');
 anchor:='OR (p_state=''labelled'' AND order_state=''labelled'')';
 IF position(anchor IN patched)=0 THEN RAISE EXCEPTION 'ORDERS_WORKBENCH_STATE_CHANGED';END IF;
 patched:=replace(patched,anchor,anchor||E'\n   OR (p_state=''issues'' AND is_attention)');
 patched:=replace(patched,'SELECT DISTINCT country_code FROM classified','SELECT DISTINCT country_code FROM parent_scope');
 patched:=replace(patched,'SELECT DISTINCT carrier_label FROM classified','SELECT DISTINCT carrier_label FROM parent_scope');
 anchor:='''kpis'',(SELECT data FROM kpis),';
 IF position(anchor IN patched)=0 THEN RAISE EXCEPTION 'ORDERS_WORKBENCH_RESPONSE_CHANGED';END IF;
 patched:=replace(patched,anchor,$counters$'counters',(SELECT jsonb_build_object(
 'pending',count(*) FILTER(WHERE order_state='pending'),
 'labelled',count(*) FILTER(WHERE order_state='labelled'),
 'shipped',count(*) FILTER(WHERE order_state='shipped' AND in_shipped_period),
 'issues',count(*) FILTER(WHERE is_attention),
 'cancelled',count(*) FILTER(WHERE is_cancelled AND in_order_period)) FROM scope),
 'kpis',(SELECT data FROM kpis),$counters$);
 patched:=replace(patched,'''in_cost_period'' - ''ordinal''','''in_cost_period'' - ''is_attention'' - ''ordinal''');
 EXECUTE patched;
 impl:='private.mfa_impl_orders_workbench_v1(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[],text,boolean,integer)'::regprocedure;
 SELECT * INTO STRICT f FROM pg_proc WHERE oid=impl;
 SELECT string_agg('$'||i,',' ORDER BY i) INTO args FROM generate_series(1,f.pronargs)i;
 EXECUTE format('CREATE FUNCTION public.orders_workbench_v1(%s) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=%L AS %L',pg_get_function_arguments(f.oid),'',
 'BEGIN PERFORM private.pickup_report_owner(); IF $17 NOT IN (''all'',''in'',''none'') OR $17 IS NULL THEN RAISE EXCEPTION ''PICKUP_INVALID_FILTER'' USING ERRCODE=''22023''; END IF; IF $3 NOT IN (''pending'',''labelled'',''shipped'',''issues'',''cancelled'',''all'') OR $3 IS NULL THEN RAISE EXCEPTION ''ORDERS_INVALID_STATE'' USING ERRCODE=''22023'';END IF; RETURN private.mfa_impl_orders_workbench_v1('||args||');END');
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',impl);
 INSERT INTO private.mfa_function_manifest(signature,function_oid,implementation,original_definition,wrapper_hash)
 SELECT p.oid::regprocedure::text,p.oid,impl,replace(patched,'FUNCTION private.mfa_impl_orders_workbench_v1(','FUNCTION public.orders_workbench_v1('),md5(pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='orders_workbench_v1';
END $build$;
REVOKE ALL ON FUNCTION public.orders_workbench_v1(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[],text,boolean,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.orders_workbench_v1(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[],text,boolean,integer) TO authenticated,service_role;
