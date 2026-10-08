alter table public.integration_accounts
  add column if not exists shopify_credential_version bigint not null default 0,
  add column if not exists shopify_refresh_lease uuid,
  add column if not exists shopify_refresh_until timestamptz;

create or replace function public.integration_shopify_claim_refresh(p_account_id uuid,p_owner_id uuid,p_lease uuid)
returns boolean language plpgsql security invoker set search_path=public,vault as $$
begin
  update public.integration_accounts set shopify_refresh_lease=p_lease,shopify_refresh_until=now()+interval '60 seconds'
  where id=p_account_id and owner_id=p_owner_id and provider='shopify' and enabled and status<>'disabled'
    and (shopify_refresh_lease is null or shopify_refresh_until<now());
  return found;
end;
$$;

create or replace function public.integration_shopify_release_refresh(p_account_id uuid,p_owner_id uuid,p_lease uuid)
returns void language sql security invoker set search_path=public as $$
  update public.integration_accounts set shopify_refresh_lease=null,shopify_refresh_until=null
  where id=p_account_id and owner_id=p_owner_id and shopify_refresh_lease=p_lease;
$$;

create or replace function public.integration_shopify_commit_refresh(p_account_id uuid,p_owner_id uuid,p_lease uuid,p_version bigint,p_secret text)
returns boolean language plpgsql security invoker set search_path=public,vault as $$
declare account public.integration_accounts%rowtype;
begin
  select * into account from public.integration_accounts where id=p_account_id and owner_id=p_owner_id and provider='shopify' for update;
  if not found or not account.enabled or account.status='disabled'
     or account.shopify_refresh_lease is distinct from p_lease
     or account.shopify_credential_version<>p_version or account.shopify_refresh_until<now() then return false; end if;
  perform public.integration_store_secret(p_secret,'integration:shopify:'||p_account_id,'Credenciales cifradas Shopify',account.secret_id);
  update public.integration_accounts set shopify_credential_version=shopify_credential_version+1,
    shopify_refresh_lease=null,shopify_refresh_until=null where id=p_account_id;
  return true;
end;
$$;

create or replace function public.integration_shopify_replace_secret(p_account_id uuid,p_secret text)
returns uuid language plpgsql security invoker set search_path=public,vault as $$
declare account public.integration_accounts%rowtype; secret uuid;
begin
  select * into account from public.integration_accounts where id=p_account_id and provider='shopify' for update;
  if not found then raise exception 'Cuenta Shopify no encontrada.'; end if;
  secret:=public.integration_store_secret(p_secret,'integration:shopify:'||p_account_id,'Credenciales cifradas Shopify',account.secret_id);
  update public.integration_accounts set secret_id=secret,shopify_credential_version=shopify_credential_version+1,
    shopify_refresh_lease=null,shopify_refresh_until=null where id=p_account_id;
  return secret;
end;
$$;

revoke all on function public.integration_shopify_claim_refresh(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.integration_shopify_release_refresh(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.integration_shopify_commit_refresh(uuid,uuid,uuid,bigint,text) from public,anon,authenticated;
revoke all on function public.integration_shopify_replace_secret(uuid,text) from public,anon,authenticated;
grant execute on function public.integration_shopify_claim_refresh(uuid,uuid,uuid) to service_role;
grant execute on function public.integration_shopify_release_refresh(uuid,uuid,uuid) to service_role;
grant execute on function public.integration_shopify_commit_refresh(uuid,uuid,uuid,bigint,text) to service_role;
grant execute on function public.integration_shopify_replace_secret(uuid,text) to service_role;
