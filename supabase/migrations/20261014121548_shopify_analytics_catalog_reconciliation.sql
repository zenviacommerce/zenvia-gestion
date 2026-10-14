-- Analytics leases serialize a store's complete paginated financial/catalog import.
alter table public.shopify_analytics_catalog add column sync_generation uuid;
alter table public.shopify_analytics_sync_state add column sync_lease uuid,add column sync_lease_until timestamptz;
create function public.shopify_analytics_claim_sync(owner uuid,store uuid,lease uuid) returns boolean language plpgsql security invoker set search_path='' as $$
declare claimed boolean;begin
 if lease is null or not exists(select 1 from public.integration_accounts a where a.id=store and a.owner_id=owner and a.provider='shopify' and a.enabled and a.status<>'disabled' and a.credential_source<>'derived') then raise exception 'Invalid Shopify owner/store';end if;
 insert into public.shopify_analytics_sync_state(owner_id,integration_account_id,sync_lease,sync_lease_until) values(owner,store,lease,now()+interval '5 minutes')
 on conflict(integration_account_id) do update set sync_lease=excluded.sync_lease,sync_lease_until=excluded.sync_lease_until
 where shopify_analytics_sync_state.owner_id=excluded.owner_id and (shopify_analytics_sync_state.sync_lease_until is null or shopify_analytics_sync_state.sync_lease_until<now()) returning true into claimed;
 return coalesce(claimed,false);end;$$;
create function public.shopify_analytics_release_sync(owner uuid,store uuid,lease uuid) returns void language sql security invoker set search_path='' as $$
 update public.shopify_analytics_sync_state set sync_lease=null,sync_lease_until=null where owner_id=owner and integration_account_id=store and sync_lease=lease;$$;
create function public.shopify_analytics_finish_catalog(owner uuid,store uuid,generation uuid,lease uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 if generation is null or lease is null or not exists(select 1 from public.shopify_analytics_sync_state s where s.owner_id=owner and s.integration_account_id=store and s.sync_lease=lease and s.sync_lease_until>now()) then raise exception 'Catalog synchronization lease expired' using errcode='42501';end if;
 delete from public.shopify_analytics_catalog c where c.owner_id=owner and c.integration_account_id=store and c.sync_generation is distinct from generation;
end;$$;
revoke all on function public.shopify_analytics_claim_sync(uuid,uuid,uuid),public.shopify_analytics_release_sync(uuid,uuid,uuid),public.shopify_analytics_finish_catalog(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.shopify_analytics_claim_sync(uuid,uuid,uuid),public.shopify_analytics_release_sync(uuid,uuid,uuid),public.shopify_analytics_finish_catalog(uuid,uuid,uuid,uuid) to service_role;
