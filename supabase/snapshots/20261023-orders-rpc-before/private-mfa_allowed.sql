CREATE OR REPLACE FUNCTION private.mfa_allowed()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT CASE
 WHEN NOT c.enabled THEN NOT EXISTS (
   SELECT 1 FROM private.mfa_principals p
   WHERE p.user_id=(SELECT auth.uid())
   AND p.state IN ('recovery_locked','bootstrap_pending','re_enrollment_pending'))
 WHEN c.cohort_user_ids IS NOT NULL AND NOT ((SELECT auth.uid())=ANY(c.cohort_user_ids)) THEN TRUE
 ELSE private.mfa_error(false) IS NULL END
 FROM private.mfa_configuration c WHERE c.singleton
$function$
