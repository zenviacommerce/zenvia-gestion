-- Additive app identity; existing authorizations retain their issuer.
alter table public.integration_accounts add column sp_api_app_key text,
 add column amazon_credential_version bigint not null default 1;
update public.integration_accounts set sp_api_app_key='private_v1' where provider='amazon';
alter table public.integration_accounts add constraint integration_amazon_app_check check
 ((provider='amazon' and sp_api_app_key is not null and sp_api_app_key in ('private_v1','public_v1')) or
 (provider<>'amazon' and sp_api_app_key is null));
create function public.integration_amazon_credential_snapshot(p_owner_id uuid,p_integration_account_id uuid default null,p_amazon_account_id uuid default null)
returns table(integration_account_id uuid,amazon_account_id uuid,owner_id uuid,seller_id text,sp_api_app_key text,amazon_credential_version bigint,secret_payload jsonb)
language sql security invoker set search_path='' as $$
 select i.id,a.id,i.owner_id,a.seller_id,i.sp_api_app_key,i.amazon_credential_version,
 pg_catalog.jsonb_build_object('refreshToken',coalesce(v.decrypted_secret::jsonb->>'refreshToken',v.decrypted_secret::jsonb->>'refresh_token'),'sellerId',a.seller_id,'legacyApplicationCredentialsPresent',
 (nullif(btrim(coalesce(v.decrypted_secret::jsonb->>'clientId',v.decrypted_secret::jsonb->>'client_id')),'') is not null or
 nullif(btrim(coalesce(v.decrypted_secret::jsonb->>'clientSecret',v.decrypted_secret::jsonb->>'client_secret')),'') is not null),
 'legacyClientIdSha256',pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(nullif(btrim(coalesce(v.decrypted_secret::jsonb->>'clientId',v.decrypted_secret::jsonb->>'client_id')),''),'UTF8')),'hex'),
 'legacyClientSecretSha256',pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(nullif(btrim(coalesce(v.decrypted_secret::jsonb->>'clientSecret',v.decrypted_secret::jsonb->>'client_secret')),''),'UTF8')),'hex'))
 from public.integration_accounts i join public.amazon_accounts a on a.integration_account_id=i.id and a.owner_id=i.owner_id and a.seller_id=i.external_account_id
 left join vault.decrypted_secrets v on v.id=i.secret_id
 where p_owner_id is not null and (p_integration_account_id is not null or p_amazon_account_id is not null)
 and i.owner_id=p_owner_id and i.provider='amazon' and i.enabled and i.status<>'disabled'
 and a.status<>'disabled' and not i.config ? 'archivedAt'
 and (p_integration_account_id is null or i.id=p_integration_account_id)
 and (p_amazon_account_id is null or a.id=p_amazon_account_id)
 and coalesce(v.decrypted_secret::jsonb->>'sellerId',v.decrypted_secret::jsonb->>'seller_id',a.seller_id)=a.seller_id
$$;
revoke all on function public.integration_amazon_credential_snapshot(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.integration_amazon_credential_snapshot(uuid,uuid,uuid) to service_role;

-- Legacy LWA pairs remain untouched. A partial pair cannot be safely classified.
-- Complete pairs require the private backend equality gate against named app config.
do $$ begin
 if exists(select 1 from public.integration_accounts i join vault.decrypted_secrets v on v.id=i.secret_id where i.provider='amazon' and
 ((coalesce(nullif(v.decrypted_secret::jsonb->>'clientId',''),nullif(v.decrypted_secret::jsonb->>'client_id','')) is null)
 <> (coalesce(nullif(v.decrypted_secret::jsonb->>'clientSecret',''),nullif(v.decrypted_secret::jsonb->>'client_secret','')) is null)))
 then raise exception 'Amazon legacy credential preflight failed'; end if;
end $$;
