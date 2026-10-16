-- OAuth start must obtain this context from PostgREST using the original human
-- JWT. Callback/commit use only the context persisted in the private attempt.
-- This boundary is forced even while both rollout flags are off.
create function public.security_mfa_oauth_actor_assert(
 p_actor_user_id uuid,p_actor_session_id uuid,p_actor_factor_id uuid,
 p_mfa_verified_at numeric,p_actor_owner_id uuid
) returns void language plpgsql security definer set search_path='' as $$
declare actor public.app_users; principal private.mfa_principals; session_row auth.sessions;
 factor_row auth.mfa_factors; workspace public.workspaces; proof_at timestamptz;
begin
 if p_actor_user_id is null or p_actor_owner_id is null then raise exception 'ACCESS_ADMIN_REQUIRED' using errcode='42501';end if;
 -- Locks survive to the end of the enclosing claim/commit transaction, so
 -- role/tenant/recovery/session/factor revocation cannot race its Vault write.
 select * into actor from public.app_users where user_id=p_actor_user_id for share;
 if not found or not actor.active or actor.role<>'admin' or actor.data_owner_id is distinct from p_actor_owner_id then raise exception 'ACCESS_ADMIN_REQUIRED' using errcode='42501';end if;
 select * into workspace from public.workspaces where id=p_actor_owner_id for share;
 if not found or workspace.status not in('active','trialing') then raise exception 'ACCESS_DISABLED' using errcode='42501';end if;
 select * into principal from private.mfa_principals where user_id=p_actor_user_id for share;
 if not found or principal.state<>'active' then raise exception 'MFA_RECOVERY_LOCKED' using errcode='42501';end if;
 if p_actor_session_id is null or p_actor_factor_id is null then raise exception 'MFA_CONTEXT_REQUIRED' using errcode='42501';end if;
 select * into session_row from auth.sessions where id=p_actor_session_id and user_id=p_actor_user_id for share;
 if not found or session_row.created_at<principal.not_before or(session_row.not_after is not null and session_row.not_after<=now()) or session_row.aal::text<>'aal2' then raise exception 'MFA_SESSION_REQUIRED' using errcode='42501';end if;
 if session_row.factor_id is distinct from p_actor_factor_id then raise exception 'MFA_CONTEXT_CHANGED' using errcode='42501';end if;
 select * into factor_row from auth.mfa_factors where id=p_actor_factor_id and user_id=p_actor_user_id for share;
 if not found or factor_row.factor_type::text<>'totp' or factor_row.status::text<>'verified' or not(p_actor_factor_id=any(principal.admitted_factor_ids)) then raise exception 'MFA_FACTOR_REQUIRED' using errcode='42501';end if;
 if p_mfa_verified_at is null or p_mfa_verified_at<>floor(p_mfa_verified_at) or p_mfa_verified_at>extract(epoch from now())+30 then raise exception 'MFA_CONTEXT_REQUIRED' using errcode='42501';end if;
 if p_mfa_verified_at<extract(epoch from now())-300 then raise exception 'MFA_RECENT_REQUIRED' using errcode='42501';end if;
 select updated_at into proof_at from auth.mfa_amr_claims where session_id=p_actor_session_id and authentication_method='totp' for share;
 if not found or abs(extract(epoch from proof_at)-p_mfa_verified_at)>=2 then raise exception 'MFA_CONTEXT_CHANGED' using errcode='42501';end if;
end $$;
revoke all on function public.security_mfa_oauth_actor_assert(uuid,uuid,uuid,numeric,uuid) from public,anon,authenticated;
grant execute on function public.security_mfa_oauth_actor_assert(uuid,uuid,uuid,numeric,uuid) to service_role;

create function public.security_mfa_oauth_start_context() returns jsonb language plpgsql security definer set search_path='' as $$
declare reason text;actor_owner uuid;actor_session uuid;actor_factor uuid;proof numeric;
begin
 if auth.uid() is null then raise exception 'MFA_SESSION_REQUIRED' using errcode='42501';end if;
 select data_owner_id into actor_owner from public.app_users where user_id=auth.uid() and active and role='admin';
 if not found then raise exception 'ACCESS_ADMIN_REQUIRED' using errcode='42501';end if;
 reason:=private.mfa_error(true,true);
 if reason is not null then raise exception '%',reason using errcode='42501';end if;
 actor_session:=(auth.jwt()->>'session_id')::uuid;
 select factor_id into actor_factor from auth.sessions where id=actor_session and user_id=auth.uid();
 select max((e->>'timestamp')::numeric) into proof from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) e where e->>'method'='totp' and e->>'timestamp' ~ '^[0-9]+$';
 perform public.security_mfa_oauth_actor_assert(auth.uid(),actor_session,actor_factor,proof,actor_owner);
 return jsonb_build_object('actor_user_id',auth.uid(),'actor_session_id',actor_session,'actor_factor_id',actor_factor,'mfa_verified_at',proof,'actor_owner_id',actor_owner);
end $$;
revoke all on function public.security_mfa_oauth_start_context() from public,anon;
grant execute on function public.security_mfa_oauth_start_context() to authenticated;

-- Register the directly guarded endpoint with the existing activation inventory.
-- Unlike historical business RPCs it is its own guarded implementation; there
-- is deliberately no unguarded private clone to call during OAuth initiation.
do $$declare function_id oid:='public.security_mfa_oauth_start_context()'::regprocedure;begin
 insert into private.mfa_function_manifest(signature,function_oid,implementation,original_definition,wrapper_hash)
 values(function_id::regprocedure::text,function_id,function_id::regprocedure,pg_get_functiondef(function_id),md5(pg_get_functiondef(function_id)));
end $$;
notify pgrst,'reload schema';
