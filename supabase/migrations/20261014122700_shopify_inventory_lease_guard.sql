create function public.shopify_analytics_invalidate_inventory(owner uuid,store uuid,lease uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.shopify_analytics_sync_state st where st.owner_id=owner and st.integration_account_id=store and st.sync_lease=lease and st.sync_lease_until>clock_timestamp() for update;
 if not found then raise exception 'Shopify synchronization lease expired' using errcode='42501';end if;
 update public.shopify_analytics_catalog c set inventory_quantity=null where c.owner_id=owner and c.integration_account_id=store;
end;$$;
revoke all on function public.shopify_analytics_invalidate_inventory(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.shopify_analytics_invalidate_inventory(uuid,uuid,uuid) to service_role;
