-- Service-only transactional ingestion prevents partially replaced financial snapshots.
create function public.shopify_analytics_ingest(snapshot jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare o public.shopify_analytics_orders;begin
 o:=jsonb_populate_record(null::public.shopify_analytics_orders,snapshot->'order');
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
revoke all on function public.shopify_analytics_ingest(jsonb) from public,anon,authenticated;grant execute on function public.shopify_analytics_ingest(jsonb) to service_role;
