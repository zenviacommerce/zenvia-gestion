-- Additive amendment for draft #222. Not applied to production.
create or replace function private.mfa_recovery_peer_count(p_user_id uuid)
returns integer language sql stable security definer set search_path='' as $$
 select count(distinct a.user_id)::int
 from public.app_users target
 join public.app_users a on a.workspace_id=target.workspace_id and a.active and a.role='admin' and a.user_id<>p_user_id
 join private.mfa_principals p on p.user_id=a.user_id and p.state='active'
 where target.user_id=p_user_id and target.active and target.role='admin'
   and exists (
     select 1 from auth.mfa_factors f
     where f.user_id=a.user_id and f.id=any(p.admitted_factor_ids)
       and f.status::text='verified' and f.factor_type::text='totp'
   )
$$;
revoke all on function private.mfa_recovery_peer_count(uuid) from public,anon,authenticated;

-- Release is service-only. A second approver must be a distinct active,
-- admitted MFA administrator in the same workspace, not merely a text reference.
create or replace function public.security_mfa_release_enrollment(
 p_user_id uuid,p_reference text,p_session_id uuid default null,
 p_approver_user_id uuid default null
) returns void language plpgsql security definer set search_path='' as $$
declare v_peers integer;v_owner uuid;v_first text;
begin
 if length(trim(coalesce(p_reference,'')))<10 then raise exception 'MFA_REVIEW_REFERENCE_REQUIRED' using errcode='42501';end if;
 select authorization_reference into v_first from private.mfa_principals where user_id=p_user_id and state='recovery_locked' for update;
 if v_first is null then raise exception 'MFA_RECOVERY_NOT_PENDING' using errcode='42501';end if;
 if exists(select 1 from auth.mfa_factors where user_id=p_user_id and status::text='verified') then raise exception 'MFA_REMOVE_OLD_FACTORS_FIRST' using errcode='42501';end if;
 select private.mfa_recovery_peer_count(p_user_id) into v_peers;
 if v_peers>0 then
   if p_approver_user_id is null or p_approver_user_id=p_user_id or p_reference=v_first
      or not exists(
         select 1 from public.app_users t join public.app_users a
           on a.workspace_id=t.workspace_id and a.active and a.role='admin'
         join private.mfa_principals p on p.user_id=a.user_id and p.state='active'
         join auth.mfa_factors f on f.user_id=a.user_id and f.id=any(p.admitted_factor_ids)
         where t.user_id=p_user_id and a.user_id=p_approver_user_id and a.user_id<>p_user_id
           and f.status::text='verified' and f.factor_type::text='totp')
     then raise exception 'MFA_INDEPENDENT_APPROVAL_REQUIRED' using errcode='42501';end if;
 else
   -- An owner-operated break-glass requires an independently verified,
   -- service-only first reference and a DIFFERENT release reference.
   -- Operational actor identity MUST be verified by the trusted service workflow.
   if p_reference=v_first or p_approver_user_id is not null
     then raise exception 'MFA_OWNER_BREAK_GLASS_REQUIRED' using errcode='42501';end if;
 end if;
 if not exists(select 1 from auth.sessions s join private.mfa_principals p on p.user_id=s.user_id
    where s.id=p_session_id and s.user_id=p_user_id and s.created_at>=p.not_before
    and (s.not_after is null or s.not_after>now()))
 then raise exception 'MFA_APPROVED_SESSION_REQUIRED' using errcode='42501';end if;
 update private.mfa_principals set state='re_enrollment_pending',enrollment_session_id=p_session_id,
 authorization_expires_at=now()+interval '15 minutes',
 authorization_reference=v_first||' / '||p_reference
 where user_id=p_user_id and state='recovery_locked';
 insert into private.mfa_audit(user_id,event,reference)
 values(p_user_id,case when v_peers>0 then 'independent_recovery_authorized' else 'owner_break_glass_authorized' end,p_reference);
