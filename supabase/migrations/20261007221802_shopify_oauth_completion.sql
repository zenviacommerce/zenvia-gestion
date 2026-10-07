create or replace function public.integration_shopify_complete_oauth(p_account_id uuid,p_owner_id uuid,p_version bigint,p_secret text,p_display_name text,p_config jsonb)
returns boolean language plpgsql security invoker set search_path=public,vault as $$
declare account public.integration_accounts%rowtype; secret uuid;
begin
  select * into account from public.integration_accounts where id=p_account_id and owner_id=p_owner_id and provider='shopify' for update;
  if not found or not account.enabled or account.status='disabled' or account.shopify_credential_version<>p_version then return false; end if;
  secret:=public.integration_store_secret(p_secret,'integration:shopify:'||p_account_id,'Credenciales cifradas Shopify',account.secret_id);
  update public.integration_accounts set secret_id=secret,shopify_credential_version=shopify_credential_version+1,
    shopify_refresh_lease=null,shopify_refresh_until=null,credential_source='vault',parent_account_id=null,
    status='connected',last_error=null,display_name=p_display_name,config=p_config,updated_at=now() where id=p_account_id;
  return true;
end;
$$;
revoke all on function public.integration_shopify_complete_oauth(uuid,uuid,bigint,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.integration_shopify_complete_oauth(uuid,uuid,bigint,text,text,jsonb) to service_role;
