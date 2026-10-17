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
