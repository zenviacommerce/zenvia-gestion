create or replace function public.integration_store_secret(p_secret text,p_name text,p_description text default null,p_existing_secret_id uuid default null)
returns uuid language plpgsql security invoker set search_path=public,vault as $$
declare v_secret_id uuid; v_named_id uuid;
begin
  if coalesce(btrim(p_secret),'')='' or coalesce(btrim(p_name),'')='' then raise exception 'El secreto y su nombre no pueden estar vacíos.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('integration-secret:'||p_name,0));
  select id into v_named_id from vault.secrets where name=p_name;
  if p_existing_secret_id is not null then select id into v_secret_id from vault.secrets where id=p_existing_secret_id; end if;
  if v_secret_id is not null and v_named_id is not null and v_secret_id<>v_named_id then
    raise exception 'Las referencias de las credenciales no coinciden. Revisa la cuenta de integración.';
  end if;
  v_secret_id:=coalesce(v_secret_id,v_named_id);
  if v_secret_id is null then select vault.create_secret(p_secret,p_name,p_description,null) into v_secret_id;
  else perform vault.update_secret(v_secret_id,p_secret,p_name,p_description,null); end if;
  return v_secret_id;
end;
$$;
revoke all on function public.integration_store_secret(text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.integration_store_secret(text,text,text,uuid) to service_role;

-- Recover references left by a failed write before the account was updated.
update public.integration_accounts a
set secret_id=s.id,shopify_credential_version=a.shopify_credential_version+1
from vault.secrets s
where a.provider='shopify' and a.secret_id is null and s.name='integration:shopify:'||a.id::text;
