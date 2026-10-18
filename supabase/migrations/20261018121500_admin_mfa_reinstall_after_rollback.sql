-- Reinstall after the explicit 20261018092127 production rollback.
-- Execute as one transactional migration. Never activate MFA here.
BEGIN;
DO $$BEGIN IF to_regclass('private.mfa_configuration') IS NOT NULL THEN RAISE EXCEPTION 'MFA_SCHEMA_ALREADY_PRESENT'; END IF; END $$;
-- MFA is deliberately inactive. Activation is an out-of-band, reviewed deployment operation.
-- Auth compatibility required: sessions.factor_id, mfa_amr_claims, mfa_challenges.
create schema if not exists private;
create table private.mfa_configuration(singleton boolean primary key default true check(singleton),enabled boolean not null default false,cohort_user_ids uuid[]);
insert into private.mfa_configuration(singleton,enabled) values(true,false);
create table private.mfa_principals(
 user_id uuid primary key references auth.users(id) on delete cascade,
 enforced boolean not null default true,
 state text not null check(state in('bootstrap_pending','active','recovery_locked','re_enrollment_pending')),
 admitted_factor_ids uuid[] not null default '{}',
 not_before timestamptz not null default 'epoch',
 enrollment_session_id uuid,
 enrollment_factor_id uuid,
 enrollment_started_at timestamptz,
 authorization_expires_at timestamptz,
 authorization_reference text
);
create table private.mfa_audit(id bigint generated always as identity primary key,occurred_at timestamptz not null default now(),user_id uuid,event text not null,reference text);
create table private.mfa_function_manifest(signature text primary key,function_oid oid not null,implementation regprocedure not null,original_definition text not null,wrapper_hash text not null);
alter table private.mfa_configuration enable row level security;
alter table private.mfa_principals enable row level security;
alter table private.mfa_audit enable row level security;
alter table private.mfa_function_manifest enable row level security;
revoke all on private.mfa_configuration,private.mfa_principals,private.mfa_audit,private.mfa_function_manifest from public,anon,authenticated;

create function private.mfa_required() returns boolean language sql stable security definer set search_path='' as $$
 select c.enabled and(c.cohort_user_ids is null or auth.uid()=any(c.cohort_user_ids) or exists(select 1 from private.mfa_principals p where p.user_id=auth.uid() and p.enforced)) from private.mfa_configuration c where c.singleton
$$;
revoke all on function private.mfa_required() from public,anon,authenticated;

create function private.mfa_is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.app_users a where a.user_id=auth.uid() and a.active and a.role='admin')
 or exists(select 1 from public.platform_admins a where a.user_id=auth.uid() and a.active)
$$;

create function private.mfa_error(p_recent boolean default false,p_force boolean default false) returns text language plpgsql stable security definer set search_path='' as $$
declare j jsonb:=auth.jwt(); p private.mfa_principals; s auth.sessions; proof_time numeric; enabled boolean;
begin
 select * into p from private.mfa_principals where user_id=auth.uid();
 if p.state in('recovery_locked','bootstrap_pending','re_enrollment_pending') then return 'MFA_RECOVERY_LOCKED';end if;
 select private.mfa_required() into enabled;
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
end $$;
create function private.mfa_allowed() returns boolean language sql stable security definer set search_path='' as $$select private.mfa_error(false) is null$$;
create function public.security_mfa_assert(p_recent boolean default false) returns void language plpgsql stable security definer set search_path='' as $$
declare reason text;begin
 if auth.uid() is null then raise exception 'MFA_SESSION_REQUIRED' using errcode='42501';end if;
 reason:=private.mfa_error(p_recent);if reason is not null then raise exception '%',reason using errcode='42501';end if;
end $$;
create function public.security_mfa_bridge_allowed() returns boolean language sql stable security definer set search_path='' as $$ select not enabled and not exists(select 1 from private.mfa_principals where state in('recovery_locked','re_enrollment_pending','bootstrap_pending')) from private.mfa_configuration where singleton $$;
revoke all on function public.security_mfa_bridge_allowed() from public,anon,authenticated;
grant execute on function public.security_mfa_bridge_allowed() to service_role;

create function public.security_mfa_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p private.mfa_principals; reason text;begin
 if auth.uid() is null then raise exception 'MFA_SESSION_REQUIRED' using errcode='42501';end if;
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
end $$;

