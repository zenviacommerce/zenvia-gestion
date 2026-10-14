-- Retain marketplace filtering for linked refunds whose finance event has no marketplace.
do $migration$
declare fn record; definition text; updated text;
begin
  for fn in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('amazon_analytics_detail','amazon_analytics_products','amazon_analytics_summary_without_fbm_20260917','amazon_analytics_series_without_fbm_20260917')
  loop
    definition:=pg_get_functiondef(fn.oid);
    updated:=replace(definition,$old$and (marketplace_ids is null or cardinality(marketplace_ids)=0 or c.marketplace_id=any(marketplace_ids))$old$,$new$and (marketplace_ids is null or cardinality(marketplace_ids)=0 or c.marketplace_id=any(marketplace_ids)
        or (c.component_category='refund' and c.marketplace_id is null and exists (
          select 1 from public.amazon_orders refund_order where refund_order.owner_id=c.owner_id
            and refund_order.amazon_account_id=c.amazon_account_id and refund_order.amazon_order_id=c.amazon_order_id
            and refund_order.marketplace_id=any(marketplace_ids))))$new$);
    if updated=definition then raise exception 'Refund marketplace filter not found in %',fn.oid; end if;
    execute updated;
  end loop;
end;
$migration$;

