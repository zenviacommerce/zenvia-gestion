-- Read-only acceptance rehearsal: policy changes are isolated and always rolled back.
-- No token/factor/session is created, modified or revoked. SQL claims are not HTTP/JWT tests.
BEGIN;
SET LOCAL statement_timeout='8s';
DO $test$
DECLARE pilot uuid; c jsonb; other record; outside_admins int:=0; outside_users int:=0; plan_ok boolean; owner_bridge boolean;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM private.mfa_configuration WHERE singleton AND NOT enabled AND cohort_user_ids IS NULL) THEN RAISE EXCEPTION 'unexpected MFA baseline';END IF;
 IF EXISTS(SELECT 1 FROM private.mfa_activation_findings()) THEN RAISE EXCEPTION 'integrity findings';END IF;
 SELECT id INTO STRICT pilot FROM auth.users WHERE lower(email)='info@zenviacommerce.com';
 IF NOT EXISTS(SELECT 1 FROM private.mfa_principals p WHERE p.user_id=pilot AND p.state='active' AND (SELECT count(*) FROM auth.mfa_factors f WHERE f.user_id=pilot AND f.id=ANY(p.admitted_factor_ids) AND f.factor_type='totp' AND f.status='verified')>=2) THEN RAISE EXCEPTION 'two admitted factors required';END IF;
 SELECT jsonb_build_object('sub',pilot,'role','authenticated','aal','aal2','session_id',s.id,'amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',floor(extract(epoch FROM a.updated_at))))) INTO c
 FROM auth.sessions s JOIN auth.mfa_amr_claims a ON a.session_id=s.id AND a.authentication_method='totp'
 WHERE s.user_id=pilot AND s.aal='aal2' AND (s.not_after IS NULL OR s.not_after>now()) ORDER BY s.created_at DESC LIMIT 1;
 IF c IS NULL THEN RAISE EXCEPTION 'live AAL2 session/proof required';END IF;
 UPDATE private.mfa_configuration SET enabled=true,cohort_user_ids=ARRAY[pilot] WHERE singleton;
 PERFORM set_config('request.jwt.claims',(c||jsonb_build_object('aal','aal1'))::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 BEGIN
  PERFORM public.security_mfa_assert(false);RAISE EXCEPTION 'AAL1 unexpectedly allowed';
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'MFA_REQUIRED' THEN RAISE;END IF;END;
 IF public.security_mfa_status()->>'state'<>'challenge_required' THEN RAISE EXCEPTION 'AAL1 challenge missing';END IF;
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claims',c::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM public.security_mfa_assert(false);
 IF public.security_mfa_status()->>'state'<>'ready' THEN RAISE EXCEPTION 'AAL2 not ready';END IF;
 PERFORM public.orders_dashboard_page_v1(p_from=>date_trunc('quarter',now())::date,p_to=>current_date,p_page_size=>1);
 EXECUTE 'RESET ROLE';
 FOR other IN SELECT user_id,role FROM public.app_users WHERE active AND user_id<>pilot LOOP
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',other.user_id,'aal','aal1','role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';PERFORM public.security_mfa_assert(false);EXECUTE 'RESET ROLE';
  IF other.role='admin' THEN outside_admins:=outside_admins+1;ELSE outside_users:=outside_users+1;END IF;
 END LOOP;
 IF outside_admins<1 OR outside_users<1 THEN RAISE EXCEPTION 'outside cohort comparison subjects missing';END IF;
 plan_ok:=public.security_mfa_bridge_allowed('system:plan-sync','platform@zenviacommerce.com','apply_plan_snapshot');
 owner_bridge:=public.security_mfa_bridge_allowed('verified-platform-actor','info@zenviacommerce.com','list_users');
 IF NOT plan_ok THEN RAISE EXCEPTION 'plan sync blocked';END IF;
 UPDATE private.mfa_configuration SET enabled=false WHERE singleton;
 PERFORM set_config('request.jwt.claims',(c||jsonb_build_object('aal','aal1'))::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';PERFORM public.security_mfa_assert(false);EXECUTE 'RESET ROLE';
 IF (SELECT enabled FROM private.mfa_configuration WHERE singleton) THEN RAISE EXCEPTION 'kill switch failed';END IF;
 PERFORM set_config('mfa.preflight_receipt',jsonb_build_object('pilot_aal1_denied',true,'pilot_aal2_ready',true,'orders_rpc_aal2',true,'outside_admins',outside_admins,'outside_users',outside_users,'plan_sync',plan_ok,'owner_platform_bridge',owner_bridge,'kill_switch',true)::text,true);
END $test$;
SELECT current_setting('mfa.preflight_receipt')::jsonb AS receipt;
ROLLBACK;
