-- Empty-installation rollback only. Never remove issued receipt evidence.
-- If receipts exist, roll back the frontend and, if needed, REVOKE EXECUTE on
-- public.pickup_report_create(uuid[],uuid,boolean,jsonb) FROM authenticated;
-- preserve snapshots/read RPCs. Do not edit this guard to discard reports.
-- This rollback does not change orders, dashboard, auth or shipping.
BEGIN;
DO $guard$
BEGIN
 IF to_regclass('public.pickup_reports') IS NOT NULL THEN
 IF EXISTS(SELECT 1 FROM public.pickup_reports) THEN
 RAISE EXCEPTION 'PICKUP_ROLLBACK_REFUSED_RECEIPTS_EXIST: Roll back frontend/create permission; preserve issued receipt evidence.';
 END IF;
 END IF;
END $guard$;
DELETE FROM private.mfa_function_manifest WHERE function_oid IN (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('pickup_report_selection','pickup_report_preview','pickup_report_create','pickup_report_get','pickup_report_list'));
DROP FUNCTION IF EXISTS public.pickup_report_selection(jsonb,integer);
DROP FUNCTION IF EXISTS public.pickup_report_preview(uuid[]);
DROP FUNCTION IF EXISTS public.pickup_report_create(uuid[],uuid,boolean,jsonb);
DROP FUNCTION IF EXISTS public.pickup_report_get(uuid);
DROP FUNCTION IF EXISTS public.pickup_report_list(uuid,integer);
DROP FUNCTION IF EXISTS private.mfa_impl_pickup_report_selection(jsonb,integer);
DROP FUNCTION IF EXISTS private.mfa_impl_pickup_report_preview(uuid[]);
DROP FUNCTION IF EXISTS private.mfa_impl_pickup_report_create(uuid[],uuid,boolean,jsonb);
DROP FUNCTION IF EXISTS private.mfa_impl_pickup_report_get(uuid);
DROP FUNCTION IF EXISTS private.mfa_impl_pickup_report_list(uuid,integer);
DROP FUNCTION IF EXISTS private.pickup_report_preview_items(uuid,uuid[]);
DROP FUNCTION IF EXISTS private.pickup_report_owner();
DROP FUNCTION IF EXISTS private.pickup_report_dashboard_scope(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[]);
DROP TABLE IF EXISTS public.pickup_report_items;
DROP TABLE IF EXISTS public.pickup_reports;
DROP TABLE IF EXISTS private.pickup_report_counters;
DROP FUNCTION IF EXISTS private.pickup_report_immutable();
COMMIT;
