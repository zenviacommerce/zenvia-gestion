-- Voluntary first-factor enrollment, independent of cohort enforcement.
-- Security-critical: recovery_locked/re_enrollment_pending NEVER become self-service.
BEGIN;
ALTER TABLE private.mfa_principals DROP CONSTRAINT IF EXISTS mfa_principals_state_check;
ALTER TABLE private.mfa_principals ADD CONSTRAINT mfa_principals_state_check
  CHECK (state IN ('bootstrap_pending','active','recovery_locked','re_enrollment_pending','self_enrollment_pending'));

CREATE FUNCTION public.security_mfa_begin_self_enrollment() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user uuid:=auth.uid(); v_session uuid; v_state text;
BEGIN
 IF v_user IS NULL OR NOT private.mfa_is_admin() THEN
   RAISE EXCEPTION 'MFA_SELF_ENROLLMENT_ADMIN_REQUIRED' USING errcode='42501';
 END IF;
 IF private.mfa_required() THEN
   RAISE EXCEPTION 'MFA_SELF_ENROLLMENT_ALREADY_REQUIRED' USING errcode='42501';
 END IF;
 IF coalesce(auth.jwt()->>'session_id','') !~ '^[0-9a-fA-F-]{36}$' THEN
   RAISE EXCEPTION 'MFA_SESSION_REQUIRED' USING errcode='42501';
 END IF;
 v_session:=(auth.jwt()->>'session_id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=v_session AND s.user_id=v_user
    AND (s.not_after IS NULL OR s.not_after>now())) THEN
   RAISE EXCEPTION 'MFA_SESSION_REQUIRED' USING errcode='42501';
 END IF;
 -- Never allow initial registration if any verified factor exists, admitted or not.
 IF EXISTS(SELECT 1 FROM auth.mfa_factors f WHERE f.user_id=v_user
   AND f.factor_type::text='totp' AND f.status::text='verified') THEN
   RAISE EXCEPTION 'MFA_SELF_ENROLLMENT_FACTOR_EXISTS' USING errcode='42501';
 END IF;
 SELECT state INTO v_state FROM private.mfa_principals WHERE user_id=v_user FOR UPDATE;
 IF v_state IS NOT NULL AND (v_state<>'self_enrollment_pending' OR EXISTS(
   SELECT 1 FROM private.mfa_principals p WHERE p.user_id=v_user
   AND p.state='self_enrollment_pending' AND p.authorization_expires_at>now()
 )) THEN
   RAISE EXCEPTION 'MFA_SELF_ENROLLMENT_DENIED' USING errcode='42501';
 END IF;
 INSERT INTO private.mfa_principals(user_id,state,not_before,enrollment_session_id,
    enrollment_factor_id,enrollment_started_at,authorization_expires_at,authorization_reference)
 VALUES(v_user,'self_enrollment_pending',now(),v_session,null,null,now()+interval '15 minutes',
    'self-enrollment:'||v_session::text)
 ON CONFLICT(user_id) DO UPDATE SET state=excluded.state,not_before=excluded.not_before,
   enrollment_session_id=excluded.enrollment_session_id,enrollment_factor_id=null,
   enrollment_started_at=null,authorization_expires_at=excluded.authorization_expires_at,
   authorization_reference=excluded.authorization_reference
 WHERE private.mfa_principals.state='self_enrollment_pending'
   AND private.mfa_principals.authorization_expires_at<=now();
 INSERT INTO private.mfa_audit(user_id,event,reference)
 VALUES(v_user,'self_enrollment_started','self-enrollment');
END $$;
REVOKE ALL ON FUNCTION public.security_mfa_begin_self_enrollment() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.security_mfa_begin_self_enrollment() TO authenticated;

