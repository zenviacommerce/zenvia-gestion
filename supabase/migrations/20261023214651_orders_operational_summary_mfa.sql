SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
-- Aggregate-only Summary API: no unpaged order JSON or logistics metadata.
CREATE FUNCTION public.orders_operational_summary_v1(p_from date DEFAULT NULL,p_to date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $summary$
DECLARE own uuid:=private.pickup_report_owner();
BEGIN
 RETURN (
 WITH gate AS MATERIALIZED (SELECT private.orders_dashboard_hybrid_read_enabled() usable),
 stale AS MATERIALIZED (SELECT group_key FROM private.orders_projection_stale_keys() WHERE (SELECT usable FROM gate)),
 classified AS MATERIALIZED (
  SELECT p.order_state,p.source_channel,(p.order_created_at AT TIME ZONE 'UTC')::date created_day
  FROM private.orders_dashboard_projection p
  WHERE p.owner_id=own AND (SELECT usable FROM gate)
   AND NOT EXISTS(SELECT 1 FROM stale s WHERE s.group_key=p.projection_group_key)
  UNION ALL
  SELECT f.order_state,f.source_channel,(f.order_created_at AT TIME ZONE 'UTC')::date
  FROM private.orders_classified_fallback(CASE WHEN (SELECT usable FROM gate) THEN ARRAY(SELECT group_key FROM stale) ELSE NULL END) f
  WHERE NOT (SELECT usable FROM gate) OR EXISTS(SELECT 1 FROM stale)
 ), scoped AS (
  SELECT *,created_day IS NOT NULL AND (p_from IS NULL OR created_day>=p_from) AND (p_to IS NULL OR created_day<=p_to) in_period FROM classified
 )
 SELECT jsonb_build_object(
  'orders',count(*) FILTER(WHERE in_period AND order_state<>'cancelled'),
  'pending',count(*) FILTER(WHERE order_state='pending'),
  'shipped',count(*) FILTER(WHERE in_period AND order_state='shipped'),
  'cancelled',count(*) FILTER(WHERE in_period AND order_state='cancelled'),
  'amazon',count(*) FILTER(WHERE in_period AND order_state<>'cancelled' AND source_channel='amazon'),
  'shopify',count(*) FILTER(WHERE in_period AND order_state<>'cancelled' AND source_channel='shopify')
 ) FROM scoped);
END $summary$;
REVOKE ALL ON FUNCTION public.orders_operational_summary_v1(date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.orders_operational_summary_v1(date,date) TO authenticated;

-- Existing wrapper/manifest contract; leaves cohort and pilot configuration unchanged.
DO $wrap$
DECLARE f record; original text; impl_name text; impl_oid regprocedure; args text;
BEGIN
 FOR f IN SELECT p.* FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN
 ('orders_operational_summary_v1')
 LOOP
 original:=pg_get_functiondef(f.oid);
 impl_name:='mfa_impl_'||f.proname;
 EXECUTE replace(original,'FUNCTION public.'||f.proname||'(', 'FUNCTION private.'||impl_name||'(');
 impl_oid:=to_regprocedure('private.'||impl_name||'('||oidvectortypes(f.proargtypes)||')');
 SELECT string_agg('$'||i,',' ORDER BY i) INTO args FROM generate_series(1,f.pronargs)i;
 EXECUTE format('CREATE OR REPLACE FUNCTION public.%I(%s) RETURNS jsonb LANGUAGE plpgsql %s SECURITY DEFINER SET search_path=%L AS %L',
 f.proname,pg_get_function_arguments(f.oid),CASE WHEN f.provolatile='s' THEN 'STABLE' ELSE 'VOLATILE' END,'',
 'BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION ''AUTH_REQUIRED'' USING ERRCODE=''42501''; END IF; PERFORM public.security_mfa_assert(false); RETURN private.'||impl_name||'('||args||'); END');
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',impl_oid);
 INSERT INTO private.mfa_function_manifest(signature,function_oid,implementation,original_definition,wrapper_hash)
 VALUES(f.oid::regprocedure::text,f.oid,impl_oid,original,md5(pg_get_functiondef(f.oid)));
 END LOOP;
END $wrap$;

