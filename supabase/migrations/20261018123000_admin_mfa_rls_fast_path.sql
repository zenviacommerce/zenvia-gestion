-- Fast-path for disabled MFA. Preserve recovery locks while preventing
-- expensive MFA session and principal lookups on every RLS initPlan.
CREATE OR REPLACE FUNCTION private.mfa_allowed()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN (SELECT c.enabled FROM private.mfa_configuration c WHERE c.singleton)=false
 THEN NOT EXISTS (
   SELECT 1 FROM private.mfa_principals p
   WHERE p.user_id=(SELECT auth.uid())
     AND p.state IN ('recovery_locked','bootstrap_pending','re_enrollment_pending')
 )
 ELSE private.mfa_error(false) IS NULL END
$$;
-- All 300 RLS policies already call (SELECT private.mfa_allowed()) as an initPlan.
