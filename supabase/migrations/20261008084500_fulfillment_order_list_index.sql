-- Match the operational list ordering, including NULL placement and a stable tie breaker.
create index if not exists fulfillment_orders_owner_list_idx on public.fulfillment_orders(owner_id,order_created_at desc nulls last,id desc);
