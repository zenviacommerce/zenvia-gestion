BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DELETE FROM private.mfa_function_manifest WHERE function_oid=to_regprocedure('public.orders_operational_summary_v1(date,date)');
DROP FUNCTION IF EXISTS public.orders_operational_summary_v1(date,date);
DROP FUNCTION IF EXISTS private.mfa_impl_orders_operational_summary_v1(date,date);
COMMIT;
