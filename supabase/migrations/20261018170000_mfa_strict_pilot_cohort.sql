BEGIN;
-- A service-to-service bridge has no auth.uid(); the trusted Platform actor is explicit.
-- Default NULL remains safe: it never bypasses enforcement when enabled.
DROP FUNCTION IF EXISTS public.security_mfa_bridge_allowed();
CREATE FUNCTION public.security_mfa_bridge_allowed(p_actor_user_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE
 WHEN NOT c.enabled THEN NOT EXISTS (
   SELECT 1 FROM private.mfa_principals p
   WHERE p.state IN ('recovery_locked','re_enrollment_pending','bootstrap_pending'))
 WHEN c.cohort_user_ids IS NULL THEN FALSE -- global enforcement: no delegation
 WHEN p_actor_user_id IS NULL THEN FALSE -- no verifiable actor: fail closed
 WHEN p_actor_user_id=ANY(c.cohort_user_ids) THEN FALSE
 ELSE EXISTS(
   SELECT 1 FROM public.app_users u WHERE u.user_id=p_actor_user_id AND u.active
   UNION ALL
   SELECT 1 FROM public.platform_admins a WHERE a.user_id=p_actor_user_id AND a.active
 )
 END
 FROM private.mfa_configuration c WHERE c.singleton
$$;
REVOKE ALL ON FUNCTION public.security_mfa_bridge_allowed(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.security_mfa_bridge_allowed(uuid) TO service_role;

-- Pilot cohort is authoritative: an old enforced bit cannot expand it.
CREATE OR REPLACE FUNCTION private.mfa_required()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT c.enabled AND
 (c.cohort_user_ids IS NULL OR (SELECT auth.uid())=ANY(c.cohort_user_ids))
 FROM private.mfa_configuration c WHERE c.singleton
$$;

-- Keep the existing disabled-MFA recovery lock behavior. With an enabled
-- limited pilot, no noncohort principal should incur MFA checks or locks.
CREATE OR REPLACE FUNCTION private.mfa_allowed()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE
 WHEN NOT c.enabled THEN NOT EXISTS (
   SELECT 1 FROM private.mfa_principals p
   WHERE p.user_id=(SELECT auth.uid())
   AND p.state IN ('recovery_locked','bootstrap_pending','re_enrollment_pending'))
 WHEN c.cohort_user_ids IS NOT NULL AND NOT ((SELECT auth.uid())=ANY(c.cohort_user_ids)) THEN TRUE
 ELSE private.mfa_error(false) IS NULL END
 FROM private.mfa_configuration c WHERE c.singleton
$$;
COMMIT;