create function public.security_mfa_prepare_enrollment(p_factor_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare p private.mfa_principals; s uuid;begin
 if auth.uid() is null then raise exception 'MFA_SESSION_REQUIRED' using errcode='42501';end if;
 s:=(auth.jwt()->>'session_id')::uuid;
 select * into p from private.mfa_principals where user_id=auth.uid() for update;
 if not found or p.state not in('bootstrap_pending','re_enrollment_pending') or p.authorization_expires_at is null or p.authorization_expires_at<=now() or not exists(select 1 from auth.sessions where id=s and user_id=auth.uid() and created_at>=p.not_before and (not_after is null or not_after>now())) then raise exception 'MFA_ENROLLMENT_NOT_AUTHORIZED' using errcode='42501';end if;
 if p.enrollment_session_id is not null and p.enrollment_session_id<>s then raise exception 'MFA_ENROLLMENT_NOT_AUTHORIZED' using errcode='42501';end if;
 if p.enrollment_factor_id is not null and (p.enrollment_factor_id<>p_factor_id or p.enrollment_session_id<>s) then raise exception 'MFA_ENROLLMENT_ALREADY_PENDING' using errcode='42501';end if;
 if not exists(select 1 from auth.mfa_factors where id=p_factor_id and user_id=auth.uid() and factor_type::text='totp' and status::text='unverified') then raise exception 'MFA_UNVERIFIED_FACTOR_REQUIRED' using errcode='42501';end if;
 update private.mfa_principals set enrollment_factor_id=p_factor_id,enrollment_session_id=s,enrollment_started_at=coalesce(enrollment_started_at,now()) where user_id=auth.uid();
end $$;
create function public.security_mfa_complete_enrollment(p_factor_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare p private.mfa_principals; s auth.sessions; proof numeric;begin
 if auth.uid() is null then raise exception 'MFA_SESSION_REQUIRED' using errcode='42501';end if;
 select * into p from private.mfa_principals where user_id=auth.uid() for update;
 select * into s from auth.sessions where id=(auth.jwt()->>'session_id')::uuid and user_id=auth.uid();
 if p.user_id is null or s.id is null or p.state not in('bootstrap_pending','re_enrollment_pending') or p.authorization_expires_at is null or p.authorization_expires_at<=now() or p.enrollment_factor_id is distinct from p_factor_id or p.enrollment_session_id is distinct from s.id or s.factor_id is distinct from p_factor_id or s.created_at<p.not_before or (s.not_after is not null and s.not_after<=now()) or s.aal::text<>'aal2' or auth.jwt()->>'aal'<>'aal2' then raise exception 'MFA_ENROLLMENT_NOT_AUTHORIZED' using errcode='42501';end if;
 select max((e->>'timestamp')::numeric) into proof from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) e where e->>'method'='totp' and e->>'timestamp' ~ '^[0-9]+$';
 if proof is null or proof<extract(epoch from now())-300 or proof>extract(epoch from now())+30 or not exists(select 1 from auth.mfa_amr_claims where session_id=s.id and authentication_method='totp' and abs(extract(epoch from updated_at)-proof)<2) or not exists(select 1 from auth.mfa_factors where id=p_factor_id and user_id=auth.uid() and factor_type::text='totp' and status::text='verified') or not exists(select 1 from auth.mfa_challenges where factor_id=p_factor_id and verified_at>=p.enrollment_started_at and verified_at>now()-interval '5 minutes') then raise exception 'MFA_FACTOR_PROOF_REQUIRED' using errcode='42501';end if;
 update private.mfa_principals set state='active',admitted_factor_ids=array(select distinct x from unnest(admitted_factor_ids||array[p_factor_id]) x),enrollment_factor_id=null,enrollment_session_id=null,enrollment_started_at=null,authorization_expires_at=null where user_id=auth.uid();
 insert into private.mfa_audit(user_id,event,reference) values(auth.uid(),'enrollment_completed',p.authorization_reference);
end $$;
-- Only operational security staff with service credentials can authorize initial/recovery enrollment.
-- The evidence reference is an audit pointer, not a self-service recovery secret.
create function public.security_mfa_authorize_enrollment(p_user_id uuid,p_reference text,p_recovery boolean default false) returns void language plpgsql security definer set search_path='' as $$
begin
 if length(trim(coalesce(p_reference,'')))<10 then raise exception 'MFA_REVIEW_REFERENCE_REQUIRED';end if;
 if exists(select 1 from private.mfa_principals where user_id=p_user_id and state='active') and not p_recovery then raise exception 'MFA_ALREADY_ACTIVE';end if;
 insert into private.mfa_principals(user_id,state,not_before,authorization_reference) values(p_user_id,'recovery_locked',now(),p_reference)
 on conflict(user_id) do update set state='recovery_locked',not_before=now(),admitted_factor_ids='{}',enrollment_factor_id=null,enrollment_session_id=null,enrollment_started_at=null,authorization_expires_at=null,authorization_reference=excluded.authorization_reference;
 delete from auth.sessions where user_id=p_user_id;
 insert into private.mfa_audit(user_id,event,reference) values(p_user_id,'recovery_locked',p_reference);
 -- A separate release call follows session revocation + Auth Admin factor removal + second approval.
end $$;
create function public.security_mfa_release_enrollment(p_user_id uuid,p_reference text,p_session_id uuid default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if length(trim(coalesce(p_reference,'')))<10 then raise exception 'MFA_REVIEW_REFERENCE_REQUIRED';end if;
 if exists(select 1 from auth.mfa_factors where user_id=p_user_id and status::text='verified') then raise exception 'MFA_REMOVE_OLD_FACTORS_FIRST';end if;
 if not exists(select 1 from private.mfa_principals where user_id=p_user_id and state='recovery_locked' and authorization_reference<>p_reference) then raise exception 'MFA_INDEPENDENT_APPROVAL_REQUIRED';end if;
 if not exists(select 1 from auth.sessions s join private.mfa_principals p on p.user_id=s.user_id where s.id=p_session_id and s.user_id=p_user_id and s.created_at>=p.not_before and(s.not_after is null or s.not_after>now())) then raise exception 'MFA_APPROVED_SESSION_REQUIRED';end if;
 update private.mfa_principals set state='re_enrollment_pending',enrollment_session_id=p_session_id,authorization_expires_at=now()+interval '15 minutes',authorization_reference=authorization_reference||' / '||p_reference where user_id=p_user_id and state='recovery_locked' and authorization_reference<>p_reference;
 if not found then raise exception 'MFA_INDEPENDENT_APPROVAL_REQUIRED';end if;
 insert into private.mfa_audit(user_id,event,reference) values(p_user_id,'enrollment_authorized',p_reference);
end $$;
revoke all on function public.security_mfa_authorize_enrollment(uuid,text,boolean),public.security_mfa_release_enrollment(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.security_mfa_authorize_enrollment(uuid,text,boolean),public.security_mfa_release_enrollment(uuid,text,uuid) to service_role;
revoke all on function private.mfa_is_admin(),private.mfa_error(boolean,boolean),private.mfa_allowed() from public,anon,authenticated;
grant execute on function private.mfa_allowed() to authenticated;
revoke all on function public.security_mfa_status(),public.security_mfa_assert(boolean),public.security_mfa_prepare_enrollment(uuid),public.security_mfa_complete_enrollment(uuid) from public,anon;
grant execute on function public.security_mfa_status(),public.security_mfa_assert(boolean),public.security_mfa_prepare_enrollment(uuid),public.security_mfa_complete_enrollment(uuid) to authenticated;

create function public.security_mfa_begin_factor_add() returns void language plpgsql security definer set search_path='' as $$
declare reason text;begin
 reason:=private.mfa_error(true,true);if reason is not null then raise exception '%',reason using errcode='42501';end if;
 update private.mfa_principals set state='bootstrap_pending',enrollment_session_id=(auth.jwt()->>'session_id')::uuid,enrollment_factor_id=null,enrollment_started_at=null,authorization_expires_at=now()+interval '15 minutes',authorization_reference='factor-add:'||(auth.jwt()->>'session_id') where user_id=auth.uid() and state='active';
 if not found then raise exception 'MFA_ENROLLMENT_NOT_AUTHORIZED' using errcode='42501';end if;
 insert into private.mfa_audit(user_id,event) values(auth.uid(),'factor_add_authorized');
end $$;
revoke all on function public.security_mfa_begin_factor_add() from public,anon;
grant execute on function public.security_mfa_begin_factor_add() to authenticated;

create function public.security_mfa_forget_factor(p_factor_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare reason text; p private.mfa_principals;begin
 reason:=private.mfa_error(true,true);if reason is not null then raise exception '%',reason using errcode='42501';end if;
 select * into p from private.mfa_principals where user_id=auth.uid() for update;
 if p.user_id is null or not(p_factor_id=any(p.admitted_factor_ids)) then raise exception 'MFA_FACTOR_NOT_ADMITTED' using errcode='42501';end if;
 if not exists(select 1 from auth.mfa_factors f where f.id=any(p.admitted_factor_ids) and f.id<>p_factor_id and f.user_id=auth.uid() and f.factor_type::text='totp' and f.status::text='verified') then raise exception 'MFA_LAST_FACTOR' using errcode='42501';end if;
 update private.mfa_principals set admitted_factor_ids=array_remove(admitted_factor_ids,p_factor_id) where user_id=auth.uid();
 insert into private.mfa_audit(user_id,event) values(auth.uid(),'factor_admission_removed');
end $$;
revoke all on function public.security_mfa_forget_factor(uuid) from public,anon;
grant execute on function public.security_mfa_forget_factor(uuid) to authenticated;

-- Preserve the public function OID/ACL/dependencies. Clone the existing implementation
-- privately, then replace its body with an authorization wrapper. Includes SQL-language
-- definers as well as PL/pgSQL: RLS alone cannot constrain them.
do $migration$
declare f record; definition text; original_definition text; clone_oid oid; clone_name text; call_args text; wrapper_body text;
begin
 perform set_config('search_path','',true);
 for f in select p.*,n.nspname,pg_get_function_arguments(p.oid) args,pg_get_function_result(p.oid) result from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname='public' and p.prosecdef and p.prokind='f' and p.prorettype not in('trigger'::regtype,'event_trigger'::regtype) and p.proname not in('security_mfa_status','security_mfa_assert','security_mfa_bridge_allowed','security_mfa_prepare_enrollment','security_mfa_complete_enrollment','security_mfa_authorize_enrollment','security_mfa_release_enrollment','security_mfa_approve_recovery','security_mfa_begin_factor_add','security_mfa_forget_factor') and (has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute')) and l.lanname in('sql','plpgsql')
 loop
  if f.provariadic<>0 or (f.proargmodes is not null and f.proargmodes && array['o','b']::"char"[]) then raise exception 'MFA wrapper signature needs explicit review: %',f.oid::regprocedure;end if;
  clone_name:='mfa_impl_'||f.oid;
  definition:=pg_get_functiondef(f.oid);original_definition:=definition;
  definition:=overlay(definition placing 'private.'||clone_name from position('public.'||quote_ident(f.proname)||'(' in definition) for length('public.'||quote_ident(f.proname)));
  execute definition;
  select p.oid into strict clone_oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=clone_name and p.proargtypes=f.proargtypes;
  execute format('alter function private.%I(%s) owner to %I',clone_name,pg_get_function_identity_arguments(f.oid),pg_get_userbyid(f.proowner));
  execute format('revoke all on function private.%I(%s) from public,anon,authenticated,service_role',clone_name,pg_get_function_identity_arguments(f.oid));
  select string_agg('$'||i,',' order by i) into call_args from generate_series(1,f.pronargs) i;
  wrapper_body:='begin if auth.uid() is not null then perform public.security_mfa_assert('||case when f.proname like 'configuration_%' or f.proname ~ '(purge|reset|delete_workspace|credential|secret|permission)' then 'true' else 'false' end||');end if; ';
  if f.proretset then wrapper_body:=wrapper_body||'return query select * from private.'||clone_name||'('||coalesce(call_args,'')||');';
  elsif f.prorettype='void'::regtype then wrapper_body:=wrapper_body||'perform private.'||clone_name||'('||coalesce(call_args,'')||'); return;';
  elsif f.proargmodes is not null and 'o'=any(f.proargmodes) then raise exception 'MFA wrapper needs explicit OUT-argument review: %',f.oid::regprocedure;
  else wrapper_body:=wrapper_body||'return private.'||clone_name||'('||coalesce(call_args,'')||');';end if;
  wrapper_body:=wrapper_body||' end';
  definition:=pg_get_functiondef(f.oid);
  definition:=replace(definition,substring(definition from 'AS (\$[^$]*\$)')||f.prosrc||substring(definition from 'AS (\$[^$]*\$)'),substring(definition from 'AS (\$[^$]*\$)')||wrapper_body||substring(definition from 'AS (\$[^$]*\$)'));
  if f.prolang=(select oid from pg_language where lanname='sql') then definition:=overlay(definition placing ' LANGUAGE plpgsql' from position(E'\n LANGUAGE sql' in definition)+1 for length(' LANGUAGE sql'));end if;
  execute definition;
  execute format('alter function public.%I(%s) volatile',f.proname,pg_get_function_identity_arguments(f.oid));
  insert into private.mfa_function_manifest values(f.oid::regprocedure::text,f.oid,clone_oid::regprocedure,original_definition,md5(pg_get_functiondef(f.oid)));
 end loop;
end $migration$;

-- Add an AND gate, never a competing permissive OR policy. Self bootstrap tables
-- retain existing self-only SELECT; every write still gets the restrictive gate.
do $policies$
declare t record; own_bootstrap boolean;
begin
 for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relrowsecurity and c.relkind in('r','p') and (n.nspname='public' or(n.nspname='storage' and c.relname='objects'))
 loop
  own_bootstrap:=t.nspname='public' and t.relname in('app_users','platform_admins');
  if own_bootstrap then execute format('create policy mfa_select_gate on %I.%I as restrictive for select to authenticated using (user_id=(select auth.uid()) or (select private.mfa_allowed()))',t.nspname,t.relname);
  else execute format('create policy mfa_select_gate on %I.%I as restrictive for select to authenticated using ((select private.mfa_allowed()))',t.nspname,t.relname);end if;
  execute format('create policy mfa_insert_gate on %I.%I as restrictive for insert to authenticated with check ((select private.mfa_allowed()))',t.nspname,t.relname);
  execute format('create policy mfa_update_gate on %I.%I as restrictive for update to authenticated using ((select private.mfa_allowed())) with check ((select private.mfa_allowed()))',t.nspname,t.relname);
  execute format('create policy mfa_delete_gate on %I.%I as restrictive for delete to authenticated using ((select private.mfa_allowed()))',t.nspname,t.relname);
 end loop;
end $policies$;
notify pgrst,'reload schema';

-- Refuse activation when local metadata exposes an equivalent unguarded entry.
-- This is not a substitute for staging Edge/control-plane and Auth verification.
create function private.mfa_activation_findings() returns table(entry text,reason text) language sql stable security definer set search_path='' as $$
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
$$;
create function private.mfa_configuration_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.enabled and (not old.enabled or new.cohort_user_ids is distinct from old.cohort_user_ids) and exists(select 1 from private.mfa_activation_findings()) then raise exception 'MFA_ACTIVATION_BLOCKED: inspect private.mfa_activation_findings()';end if;
 return new;
end $$;
create trigger mfa_configuration_guard before update on private.mfa_configuration for each row execute function private.mfa_configuration_guard();
revoke all on function private.mfa_activation_findings(),private.mfa_configuration_guard() from public,anon,authenticated;

-- During a pilot, newly granted administrative capabilities never inherit an exemption.
create function private.mfa_promoted_admin() returns trigger language plpgsql security definer set search_path='' as $$
declare n jsonb:=to_jsonb(new);o jsonb:=to_jsonb(old);begin
 if (select enabled from private.mfa_configuration where singleton) and (n->>'active')::boolean and(TG_TABLE_NAME='platform_admins' or n->>'role'='admin') and(TG_OP='INSERT' or coalesce(o->>'active','false')<>'true' or(TG_TABLE_NAME='app_users' and o->>'role' is distinct from 'admin')) then
  insert into private.mfa_principals(user_id,state,not_before,authorization_reference) values((n->>'user_id')::uuid,'bootstrap_pending',now(),'role-promotion')
  on conflict(user_id) do update set state='bootstrap_pending',enforced=true,not_before=now(),admitted_factor_ids='{}',enrollment_factor_id=null,enrollment_session_id=null,enrollment_started_at=null,authorization_expires_at=null,authorization_reference='role-promotion';
  insert into private.mfa_audit(user_id,event) values((n->>'user_id')::uuid,'promotion_pending');
 end if;
 return new;
end $$;
create trigger mfa_admin_promotion after insert or update of role,active on public.app_users for each row execute function private.mfa_promoted_admin();
create trigger mfa_platform_promotion after insert or update of active on public.platform_admins for each row execute function private.mfa_promoted_admin();
revoke all on function private.mfa_promoted_admin() from public,anon,authenticated;


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

-- Remove the legacy 3-argument release, which cannot enforce adaptive quorum.\ndrop function public.security_mfa_release_enrollment(uuid,text,uuid);\n\n-- Release is service-only. A second approver must be a distinct active,
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

DO $$BEGIN IF (SELECT enabled FROM private.mfa_configuration WHERE singleton=true) IS DISTINCT FROM false THEN RAISE EXCEPTION 'MFA_NOT_DISABLED'; END IF; END $$;
COMMIT;
