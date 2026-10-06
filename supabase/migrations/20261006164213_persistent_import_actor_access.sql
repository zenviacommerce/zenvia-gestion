create function public.import_actor_allowed(p_owner uuid,p_module text,p_actor uuid) returns boolean language sql stable set search_path='' as $$select private.import_can_access(p_owner,p_module,p_actor)$$;
revoke all on function public.import_actor_allowed(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.import_actor_allowed(uuid,text,uuid) to service_role;
