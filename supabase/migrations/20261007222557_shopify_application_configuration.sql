create or replace function public.integration_read_named_secret(p_name text)
returns text language sql security invoker set search_path=public,vault as $$
  select decrypted_secret from vault.decrypted_secrets where name=p_name;
$$;
revoke all on function public.integration_read_named_secret(text) from public,anon,authenticated;
grant execute on function public.integration_read_named_secret(text) to service_role;
