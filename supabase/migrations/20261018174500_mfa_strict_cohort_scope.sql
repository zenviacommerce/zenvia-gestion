-- Scope the MFA pilot strictly to cohort identities; no flag changes.
-- The legacy zero-argument bridge check remains fail-closed for old clients.
-- New Platform edge code must pass a verified Platform actor and action.
BEGIN;

CREATE OR REPLACE FUNCTION private.mfa_required() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(c.enabled,false)
    AND (c.cohort_user_ids IS NULL OR auth.uid()=ANY(c.cohort_user_ids))
 FROM private.mfa_configuration c WHERE c.singleton
$$;

CREATE OR REPLACE FUNCTION private.mfa_error(p_recent boolean DEFAULT false, p_force boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j jsonb:=auth.jwt(); p private.mfa_principals; s auth.sessions; proof_time numeric; enabled boolean;
begin
 select * into p from private.mfa_principals where user_id=auth.uid();
 if p.state='recovery_locked' then return 'MFA_RECOVERY_LOCKED';end if;
 select private.mfa_required() into enabled;
 -- Outside an explicit pilot cohort, pre-existing bootstrap/pending states
 -- must not unexpectedly lock a different administrator.
 if p.state in('bootstrap_pending','re_enrollment_pending')
    and (coalesce(enabled,false) or p_force
         or not coalesce((select c.enabled and c.cohort_user_ids is not null
            and not (auth.uid()=any(c.cohort_user_ids))
            from private.mfa_configuration c where c.singleton),false))
 then return 'MFA_RECOVERY_LOCKED';end if;
 if not p_force and not coalesce(enabled,false) then return null; end if;
 -- This helper never assigns a role: existing role/tenant checks remain authoritative.
 if not p_force and not private.mfa_is_admin() then return null; end if;
 if exists(select 1 from public.app_users a left join public.workspaces w on w.id=a.data_owner_id where a.user_id=auth.uid() and (not a.active or w.status not in('active','trialing') or w.id is null)) then return 'ACCESS_DISABLED'; end if;
 if p.user_id is null or p.state<>'active' then return 'MFA_RECOVERY_LOCKED'; end if;
 if coalesce(j->>'aal','')<>'aal2' then return 'MFA_REQUIRED'; end if;
 if coalesce(j->>'session_id','') !~ '^[0-9a-fA-F-]{36}$' then return 'MFA_SESSION_REQUIRED'; end if;
 select * into s from auth.sessions where id=(j->>'session_id')::uuid and user_id=auth.uid();
 if not found or s.created_at<p.not_before or (s.not_after is not null and s.not_after<=now()) or s.aal::text<>'aal2' then return 'MFA_SESSION_REQUIRED'; end if;
 if s.factor_id is null or not(s.factor_id=any(p.admitted_factor_ids)) or not exists(select 1 from auth.mfa_factors f where f.id=s.factor_id and f.user_id=auth.uid() and f.factor_type::text='totp' and f.status::text='verified') then return 'MFA_FACTOR_REQUIRED'; end if;
 select max((e->>'timestamp')::numeric) into proof_time from jsonb_array_elements(coalesce(j->'amr','[]'::jsonb)) e where e->>'method'='totp' and e->>'timestamp' ~ '^[0-9]+$';
 if proof_time is null or proof_time>extract(epoch from now())+30 or not exists(select 1 from auth.mfa_amr_claims a where a.session_id=s.id and a.authentication_method='totp' and abs(extract(epoch from a.updated_at)-proof_time)<2) then return 'MFA_REQUIRED'; end if;
 if p_recent and proof_time<extract(epoch from now())-300 then return 'MFA_RECENT_REQUIRED'; end if;
 return null;
end $function$
;

CREATE OR REPLACE FUNCTION private.mfa_promoted_admin()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n jsonb:=to_jsonb(new);o jsonb:=to_jsonb(old);begin
 if (select c.enabled and (c.cohort_user_ids is null or (n->>'user_id')::uuid=any(c.cohort_user_ids)) from private.mfa_configuration c where c.singleton) and (n->>'active')::boolean and(TG_TABLE_NAME='platform_admins' or n->>'role'='admin') and(TG_OP='INSERT' or coalesce(o->>'active','false')<>'true' or(TG_TABLE_NAME='app_users' and o->>'role' is distinct from 'admin')) then
  insert into private.mfa_principals(user_id,state,not_before,authorization_reference) values((n->>'user_id')::uuid,'bootstrap_pending',now(),'role-promotion')
  on conflict(user_id) do update set state='bootstrap_pending',enforced=true,not_before=now(),admitted_factor_ids='{}',enrollment_factor_id=null,enrollment_session_id=null,enrollment_started_at=null,authorization_expires_at=null,authorization_reference='role-promotion';
  insert into private.mfa_audit(user_id,event) values((n->>'user_id')::uuid,'promotion_pending');
 end if;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.security_mfa_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p private.mfa_principals; reason text;begin
 if auth.uid() is null then raise exception 'MFA_SESSION_REQUIRED' using errcode='42501';end if;
 select * into p from private.mfa_principals where user_id=auth.uid();
 if p.state='recovery_locked' then return jsonb_build_object('state','recovery_locked','factor_ids','[]'::jsonb,'recovery_session_id',(select id from auth.sessions where user_id=auth.uid() and id::text=auth.jwt()->>'session_id' and created_at>=p.not_before and(not_after is null or not_after>now())));end if;
 -- An enabled pilot must never show enrollment/challenge to out-of-cohort users,
 -- even when a historical principal exists. Explicit recovery_locked remains strict.
 if exists(select 1 from private.mfa_configuration c
           where c.singleton and c.enabled and c.cohort_user_ids is not null
             and not (auth.uid()=any(c.cohort_user_ids)))
 then return jsonb_build_object('state','ready',
   'factor_ids',coalesce(to_jsonb(p.admitted_factor_ids),'[]'::jsonb));end if;
 if p.user_id is null and (select private.mfa_required()) and private.mfa_is_admin() then return jsonb_build_object('state','recovery_locked','factor_ids','[]'::jsonb);end if;
 if p.state in('bootstrap_pending','re_enrollment_pending') then
  if p.authorization_expires_at is null or p.authorization_expires_at<=now() then return jsonb_build_object('state','recovery_locked','factor_ids','[]'::jsonb);end if;
  return jsonb_build_object('state','enrollment_required','factor_ids','[]'::jsonb,'enrollment_factor_id',case when p.enrollment_session_id::text=auth.jwt()->>'session_id' then p.enrollment_factor_id end);
 end if;
 if not (select private.mfa_required()) or not private.mfa_is_admin() then return jsonb_build_object('state','ready','factor_ids',coalesce(to_jsonb(p.admitted_factor_ids),'[]'::jsonb));end if;
 reason:=private.mfa_error(false);
 return jsonb_build_object('state',case when reason is null then 'ready' when reason in('MFA_REQUIRED','MFA_RECENT_REQUIRED','MFA_FACTOR_REQUIRED') and exists(select 1 from auth.mfa_factors f where f.id=any(p.admitted_factor_ids) and f.user_id=auth.uid() and f.factor_type::text='totp' and f.status::text='verified') then 'challenge_required' else 'recovery_locked' end,'factor_ids',coalesce((select jsonb_agg(f.id) from auth.mfa_factors f where f.id=any(p.admitted_factor_ids) and f.user_id=auth.uid() and f.factor_type::text='totp' and f.status::text='verified'),'[]'::jsonb));
end $function$
;

CREATE OR REPLACE FUNCTION public.security_mfa_bridge_allowed(
  p_action text,p_actor_email text,p_target_user_id uuid,p_workspace_id uuid
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.mfa_configuration; v_actor text:=lower(btrim(coalesce(p_actor_email,'')));
BEGIN
 SELECT * INTO c FROM private.mfa_configuration WHERE singleton;
 IF NOT FOUND THEN RETURN false; END IF;
 IF NOT c.enabled THEN
   -- Preserve the existing pre-pilot behavior, including recovery locks.
   RETURN NOT EXISTS(SELECT 1 FROM private.mfa_principals
                     WHERE state IN ('recovery_locked','re_enrollment_pending','bootstrap_pending'));
 END IF;
 IF c.cohort_user_ids IS NULL THEN RETURN false; END IF; -- global MFA: no delegated bridge
 -- Platform actor is supplied by the authenticated Zenvia Platform backend;
 -- the private x-platform-token is independently checked before this RPC.
 IF v_actor<>'' AND EXISTS(
    SELECT 1 FROM public.app_users a
    WHERE lower(a.email)=v_actor AND a.user_id=ANY(c.cohort_user_ids)
 ) THEN RETURN false; END IF;
 IF p_target_user_id IS NOT NULL AND p_target_user_id=ANY(c.cohort_user_ids)
 THEN RETURN false; END IF;
 IF p_target_user_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM private.mfa_principals p
    WHERE p.user_id=p_target_user_id
      AND p.state IN ('recovery_locked','re_enrollment_pending','bootstrap_pending')
 ) THEN RETURN false; END IF;
 -- Reject destructive operations directly impacting a cohort identity.
 IF p_action='delete_workspace_full' AND EXISTS(
    SELECT 1 FROM public.app_users a
    WHERE a.workspace_id=p_workspace_id AND a.user_id=ANY(c.cohort_user_ids)
 ) THEN RETURN false; END IF;
 IF p_action IN ('update_workspace_user','delete_workspace_user','reset_workspace_user_password')
    AND p_target_user_id IS NULL THEN RETURN false; END IF;
 -- Human Platform calls must carry their authenticated actor. Only these
 -- service-driven calls may lack an actor.
 IF v_actor='' AND p_action NOT IN ('apply_plan_snapshot','bootstrap','resolve_identity')
 THEN RETURN false; END IF;
 -- Non-cohort authenticated Platform operators and service automation remain
 -- as available as before the pilot.
 RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.security_mfa_bridge_allowed(text,text,uuid,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.security_mfa_bridge_allowed(text,text,uuid,uuid)
 TO service_role;

DO $$BEGIN
 IF (SELECT enabled FROM private.mfa_configuration WHERE singleton) IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'MFA_FLAG_MUST_REMAIN_DISABLED';END IF;
END $$;
COMMIT;
