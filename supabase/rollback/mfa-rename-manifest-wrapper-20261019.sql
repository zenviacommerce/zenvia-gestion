-- Use ONLY with MFA mandatory mode off, if rolling back rename wrapper release.
DO $rollback$
DECLARE prior_sql text;
BEGIN
 IF EXISTS (SELECT 1 FROM private.mfa_configuration WHERE singleton AND enabled) THEN
   RAISE EXCEPTION 'DISABLE_MFA_BEFORE_RENAME_ROLLBACK';
 END IF;
 SELECT original_definition INTO prior_sql
 FROM private.mfa_function_manifest
 WHERE signature='public.security_mfa_rename_factor(uuid,text)';
 IF prior_sql IS NULL THEN RAISE EXCEPTION 'MISSING_RENAME_SNAPSHOT'; END IF;
 EXECUTE prior_sql;
 DELETE FROM private.mfa_function_manifest WHERE signature='public.security_mfa_rename_factor(uuid,text)';
 DROP FUNCTION private.mfa_impl_rename_factor(uuid,text);
 IF (SELECT count(*) FROM private.mfa_activation_findings()
     WHERE entry='public.security_mfa_rename_factor(uuid,text)')<>1 THEN
   RAISE EXCEPTION 'RENAME_ROLLBACK_POSTCHECK_FAILED';
 END IF;
END $rollback$;
