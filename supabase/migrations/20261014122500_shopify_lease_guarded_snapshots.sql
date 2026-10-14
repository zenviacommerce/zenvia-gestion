drop function public.shopify_analytics_ingest(jsonb);
-- Service-only transactional ingestion prevents partially replaced financial snapshots.
create function public.shopify_analytics_ingest(snapshot jsonb,lease uuid default null) returns void language plpgsql security invoker set search_path='' as $$
declare o public.shopify_analytics_orders;begin
 o:=jsonb_populate_record(null::public.shopify_analytics_orders,snapshot->'order');
 if lease is not null then
  perform 1 from public.shopify_analytics_sync_state st where st.owner_id=o.owner_id and st.integration_account_id=o.integration_account_id and st.sync_lease=lease and st.sync_lease_until>clock_timestamp() for update;
  if not found then raise exception 'Shopify synchronization lease expired' using errcode='42501';end if;
 end if;
 if not exists(select 1 from public.integration_accounts a where a.id=o.integration_account_id and a.owner_id=o.owner_id and a.provider='shopify') then raise exception 'Invalid Shopify owner/store';end if;
 perform pg_advisory_xact_lock(hashtextextended(o.integration_account_id::text||':'||o.order_id,0));
 if exists(select 1 from public.shopify_analytics_orders old where old.integration_account_id=o.integration_account_id and old.order_id=o.order_id and old.updated_at>o.updated_at) then return;end if;
 insert into public.shopify_analytics_orders select o.* on conflict(integration_account_id,order_id) do update set event_at=excluded.event_at,updated_at=excluded.updated_at,currency=excluded.currency,gross_sales=excluded.gross_sales,sales_vat=excluded.sales_vat,discounts=excluded.discounts,shipping_charged=excluded.shipping_charged,cancelled=excluded.cancelled,test=excluded.test,financial_status=excluded.financial_status,requires_shipping=excluded.requires_shipping;
 if exists(select 1 from (select value from jsonb_array_elements(coalesce(snapshot->'items','[]')) union all select value from jsonb_array_elements(coalesce(snapshot->'refunds','[]')) union all select value from jsonb_array_elements(coalesce(snapshot->'refundItems','[]'))) rows(x) where x->>'owner_id' is distinct from o.owner_id::text or x->>'integration_account_id' is distinct from o.integration_account_id::text or x->>'order_id' is distinct from o.order_id) then raise exception 'Invalid snapshot scope';end if;
 delete from public.shopify_analytics_items where integration_account_id=o.integration_account_id and order_id=o.order_id;
 delete from public.shopify_analytics_refunds where integration_account_id=o.integration_account_id and order_id=o.order_id;
 insert into public.shopify_analytics_items select * from jsonb_populate_recordset(null::public.shopify_analytics_items,snapshot->'items');
 insert into public.shopify_analytics_refunds select * from jsonb_populate_recordset(null::public.shopify_analytics_refunds,snapshot->'refunds');
 insert into public.shopify_analytics_refund_items select * from jsonb_populate_recordset(null::public.shopify_analytics_refund_items,snapshot->'refundItems');
end;$$;
revoke all on function public.shopify_analytics_ingest(jsonb,uuid) from public,anon,authenticated;grant execute on function public.shopify_analytics_ingest(jsonb,uuid) to service_role;

create function public.shopify_analytics_catalog_batch(owner uuid,store uuid,lease uuid,rows jsonb) returns void language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.shopify_analytics_sync_state st where st.owner_id=owner and st.integration_account_id=store and st.sync_lease=lease and st.sync_lease_until>clock_timestamp() for update;
 if not found then raise exception 'Shopify synchronization lease expired' using errcode='42501';end if;
 if jsonb_typeof(rows) is distinct from 'array' or jsonb_array_length(rows)>1000 or exists(select 1 from jsonb_array_elements(rows) x where x->>'owner_id' is distinct from owner::text or x->>'integration_account_id' is distinct from store::text or x->>'sync_generation' is null) then raise exception 'Invalid catalog snapshot scope';end if;
 insert into public.shopify_analytics_catalog select * from jsonb_populate_recordset(null::public.shopify_analytics_catalog,rows)
 on conflict(integration_account_id,variant_id) do update set seller_sku=excluded.seller_sku,name=excluded.name,image_url=excluded.image_url,inventory_quantity=excluded.inventory_quantity,sync_generation=excluded.sync_generation;
end;$$;
revoke all on function public.shopify_analytics_catalog_batch(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.shopify_analytics_catalog_batch(uuid,uuid,uuid,jsonb) to service_role;
create or replace function public.shopify_analytics_finish_catalog(owner uuid,store uuid,generation uuid,lease uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 if generation is null or lease is null then raise exception 'Catalog synchronization lease expired' using errcode='42501';end if;
 perform 1 from public.shopify_analytics_sync_state st where st.owner_id=owner and st.integration_account_id=store and st.sync_lease=lease and st.sync_lease_until>clock_timestamp() for update;
 if not found then raise exception 'Catalog synchronization lease expired' using errcode='42501';end if;
 delete from public.shopify_analytics_catalog c where c.owner_id=owner and c.integration_account_id=store and c.sync_generation is distinct from generation;
end;$$;