create or replace function public.security_mfa_prepare_enrollment(p_factor_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare p private.mfa_principals; s uuid;begin
 if auth.uid() is null then raise exception 'MFA_SESSION_REQUIRED' using errcode='42501';end if;
 s:=(auth.jwt()->>'session_id')::uuid;
 select * into p from private.mfa_principals where user_id=auth.uid() for update;
 if not found or p.state not in('bootstrap_pending','re_enrollment_pending','self_enrollment_pending') or p.authorization_expires_at is null or p.authorization_expires_at<=now() or not exists(select 1 from auth.sessions where id=s and user_id=auth.uid() and (p.state='self_enrollment_pending' or created_at>=p.not_before) and (not_after is null or not_after>now())) then raise exception 'MFA_ENROLLMENT_NOT_AUTHORIZED' using errcode='42501';end if;
 if p.enrollment_session_id is not null and p.enrollment_session_id<>s then raise exception 'MFA_ENROLLMENT_NOT_AUTHORIZED' using errcode='42501';end if;
 if p.enrollment_factor_id is not null and (p.enrollment_factor_id<>p_factor_id or p.enrollment_session_id<>s) then raise exception 'MFA_ENROLLMENT_ALREADY_PENDING' using errcode='42501';end if;
 if not exists(select 1 from auth.mfa_factors where id=p_factor_id and user_id=auth.uid() and factor_type::text='totp' and status::text='unverified') then raise exception 'MFA_UNVERIFIED_FACTOR_REQUIRED' using errcode='42501';end if;
 update private.mfa_principals set enrollment_factor_id=p_factor_id,enrollment_session_id=s,enrollment_started_at=coalesce(enrollment_started_at,now()) where user_id=auth.uid();
end $$;

create or replace function public.security_mfa_complete_enrollment(p_factor_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare p private.mfa_principals; s auth.sessions; proof numeric;begin
 if auth.uid() is null then raise exception 'MFA_SESSION_REQUIRED' using errcode='42501';end if;
 select * into p from private.mfa_principals where user_id=auth.uid() for update;
 select * into s from auth.sessions where id=(auth.jwt()->>'session_id')::uuid and user_id=auth.uid();
 if p.user_id is null or s.id is null or p.state not in('bootstrap_pending','re_enrollment_pending','self_enrollment_pending') or p.authorization_expires_at is null or p.authorization_expires_at<=now() or p.enrollment_factor_id is distinct from p_factor_id or p.enrollment_session_id is distinct from s.id or s.factor_id is distinct from p_factor_id or (p.state<>'self_enrollment_pending' and s.created_at<p.not_before) or (s.not_after is not null and s.not_after<=now()) or s.aal::text<>'aal2' or auth.jwt()->>'aal'<>'aal2' then raise exception 'MFA_ENROLLMENT_NOT_AUTHORIZED' using errcode='42501';end if;
 select max((e->>'timestamp')::numeric) into proof from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) e where e->>'method'='totp' and e->>'timestamp' ~ '^[0-9]+$';
 if proof is null or proof<extract(epoch from now())-300 or proof>extract(epoch from now())+30 or not exists(select 1 from auth.mfa_amr_claims where session_id=s.id and authentication_method='totp' and abs(extract(epoch from updated_at)-proof)<2) or not exists(select 1 from auth.mfa_factors where id=p_factor_id and user_id=auth.uid() and factor_type::text='totp' and status::text='verified') or not exists(select 1 from auth.mfa_challenges where factor_id=p_factor_id and verified_at>=p.enrollment_started_at and verified_at>now()-interval '5 minutes') then raise exception 'MFA_FACTOR_PROOF_REQUIRED' using errcode='42501';end if;
 update private.mfa_principals set state='active',admitted_factor_ids=array(select distinct x from unnest(admitted_factor_ids||array[p_factor_id]) x),enrollment_factor_id=null,enrollment_session_id=null,enrollment_started_at=null,authorization_expires_at=null where user_id=auth.uid();
 insert into private.mfa_audit(user_id,event,reference) values(auth.uid(),'enrollment_completed',p.authorization_reference);
end $$;

create or replace function public.security_mfa_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p private.mfa_principals; reason text; verified_factors jsonb;begin
 if auth.uid() is null then raise exception 'MFA_SESSION_REQUIRED' using errcode='42501';end if;
 select * into p from private.mfa_principals where user_id=auth.uid();
 if p.state='recovery_locked' then return jsonb_build_object('state','recovery_locked','factor_ids','[]'::jsonb,'recovery_session_id',(select id from auth.sessions where user_id=auth.uid() and id::text=auth.jwt()->>'session_id' and created_at>=p.not_before and(not_after is null or not_after>now())));end if;
 if p.user_id is null and (select private.mfa_required()) and private.mfa_is_admin() then return jsonb_build_object('state','recovery_locked','factor_ids','[]'::jsonb);end if;
 if p.state='self_enrollment_pending' then
  if p.authorization_expires_at is null or p.authorization_expires_at<=now() then
    return jsonb_build_object('state','ready','factor_ids','[]'::jsonb);
  end if;
  return jsonb_build_object('state','enrollment_required','factor_ids','[]'::jsonb,
    'enrollment_factor_id',case when p.enrollment_session_id::text=auth.jwt()->>'session_id' then p.enrollment_factor_id end);
 end if;
 if p.state in('bootstrap_pending','re_enrollment_pending') then
  if p.authorization_expires_at is null or p.authorization_expires_at<=now() then return jsonb_build_object('state','recovery_locked','factor_ids','[]'::jsonb);end if;
  return jsonb_build_object('state','enrollment_required','factor_ids','[]'::jsonb,'enrollment_factor_id',case when p.enrollment_session_id::text=auth.jwt()->>'session_id' then p.enrollment_factor_id end);
 end if;
 -- Auth enforces the 15-minute AAL1 session limit independent of the app's flag.
 -- Once a verified, admitted factor exists, challenge AAL1 even outside cohort.
 select coalesce(jsonb_agg(f.id),'[]'::jsonb) into verified_factors
 from auth.mfa_factors f where f.user_id=auth.uid() and f.id=any(coalesce(p.admitted_factor_ids,'{}'::uuid[]))
   and f.factor_type::text='totp' and f.status::text='verified';
 -- Do not mark a user ready if GoTrue knows a verified factor that is not
 -- admitted by our application. This requires protected recovery, not a bypass.
 if exists(select 1 from auth.mfa_factors f where f.user_id=auth.uid()
   and f.factor_type::text='totp' and f.status::text='verified')
   and jsonb_array_length(verified_factors)=0 then
   return jsonb_build_object('state','recovery_locked','factor_ids','[]'::jsonb);
 end if;
 if jsonb_array_length(verified_factors)>0 and auth.jwt()->>'aal'<>'aal2' then
   return jsonb_build_object('state','challenge_required','factor_ids',verified_factors);
 end if;
 if not (select private.mfa_required()) or not private.mfa_is_admin() then
   return jsonb_build_object('state','ready','factor_ids',verified_factors);
 end if;
 reason:=private.mfa_error(false);
 return jsonb_build_object('state',case when reason is null then 'ready' when reason in('MFA_REQUIRED','MFA_RECENT_REQUIRED','MFA_FACTOR_REQUIRED') and exists(select 1 from auth.mfa_factors f where f.id=any(p.admitted_factor_ids) and f.user_id=auth.uid() and f.factor_type::text='totp' and f.status::text='verified') then 'challenge_required' else 'recovery_locked' end,'factor_ids',coalesce((select jsonb_agg(f.id) from auth.mfa_factors f where f.id=any(p.admitted_factor_ids) and f.user_id=auth.uid() and f.factor_type::text='totp' and f.status::text='verified'),'[]'::jsonb));
end $$;
COMMIT;
