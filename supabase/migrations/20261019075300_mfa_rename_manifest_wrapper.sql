-- Preserve the preexisting audited rename implementation and register the public MFA wrapper.
DO $migration$
DECLARE
  old_definition text;
  impl_definition text;
  fn_oid oid := 'public.security_mfa_rename_factor(uuid,text)'::regprocedure::oid;
BEGIN
  IF EXISTS (SELECT 1 FROM private.mfa_function_manifest WHERE function_oid=fn_oid) THEN
    RAISE EXCEPTION 'RENAME_ALREADY_WRAPPED';
  END IF;
  old_definition := pg_get_functiondef(fn_oid);
  IF old_definition NOT LIKE '%private.mfa_error(true,true)%'
     OR old_definition NOT LIKE '%user_id=auth.uid()%'
     OR old_definition NOT LIKE '%p_factor_id=ANY(p.admitted_factor_ids)%' THEN
    RAISE EXCEPTION 'RENAME_IMPL_CHANGED_ABORT';
  END IF;
  impl_definition := replace(old_definition,
       'FUNCTION public.security_mfa_rename_factor(',
       'FUNCTION private.mfa_impl_rename_factor(');
  IF impl_definition = old_definition THEN RAISE EXCEPTION 'RENAME_COPY_FAILED'; END IF;
  EXECUTE impl_definition;
  REVOKE ALL ON FUNCTION private.mfa_impl_rename_factor(uuid,text) FROM PUBLIC,anon,authenticated;
  CREATE OR REPLACE FUNCTION public.security_mfa_rename_factor(p_factor_id uuid,p_friendly_name text)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $wrapper$
  BEGIN
    PERFORM public.security_mfa_assert(false);
    PERFORM private.mfa_impl_rename_factor(p_factor_id,p_friendly_name);
  END $wrapper$;
  REVOKE ALL ON FUNCTION public.security_mfa_rename_factor(uuid,text) FROM PUBLIC,anon;
  GRANT EXECUTE ON FUNCTION public.security_mfa_rename_factor(uuid,text) TO authenticated;
  INSERT INTO private.mfa_function_manifest(signature,function_oid,implementation,original_definition,wrapper_hash)
  VALUES ('public.security_mfa_rename_factor(uuid,text)',
          'public.security_mfa_rename_factor(uuid,text)'::regprocedure::oid,
          'private.mfa_impl_rename_factor(uuid,text)'::regprocedure,
          old_definition,
          md5(pg_get_functiondef('public.security_mfa_rename_factor(uuid,text)'::regprocedure)));
  IF EXISTS (SELECT 1 FROM private.mfa_activation_findings()) THEN
    RAISE EXCEPTION 'MFA_INTEGRITY_FINDINGS_AFTER_RENAME_WRAP: %', (SELECT string_agg(entry || ': ' || reason, '; ') FROM private.mfa_activation_findings());
  END IF;
END $migration$;
