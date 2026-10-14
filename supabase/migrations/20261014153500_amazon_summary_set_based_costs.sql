CREATE OR REPLACE FUNCTION public.amazon_analytics_summary_without_fbm_20260917(from_date date, to_date date, marketplace_ids text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '20s'
AS $function$
declare
  v_timezone text:=private.amazon_analytics_timezone();
  v_owner uuid;
  v_result jsonb;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then raise exception 'Forbidden'; end if;
  if from_date is null or to_date is null or to_date < from_date then raise exception 'Invalid analytics date range'; end if;

  with tax_audit_by_order as (
    select c.owner_id,c.amazon_account_id,c.marketplace_id,c.amazon_order_id,
           sum(c.amount_original) as tax_amount
    from private.amazon_finance_components_analytics c
    where c.owner_id=v_owner
      and c.component_category='tax_audit'
      and c.amazon_order_id is not null
      and exists (
        select 1 from public.amazon_orders scoped
        where scoped.owner_id=c.owner_id
          and scoped.amazon_account_id=c.amazon_account_id
          and scoped.marketplace_id=c.marketplace_id
          and scoped.amazon_order_id=c.amazon_order_id
          and scoped.purchase_date >= (from_date::timestamp at time zone v_timezone)
          and scoped.purchase_date < ((to_date+1)::timestamp at time zone v_timezone)
          and lower(coalesce(scoped.order_status,'')) not in ('canceled','cancelled')
          and (marketplace_ids is null or cardinality(marketplace_ids)=0 or scoped.marketplace_id=any(marketplace_ids))
      )
    group by c.owner_id,c.amazon_account_id,c.marketplace_id,c.amazon_order_id
  ),
  eligible_orders as (
    select o.*,
           coalesce(o.vat_amount,ta.tax_amount,case when coalesce(o.is_business_order,false) then 0::numeric end) as effective_vat_amount,
           (case when upper(coalesce(nullif(trim(o.currency_code),''),'EUR'))='EUR' then 1::numeric else private.amazon_rate_to_eur(o.currency_code,(o.purchase_date at time zone v_timezone)::date) end) as order_fx
    from public.amazon_orders o
    left join tax_audit_by_order ta
      on ta.owner_id=o.owner_id
     and ta.amazon_account_id=o.amazon_account_id
     and ta.marketplace_id=o.marketplace_id
     and ta.amazon_order_id=o.amazon_order_id
    where o.owner_id=v_owner
      and o.purchase_date >= (from_date::timestamp at time zone v_timezone)
      and o.purchase_date < ((to_date+1)::timestamp at time zone v_timezone)
      and lower(coalesce(o.order_status,'')) not in ('canceled','cancelled')
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or o.marketplace_id=any(marketplace_ids))
  ),
  order_metrics as (
    select
      count(distinct amazon_order_id)::bigint as orders,
      count(distinct amazon_order_id) filter(where coalesce(is_business_order,false))::bigint as business_orders,
      coalesce(sum(case when order_total is not null and order_fx is not null then order_total*order_fx else 0 end),0)::numeric as gross_sales,
      coalesce(sum(case when effective_vat_amount is not null and order_fx is not null then effective_vat_amount*order_fx else 0 end),0)::numeric as sales_vat,
      coalesce(sum(case when order_total is not null and order_fx is not null then (order_total-coalesce(effective_vat_amount,0))*order_fx else 0 end),0)::numeric as net_sales,
      count(*) filter(where order_total is not null and effective_vat_amount is null)::bigint as missing_vat_orders,
      count(*) filter(where order_total is not null and order_fx is null)::bigint as missing_order_fx
    from eligible_orders
  ),
  item_identity as materialized (
    select i.owner_id,i.amazon_account_id,i.marketplace_id,i.amazon_order_id,i.seller_sku,i.asin,i.quantity_ordered,
      (eo.purchase_date at time zone v_timezone)::date as purchase_date
    from public.amazon_order_items i join eligible_orders eo
      on eo.owner_id=i.owner_id and eo.amazon_account_id=i.amazon_account_id and eo.marketplace_id=i.marketplace_id and eo.amazon_order_id=i.amazon_order_id
  ),
  cost_keys as materialized (
    select distinct owner_id,amazon_account_id,seller_sku,purchase_date from item_identity
  ),
  mapped_prices as materialized (
    select k.*,m.id mapping_id,m.consumption_factor,h.normalized_unit_price,
      case when h.price_date is null then null::numeric
        when upper(coalesce(nullif(trim(h.currency),''),'EUR'))='EUR' then 1::numeric
        else private.amazon_rate_to_eur(h.currency,h.price_date) end cost_fx
    from cost_keys k left join public.amazon_product_mappings m
      on m.owner_id=k.owner_id and m.amazon_account_id=k.amazon_account_id and m.seller_sku=k.seller_sku
    left join lateral (
      select ph.normalized_unit_price,ph.currency,ph.price_date from public.product_price_history ph
      where ph.owner_id=k.owner_id and ph.product_id=m.product_id and ph.normalized_unit_price is not null and ph.price_date<=k.purchase_date
      order by ph.price_date desc,ph.created_at desc,ph.id desc limit 1
    ) h on true
  ),
  cost_snapshots as materialized (
    select owner_id,amazon_account_id,seller_sku,purchase_date,count(mapping_id)::bigint mapping_count,
      coalesce(sum(case when normalized_unit_price is not null and cost_fx is not null then consumption_factor*normalized_unit_price*cost_fx else 0 end),0)::numeric mapped_unit_cost_eur,
      count(*) filter(where mapping_id is not null and normalized_unit_price is null)::bigint missing_historical_count,
      count(*) filter(where mapping_id is not null and normalized_unit_price is not null and cost_fx is null)::bigint missing_cost_fx_count
    from mapped_prices group by owner_id,amazon_account_id,seller_sku,purchase_date
  ),
  item_rows as (
    select i.*,c.mapping_count,c.mapped_unit_cost_eur,c.missing_historical_count,c.missing_cost_fx_count
    from item_identity i join cost_snapshots c
      on c.owner_id=i.owner_id and c.amazon_account_id=i.amazon_account_id and c.seller_sku is not distinct from i.seller_sku and c.purchase_date=i.purchase_date
  ),
  item_metrics as (
    select
      coalesce(sum(quantity_ordered),0)::bigint as units,
      coalesce(sum(case when mapping_count>0 then quantity_ordered*mapped_unit_cost_eur else 0 end),0)::numeric as product_cost,
      count(distinct seller_sku) filter(where seller_sku is not null and mapping_count=0)::bigint as unmapped_skus,
      coalesce(sum(quantity_ordered) filter(where mapping_count=0),0)::bigint as unmapped_units,
      count(distinct seller_sku) filter(where mapping_count>0 and missing_historical_count>0)::bigint as missing_historical_cost,
      coalesce(sum(quantity_ordered) filter(where mapping_count>0 and missing_historical_count>0),0)::bigint as missing_historical_cost_units,
      coalesce(sum(missing_cost_fx_count),0)::bigint as missing_cost_fx
    from item_rows
  ),
  finance_rows as materialized (
    select c.finance_transaction_id,c.component_category,c.amount_original,c.tax_amount_original,
           (case when c.posted_date is null then null::numeric when upper(coalesce(nullif(trim(c.currency_code),''),'EUR'))='EUR' then 1::numeric else private.amazon_rate_to_eur(c.currency_code,(c.posted_date at time zone v_timezone)::date) end) as finance_fx
    from private.amazon_finance_components_analytics c
    join eligible_orders eo
      on eo.owner_id=c.owner_id
     and eo.amazon_account_id=c.amazon_account_id
     and eo.amazon_order_id=c.amazon_order_id
     and (c.marketplace_id is null or c.marketplace_id=eo.marketplace_id)
    where c.owner_id=v_owner
      and nullif(c.amazon_order_id,'') is not null
      and c.component_category<>'refund'
      and c.component_category not in ('sale_audit','tax_audit')
    union all
    select c.finance_transaction_id,c.component_category,c.amount_original,c.tax_amount_original,
           (case when c.posted_date is null then null::numeric when upper(coalesce(nullif(trim(c.currency_code),''),'EUR'))='EUR' then 1::numeric else private.amazon_rate_to_eur(c.currency_code,(c.posted_date at time zone v_timezone)::date) end) as finance_fx
    from private.amazon_finance_components_analytics c
    where c.owner_id=v_owner
      and (nullif(c.amazon_order_id,'') is null or c.component_category='refund')
      and c.posted_date >= (from_date::timestamp at time zone v_timezone)
      and c.posted_date < ((to_date+1)::timestamp at time zone v_timezone)
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or c.marketplace_id=any(marketplace_ids)
        or (c.component_category='refund' and c.marketplace_id is null and exists (
          select 1 from public.amazon_orders refund_order where refund_order.owner_id=c.owner_id
            and refund_order.amazon_account_id=c.amazon_account_id and refund_order.amazon_order_id=c.amazon_order_id
            and refund_order.marketplace_id=any(marketplace_ids))))
      and c.component_category not in ('sale_audit','tax_audit')
  ),
  finance_metrics as (
    select
      count(distinct finance_transaction_id) filter(where component_category='refund')::bigint as refund_transactions,
      coalesce(sum(-amount_original*finance_fx) filter(where component_category='refund' and finance_fx is not null),0)::numeric as refund_gross_impact,
      coalesce(sum((amount_original-coalesce(tax_amount_original,0))*finance_fx) filter(where component_category in ('commission_fee','fba_fee','digital_services_fee','storage_fee','other_amazon_fee') and finance_fx is not null),0)::numeric as amazon_fee_effect,
      coalesce(sum(coalesce(tax_amount_original,0)*finance_fx) filter(where component_category in ('commission_fee','fba_fee','digital_services_fee','storage_fee','other_amazon_fee') and finance_fx is not null),0)::numeric as amazon_fee_vat_effect,
      coalesce(sum((amount_original-coalesce(tax_amount_original,0))*finance_fx) filter(where component_category='refund' and finance_fx is not null),0)::numeric as refund_effect,
      coalesce(sum((amount_original-coalesce(tax_amount_original,0))*finance_fx) filter(where component_category='ads_payment_excluded' and finance_fx is not null),0)::numeric as ads_effect,
      coalesce(sum((amount_original-coalesce(tax_amount_original,0))*finance_fx) filter(where component_category='adjustment' and finance_fx is not null),0)::numeric as adjustment_effect,
      count(*) filter(where amount_original<>0 and finance_fx is null)::bigint as missing_finance_fx
    from finance_rows
  ),
  sync_metrics as (
    select count(*) filter(where j.status='queued')::bigint as sync_queued,
      count(*) filter(where j.status='running')::bigint as sync_running,
      count(*) filter(where j.status='failed')::bigint as sync_failed
    from public.amazon_sync_jobs j
    where j.owner_id=v_owner and j.status in ('queued','running','failed')
      and j.source in ('orders','finances')
      and coalesce(j.window_to,'infinity'::timestamptz) >= (from_date::timestamp at time zone v_timezone)
      and coalesce(j.window_from,'-infinity'::timestamptz) < ((to_date+1)::timestamp at time zone v_timezone)
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or j.marketplace_id=any(marketplace_ids))
  ),
  combined as (
    select om.orders,om.business_orders,im.units,om.gross_sales,om.sales_vat,om.net_sales,
      -fm.amazon_fee_effect as amazon_fees,
      -fm.amazon_fee_vat_effect as amazon_fee_vat,
      -fm.refund_effect as refunds,
      -fm.ads_effect as ads_cost,
      fm.adjustment_effect as amazon_adjustments,
      im.product_cost,0::numeric as fbm_shipping_cost,
      (om.net_sales+fm.amazon_fee_effect+fm.refund_effect+fm.ads_effect+fm.adjustment_effect-im.product_cost) as net_profit,
      im.unmapped_skus,im.unmapped_units,im.missing_historical_cost,im.missing_historical_cost_units,
      (om.missing_order_fx+fm.missing_finance_fx+im.missing_cost_fx)::bigint as missing_fx_events,om.missing_vat_orders,
      sm.sync_queued,sm.sync_running,sm.sync_failed,fm.refund_transactions,fm.refund_gross_impact
    from order_metrics om cross join item_metrics im cross join finance_metrics fm cross join sync_metrics sm
  )
  select jsonb_build_object(
    'grossSales',round(gross_sales,2),'salesVat',round(sales_vat,2),'netSales',round(net_sales,2),
    'orders',orders,'businessOrders',business_orders,'units',units,'amazonFees',round(amazon_fees,2),'amazonFeeVat',round(amazon_fee_vat,2),
    'refunds',round(refunds,2),'refundTransactions',refund_transactions,'refundGrossImpact',round(refund_gross_impact,2),'adsCost',round(ads_cost,2),'amazonAdjustments',round(amazon_adjustments,2),
    'productCost',round(product_cost,2),'fbmShippingCost',round(fbm_shipping_cost,2),'netProfit',round(net_profit,2),
    'marginPct',case when net_sales<>0 then round(net_profit/net_sales*100,2) else null end,
    'unmappedSkuCount',unmapped_skus,'unmappedUnits',unmapped_units,'missingHistoricalCostCount',missing_historical_cost,'missingHistoricalCostUnits',missing_historical_cost_units,
    'missingFxEventCount',missing_fx_events,'missingVatOrderCount',missing_vat_orders,'syncQueued',sync_queued,'syncRunning',sync_running,'syncFailed',sync_failed,
    'adsExcluded',false,
    'profitComplete',(unmapped_skus=0 and missing_historical_cost=0 and missing_fx_events=0 and missing_vat_orders=0 and sync_queued=0 and sync_running=0 and sync_failed=0)
  ) into v_result from combined;

  return coalesce(v_result,jsonb_build_object(
    'grossSales',0,'salesVat',0,'netSales',0,'orders',0,'businessOrders',0,'units',0,'amazonFees',0,'amazonFeeVat',0,'refunds',0,'adsCost',0,'amazonAdjustments',0,
    'productCost',0,'fbmShippingCost',0,'netProfit',0,'marginPct',null,'unmappedSkuCount',0,'unmappedUnits',0,'missingHistoricalCostCount',0,
    'missingHistoricalCostUnits',0,'missingFxEventCount',0,'missingVatOrderCount',0,'syncQueued',0,'syncRunning',0,'syncFailed',0,'adsExcluded',false,'profitComplete',true
  ));
end;
$function$;