end $$;
revoke all on function public.security_mfa_release_enrollment(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.security_mfa_release_enrollment(uuid,text,uuid,uuid) to service_role;
-- Revoke old overloaded entry point so callers cannot bypass the peer check.
revoke all on function public.security_mfa_release_enrollment(uuid,text,uuid) from public,anon,authenticated,service_role;

-- Real peer approval is a separate JWT-authenticated operation. Passing an
-- approver UUID to service_role is NOT evidence of independent approval.
create table private.mfa_recovery_peer_approvals(
 target_user_id uuid not null references auth.users(id) on delete cascade,
 approver_user_id uuid not null references auth.users(id) on delete cascade,
 case_reference text not null,
 approved_at timestamptz not null default now(),
 approver_session_id uuid not null,
 primary key(target_user_id,approver_user_id,case_reference),
 check(target_user_id<>approver_user_id)
);
alter table private.mfa_recovery_peer_approvals enable row level security;
revoke all on private.mfa_recovery_peer_approvals from public,anon,authenticated;

create or replace function public.security_mfa_approve_recovery(p_target_user_id uuid,p_case_reference text)
returns void language plpgsql security definer set search_path='' as $$
declare v_session uuid;
begin
 if auth.uid() is null or p_target_user_id=auth.uid() then
   raise exception 'MFA_INDEPENDENT_APPROVAL_REQUIRED' using errcode='42501';
 end if;
 if length(trim(coalesce(p_case_reference,'')))<10 then
   raise exception 'MFA_REVIEW_REFERENCE_REQUIRED' using errcode='42501';
 end if;
 -- Force MFA even before global enrollment is enforced.
 if private.mfa_error(true,true) is not null then
   raise exception 'MFA_RECENT_APPROVAL_REQUIRED' using errcode='42501';
 end if;
 if not exists(
   select 1 from public.app_users target join public.app_users reviewer
    on reviewer.workspace_id=target.workspace_id
   where target.user_id=p_target_user_id and reviewer.user_id=auth.uid()
     and target.active and reviewer.active and target.role='admin'
     and reviewer.role='admin'
 ) then raise exception 'MFA_INDEPENDENT_APPROVAL_REQUIRED' using errcode='42501';end if;
 if not exists(
   select 1 from private.mfa_principals
   where user_id=p_target_user_id and state='recovery_locked'
   and authorization_reference=p_case_reference
 ) then raise exception 'MFA_CASE_REFERENCE_MISMATCH' using errcode='42501';end if;
 v_session:=(auth.jwt()->>'session_id')::uuid;
 insert into private.mfa_recovery_peer_approvals
   (target_user_id,approver_user_id,case_reference,approver_session_id)
 values(p_target_user_id,auth.uid(),p_case_reference,v_session)
 on conflict(target_user_id,approver_user_id,case_reference)
 do update set approved_at=now(),approver_session_id=excluded.approver_session_id;
 insert into private.mfa_audit(user_id,event,reference)
 values(p_target_user_id,'peer_mfa_approval',p_case_reference);
end $$;
revoke all on function public.security_mfa_approve_recovery(uuid,text) from public,anon;
grant execute on function public.security_mfa_approve_recovery(uuid,text) to authenticated;

-- Replace the service-only release with proof linked to the actual approver's
-- MFA-authenticated session and first-case reference.
create or replace function public.security_mfa_release_enrollment(
 p_user_id uuid,p_reference text,p_session_id uuid default null,
 p_approver_user_id uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_peers integer;v_first text;
begin
 if length(trim(coalesce(p_reference,'')))<10 then
    raise exception 'MFA_REVIEW_REFERENCE_REQUIRED' using errcode='42501';end if;
 select authorization_reference into v_first
 from private.mfa_principals where user_id=p_user_id and state='recovery_locked' for update;
 if v_first is null then raise exception 'MFA_RECOVERY_NOT_PENDING' using errcode='42501';end if;
 if exists(select 1 from auth.mfa_factors where user_id=p_user_id and status::text='verified')
 then raise exception 'MFA_REMOVE_OLD_FACTORS_FIRST' using errcode='42501';end if;
 select private.mfa_recovery_peer_count(p_user_id) into v_peers;
 if v_peers>0 then
   if p_approver_user_id is null or p_approver_user_id=p_user_id
      or p_reference=v_first or not exists(
       select 1 from private.mfa_recovery_peer_approvals ap
       join public.app_users target on target.user_id=ap.target_user_id
       join public.app_users reviewer on reviewer.user_id=ap.approver_user_id
          and reviewer.workspace_id=target.workspace_id
       join private.mfa_principals principal on principal.user_id=reviewer.user_id and principal.state='active'
       join auth.sessions sess on sess.id=ap.approver_session_id and sess.user_id=reviewer.user_id
       join auth.mfa_factors fac on fac.id=sess.factor_id and fac.user_id=reviewer.user_id
       where ap.target_user_id=p_user_id and ap.approver_user_id=p_approver_user_id
         and ap.case_reference=v_first and ap.approved_at>now()-interval '5 minutes'
         and reviewer.active and reviewer.role='admin'
         and fac.id=any(principal.admitted_factor_ids)
         and fac.factor_type::text='totp' and fac.status::text='verified'
         and sess.aal::text='aal2' and (sess.not_after is null or sess.not_after>now())
     ) then raise exception 'MFA_INDEPENDENT_APPROVAL_REQUIRED' using errcode='42501';end if;
 else
   -- Operator must verify owner identity outside this trusted service process.
   if p_reference=v_first or p_approver_user_id is not null then
     raise exception 'MFA_OWNER_BREAK_GLASS_REQUIRED' using errcode='42501';end if;
 end if;
 if not exists(select 1 from auth.sessions s
      join private.mfa_principals p on p.user_id=s.user_id
      where s.id=p_session_id and s.user_id=p_user_id and s.created_at>=p.not_before
      and (s.not_after is null or s.not_after>now()))
 then raise exception 'MFA_APPROVED_SESSION_REQUIRED' using errcode='42501';end if;
 update private.mfa_principals set state='re_enrollment_pending',
  enrollment_session_id=p_session_id,authorization_expires_at=now()+interval '15 minutes',
  authorization_reference=v_first||' / '||p_reference
 where user_id=p_user_id and state='recovery_locked';
 insert into private.mfa_audit(user_id,event,reference)
 values(p_user_id,case when v_peers>0 then 'independent_recovery_authorized'
 else 'owner_break_glass_authorized' end,p_reference);
 delete from private.mfa_recovery_peer_approvals where target_user_id=p_user_id;
end $$;
