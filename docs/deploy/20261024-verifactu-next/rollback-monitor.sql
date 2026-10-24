-- Only the new monitor API. Safe after fiscal use: never touches that history.
BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='15s';
DELETE FROM private.mfa_function_manifest WHERE function_oid=to_regprocedure('public.verifactu_integrity_report()');
DROP FUNCTION public.verifactu_integrity_report();
DROP FUNCTION private.mfa_impl_verifactu_integrity_report();
DROP FUNCTION private.vf_integrity_report(uuid);
COMMIT;
