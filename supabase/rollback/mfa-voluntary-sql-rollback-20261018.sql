-- Prepared rollback for voluntary MFA migration. NOT automatically executed.
-- Refuses rollback if any enrollment was initiated to avoid stranded sessions.
BEGIN;
DO $rb$BEGIN
 IF EXISTS(SELECT 1 FROM private.mfa_principals WHERE state='self_enrollment_pending') THEN
   RAISE EXCEPTION 'ROLLBACK_DENIED: active voluntary enrollment';
 END IF;
END $rb$;
REVOKE ALL ON FUNCTION public.security_mfa_begin_self_enrollment() FROM PUBLIC,anon,authenticated,service_role;
DROP FUNCTION public.security_mfa_begin_self_enrollment();
ALTER TABLE private.mfa_principals DROP CONSTRAINT mfa_principals_state_check;
ALTER TABLE private.mfa_principals ADD CONSTRAINT mfa_principals_state_check CHECK(state IN('bootstrap_pending','active','recovery_locked','re_enrollment_pending'));
CREATE OR REPLACE FUNCTION private.mfa_activation_findings()
 RETURNS TABLE(entry text, reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select n.nspname||'.'||c.relname,'exposed table lacks restrictive MFA policies' from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in('r','p') and (n.nspname='public' or(n.nspname='storage' and c.relname='objects'))
 and (has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE'))
 and (not c.relrowsecurity or 4<>(select count(*) from pg_policy p where p.polrelid=c.oid and p.polname in('mfa_select_gate','mfa_insert_gate','mfa_update_gate','mfa_delete_gate') and not p.polpermissive))
 union all
 select n.nspname||'.'||c.relname,'exposed view needs explicit invoker/RLS or grant review' from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind in('v','m') and(has_table_privilege('authenticated',c.oid,'SELECT') or has_table_privilege('anon',c.oid,'SELECT'))
 and(c.relkind='m' or not coalesce(c.reloptions,'{}') @> array['security_invoker=true'])
 union all
 select p.oid::regprocedure::text,'unwrapped or changed public definer' from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prosecdef and p.prokind='f' and p.prorettype not in('trigger'::regtype,'event_trigger'::regtype)
 and has_function_privilege('authenticated',p.oid,'execute')
 and p.proname not in('security_mfa_status','security_mfa_assert','security_mfa_bridge_allowed','security_mfa_prepare_enrollment','security_mfa_complete_enrollment','security_mfa_authorize_enrollment','security_mfa_release_enrollment','security_mfa_approve_recovery','security_mfa_begin_factor_add','security_mfa_forget_factor')
 and not exists(select 1 from private.mfa_function_manifest m where m.function_oid=p.oid and m.wrapper_hash=md5(pg_get_functiondef(p.oid)))
$function$

CREATE OR REPLACE FUNCTION public.security_mfa_complete_enrollment(p_factor_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p private.mfa_principals; s auth.sessions; proof numeric;begin
 if auth.uid() is null then raise exception 'MFA_SESSION_REQUIRED' using errcode='42501';end if;
 select * into p from private.mfa_principals where user_id=auth.uid() for update;
 select * into s from auth.sessions where id=(auth.jwt()->>'session_id')::uuid and user_id=auth.uid();
 if p.user_id is null or s.id is null or p.state not in('bootstrap_pending','re_enrollment_pending') or p.authorization_expires_at is null or p.authorization_expires_at<=now() or p.enrollment_factor_id is distinct from p_factor_id or p.enrollment_session_id is distinct from s.id or s.factor_id is distinct from p_factor_id or s.created_at<p.not_before or (s.not_after is not null and s.not_after<=now()) or s.aal::text<>'aal2' or auth.jwt()->>'aal'<>'aal2' then raise exception 'MFA_ENROLLMENT_NOT_AUTHORIZED' using errcode='42501';end if;
 select max((e->>'timestamp')::numeric) into proof from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) e where e->>'method'='totp' and e->>'timestamp' ~ '^[0-9]+$';
 if proof is null or proof<extract(epoch from now())-300 or proof>extract(epoch from now())+30 or not exists(select 1 from auth.mfa_amr_claims where session_id=s.id and authentication_method='totp' and abs(extract(epoch from updated_at)-proof)<2) or not exists(select 1 from auth.mfa_factors where id=p_factor_id and user_id=auth.uid() and factor_type::text='totp' and status::text='verified') or not exists(select 1 from auth.mfa_challenges where factor_id=p_factor_id and verified_at>=p.enrollment_started_at and verified_at>now()-interval '5 minutes') then raise exception 'MFA_FACTOR_PROOF_REQUIRED' using errcode='42501';end if;
 update private.mfa_principals set state='active',admitted_factor_ids=array(select distinct x from unnest(admitted_factor_ids||array[p_factor_id]) x),enrollment_factor_id=null,enrollment_session_id=null,enrollment_started_at=null,authorization_expires_at=null where user_id=auth.uid();
 insert into private.mfa_audit(user_id,event,reference) values(auth.uid(),'enrollment_completed',p.authorization_reference);
end $function$

CREATE OR REPLACE FUNCTION public.security_mfa_prepare_enrollment(p_factor_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p private.mfa_principals; s uuid;begin
 if auth.uid() is null then raise exception 'MFA_SESSION_REQUIRED' using errcode='42501';end if;
 s:=(auth.jwt()->>'session_id')::uuid;
 select * into p from private.mfa_principals where user_id=auth.uid() for update;
 if not found or p.state not in('bootstrap_pending','re_enrollment_pending') or p.authorization_expires_at is null or p.authorization_expires_at<=now() or not exists(select 1 from auth.sessions where id=s and user_id=auth.uid() and created_at>=p.not_before and (not_after is null or not_after>now())) then raise exception 'MFA_ENROLLMENT_NOT_AUTHORIZED' using errcode='42501';end if;
 if p.enrollment_session_id is not null and p.enrollment_session_id<>s then raise exception 'MFA_ENROLLMENT_NOT_AUTHORIZED' using errcode='42501';end if;
 if p.enrollment_factor_id is not null and (p.enrollment_factor_id<>p_factor_id or p.enrollment_session_id<>s) then raise exception 'MFA_ENROLLMENT_ALREADY_PENDING' using errcode='42501';end if;
 if not exists(select 1 from auth.mfa_factors where id=p_factor_id and user_id=auth.uid() and factor_type::text='totp' and status::text='unverified') then raise exception 'MFA_UNVERIFIED_FACTOR_REQUIRED' using errcode='42501';end if;
 update private.mfa_principals set enrollment_factor_id=p_factor_id,enrollment_session_id=s,enrollment_started_at=coalesce(enrollment_started_at,now()) where user_id=auth.uid();
end $function$

CREATE OR REPLACE FUNCTION public.security_mfa_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p private.mfa_principals; reason text;begin
 if auth.uid() is null then raise exception 'MFA_SESSION_REQUIRED' using errcode='42501';end if;
 if exists(
  select 1 from private.mfa_configuration c where c.singleton and c.enabled
  and c.cohort_user_ids is not null and not ((select auth.uid())=any(c.cohort_user_ids))
 ) then return jsonb_build_object('state','ready','factor_ids','[]'::jsonb);end if;
 select * into p from private.mfa_principals where user_id=auth.uid();
 if p.state='recovery_locked' then return jsonb_build_object('state','recovery_locked','factor_ids','[]'::jsonb,'recovery_session_id',(select id from auth.sessions where user_id=auth.uid() and id::text=auth.jwt()->>'session_id' and created_at>=p.not_before and(not_after is null or not_after>now())));end if;
 if p.user_id is null and (select private.mfa_required()) and private.mfa_is_admin() then return jsonb_build_object('state','recovery_locked','factor_ids','[]'::jsonb);end if;
 if p.state in('bootstrap_pending','re_enrollment_pending') then
  if p.authorization_expires_at is null or p.authorization_expires_at<=now() then return jsonb_build_object('state','recovery_locked','factor_ids','[]'::jsonb);end if;
  return jsonb_build_object('state','enrollment_required','factor_ids','[]'::jsonb,'enrollment_factor_id',case when p.enrollment_session_id::text=auth.jwt()->>'session_id' then p.enrollment_factor_id end);
 end if;
 if not (select private.mfa_required()) or not private.mfa_is_admin() then return jsonb_build_object('state','ready','factor_ids',coalesce(to_jsonb(p.admitted_factor_ids),'[]'::jsonb));end if;
 reason:=private.mfa_error(false);
 return jsonb_build_object('state',case when reason is null then 'ready' when reason in('MFA_REQUIRED','MFA_RECENT_REQUIRED','MFA_FACTOR_REQUIRED') and exists(select 1 from auth.mfa_factors f where f.id=any(p.admitted_factor_ids) and f.user_id=auth.uid() and f.factor_type::text='totp' and f.status::text='verified') then 'challenge_required' else 'recovery_locked' end,'factor_ids',coalesce((select jsonb_agg(f.id) from auth.mfa_factors f where f.id=any(p.admitted_factor_ids) and f.user_id=auth.uid() and f.factor_type::text='totp' and f.status::text='verified'),'[]'::jsonb));
end $function$
COMMIT;
SELECT enabled,cohort_user_ids FROM private.mfa_configuration WHERE singleton=true;
