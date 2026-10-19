CREATE OR REPLACE FUNCTION public.security_mfa_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
;
