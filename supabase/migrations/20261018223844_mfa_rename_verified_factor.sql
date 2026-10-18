BEGIN;
CREATE FUNCTION public.security_mfa_rename_factor(p_factor_id uuid,p_friendly_name text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE reason text;
BEGIN
 reason:=private.mfa_error(true,true);
 IF reason IS NOT NULL THEN RAISE EXCEPTION '%',reason USING errcode='42501';END IF;
 IF length(trim(p_friendly_name)) NOT BETWEEN 2 AND 60 THEN RAISE EXCEPTION 'MFA_INVALID_FACTOR_NAME';END IF;
 UPDATE auth.mfa_factors SET friendly_name=trim(p_friendly_name) WHERE user_id=auth.uid() AND id=p_factor_id AND status='verified' AND factor_type='totp' AND EXISTS(SELECT 1 FROM private.mfa_principals p WHERE p.user_id=auth.uid() AND p.state='active' AND p_factor_id=ANY(p.admitted_factor_ids));
 IF NOT FOUND THEN RAISE EXCEPTION 'MFA_FACTOR_NOT_ADMITTED';END IF;
 INSERT INTO private.mfa_audit(user_id,event) VALUES(auth.uid(),'factor_renamed');
END $$;
REVOKE ALL ON FUNCTION public.security_mfa_rename_factor(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.security_mfa_rename_factor(uuid,text) TO authenticated;
COMMIT;
