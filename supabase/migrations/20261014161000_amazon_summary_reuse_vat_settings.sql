CREATE OR REPLACE FUNCTION public.amazon_analytics_summary(from_date date, to_date date, marketplace_ids text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '25s'
AS $function$
declare
  v_timezone text:=private.amazon_analytics_timezone();
  v_owner uuid;
  v_base jsonb;
  v_default_vat numeric;
  v_shipping numeric:=0;
  v_missing bigint:=0;
  v_delta_gross numeric:=0;
  v_delta_vat numeric:=0;
  v_delta_net numeric:=0;
  v_missing_vat_delta bigint:=0;
  v_fallback_missing_fx bigint:=0;
  v_gross_sales numeric:=0;
  v_sales_vat numeric:=0;
  v_net_sales numeric:=0;
  v_missing_vat bigint:=0;
  v_net_profit numeric:=0;
  v_missing_fx bigint:=0;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then raise exception 'Forbidden'; end if;
  if from_date is null or to_date is null or to_date < from_date then raise exception 'Invalid analytics date range'; end if;

  begin
    v_default_vat:=private.amazon_setting_text(v_owner,'defaultVatRate','21')::numeric;
  exception when others then v_default_vat:=21; end;
  v_default_vat:=greatest(0,least(100,v_default_vat));

  v_base:=public.amazon_analytics_summary_without_fbm_20260917(from_date,to_date,marketplace_ids);

  with needs as (
    select
      o.owner_id,o.amazon_account_id,o.marketplace_id,o.amazon_order_id,o.purchase_date,
      o.order_total,o.vat_amount,o.is_business_order,o.currency_code
    from public.amazon_orders o
    where o.owner_id=v_owner
      and o.purchase_date >= (from_date::timestamp at time zone v_timezone)
      and o.purchase_date < ((to_date+1)::timestamp at time zone v_timezone)
      and lower(coalesce(o.order_status,'')) not in ('canceled','cancelled')
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or o.marketplace_id=any(marketplace_ids))
      and (o.order_total is null or o.vat_amount is null)
  ),
  tax_audit_by_order as (
    select c.owner_id,c.amazon_account_id,c.marketplace_id,c.amazon_order_id,sum(c.amount_original) tax_amount
    from private.amazon_finance_components_analytics c
    join needs n
      on n.owner_id=c.owner_id
     and n.amazon_account_id=c.amazon_account_id
     and n.marketplace_id=c.marketplace_id
     and n.amazon_order_id=c.amazon_order_id
    where c.component_category='tax_audit'
      and c.amazon_order_id is not null
    group by c.owner_id,c.amazon_account_id,c.marketplace_id,c.amazon_order_id
  ),
  item_totals as (
    select i.owner_id,i.amazon_account_id,i.marketplace_id,i.amazon_order_id,
      case when count(*) filter(where i.item_price is not null)>0
        then sum(coalesce(i.item_price,0)) end item_total,
      case when count(*) filter(where i.item_price is not null)>0
             and count(*) filter(where i.item_price is not null and i.item_tax is null)=0
        then sum(coalesce(i.item_tax,0)) end item_tax_total
    from public.amazon_order_items i
    join needs n
      on n.owner_id=i.owner_id
     and n.amazon_account_id=i.amazon_account_id
     and n.marketplace_id=i.marketplace_id
     and n.amazon_order_id=i.amazon_order_id
    group by i.owner_id,i.amazon_account_id,i.marketplace_id,i.amazon_order_id
  ),
  corrected as materialized (
    select
      n.order_total base_total,
      coalesce(n.order_total,it.item_total) corrected_total,
      coalesce(n.vat_amount,ta.tax_amount,case when coalesce(n.is_business_order,false) then 0::numeric end) base_vat,
      case when coalesce(n.vat_amount,ta.tax_amount,it.item_tax_total) is not null then coalesce(n.vat_amount,ta.tax_amount,it.item_tax_total)
        when coalesce(n.is_business_order,false) then 0::numeric
        when coalesce(n.order_total,it.item_total) is null then null::numeric
        when v_default_vat=0 then 0::numeric
        else coalesce(n.order_total,it.item_total)-coalesce(n.order_total,it.item_total)/(1+v_default_vat/100) end corrected_vat,
      case when upper(coalesce(nullif(trim(n.currency_code),''),'EUR'))='EUR' then 1::numeric else private.amazon_rate_to_eur(n.currency_code,(n.purchase_date at time zone v_timezone)::date) end order_fx
    from needs n
    left join tax_audit_by_order ta
      on ta.owner_id=n.owner_id
     and ta.amazon_account_id=n.amazon_account_id
     and ta.marketplace_id=n.marketplace_id
     and ta.amazon_order_id=n.amazon_order_id
    left join item_totals it
      on it.owner_id=n.owner_id
     and it.amazon_account_id=n.amazon_account_id
     and it.marketplace_id=n.marketplace_id
     and it.amazon_order_id=n.amazon_order_id
  )
  select
    coalesce(sum(
      (case when corrected_total is not null and order_fx is not null then corrected_total*order_fx else 0 end)
      -(case when base_total is not null and order_fx is not null then base_total*order_fx else 0 end)
    ),0)::numeric,
    coalesce(sum(
      (case when corrected_vat is not null and order_fx is not null then corrected_vat*order_fx else 0 end)
      -(case when base_vat is not null and order_fx is not null then base_vat*order_fx else 0 end)
    ),0)::numeric,
    coalesce(sum(
      (case when corrected_total is not null and order_fx is not null then (corrected_total-coalesce(corrected_vat,0))*order_fx else 0 end)
      -(case when base_total is not null and order_fx is not null then (base_total-coalesce(base_vat,0))*order_fx else 0 end)
    ),0)::numeric,
    coalesce(sum(
      (case when corrected_total is not null and corrected_vat is null then 1 else 0 end)
      -(case when base_total is not null and base_vat is null then 1 else 0 end)
    ),0)::bigint,
    count(*) filter(where base_total is null and corrected_total is not null and order_fx is null)::bigint
  into v_delta_gross,v_delta_vat,v_delta_net,v_missing_vat_delta,v_fallback_missing_fx
  from corrected;

  with merchant_orders as (
    select o.owner_id,o.amazon_order_id,o.purchase_date
    from public.amazon_orders o
    where o.owner_id=v_owner
      and o.purchase_date >= (from_date::timestamp at time zone v_timezone)
      and o.purchase_date < ((to_date+1)::timestamp at time zone v_timezone)
      and lower(coalesce(o.order_status,'')) not in ('canceled','cancelled')
      and o.fulfillment_channel='MERCHANT'
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or o.marketplace_id=any(marketplace_ids))
  ),
  matched as (
    select mo.amazon_order_id,
      fo.shipping_cost_net_amount,
      fo.shipping_cost_currency,
      fo.shipping_cost_recorded_at,
      case when upper(coalesce(nullif(trim(fo.shipping_cost_currency),''),'EUR'))='EUR' then 1::numeric else private.amazon_rate_to_eur(
        coalesce(nullif(fo.shipping_cost_currency,''),'EUR'),
        coalesce((fo.shipping_cost_recorded_at at time zone v_timezone)::date,(mo.purchase_date at time zone v_timezone)::date)
      ) end shipping_fx
    from merchant_orders mo
    left join lateral (
      select candidate.shipping_cost_net_amount,candidate.shipping_cost_currency,candidate.shipping_cost_recorded_at
      from (
        select f.shipping_cost_net_amount,f.shipping_cost_currency,f.shipping_cost_recorded_at,f.last_synced_at
        from public.fulfillment_orders f
        where f.owner_id=mo.owner_id
          and f.source_channel='amazon'
          and f.order_number=mo.amazon_order_id
        union all
        select f.shipping_cost_net_amount,f.shipping_cost_currency,f.shipping_cost_recorded_at,f.last_synced_at
        from public.fulfillment_orders f
        where f.owner_id=mo.owner_id
          and f.source_channel='amazon'
          and f.order_id=mo.amazon_order_id
          and f.order_number is distinct from mo.amazon_order_id
      ) candidate
      order by candidate.shipping_cost_recorded_at desc nulls last,candidate.last_synced_at desc nulls last
      limit 1
    ) fo on true
  )
  select
    coalesce(sum(case when shipping_cost_net_amount is not null and shipping_fx is not null then shipping_cost_net_amount*shipping_fx else 0 end),0)::numeric,
    count(*) filter(where shipping_cost_net_amount is null or shipping_fx is null)::bigint
  into v_shipping,v_missing
  from matched;

  v_gross_sales:=coalesce((v_base->>'grossSales')::numeric,0)+v_delta_gross;
  v_sales_vat:=coalesce((v_base->>'salesVat')::numeric,0)+v_delta_vat;
  v_net_sales:=coalesce((v_base->>'netSales')::numeric,0)+v_delta_net;
  v_missing_vat:=greatest(0,coalesce((v_base->>'missingVatOrderCount')::bigint,0)+v_missing_vat_delta);
  v_net_profit:=coalesce((v_base->>'netProfit')::numeric,0)+v_delta_net-v_shipping;
  v_missing_fx:=coalesce((v_base->>'missingFxEventCount')::bigint,0)+v_fallback_missing_fx;

  return v_base || jsonb_build_object(
    'grossSales',round(v_gross_sales,2),
    'salesVat',round(v_sales_vat,2),
    'netSales',round(v_net_sales,2),
    'fbmShippingCost',round(v_shipping,2),
    'netProfit',round(v_net_profit,2),
    'marginPct',case when v_net_sales<>0 then round(v_net_profit/v_net_sales*100,2) else null end,
    'missingVatOrderCount',v_missing_vat,
    'missingFxEventCount',v_missing_fx,
    'missingFbmShippingCostCount',v_missing,
    'profitComplete',
      coalesce((v_base->>'profitComplete')::boolean,false)
      and v_missing=0
      and v_missing_vat=0
      and v_fallback_missing_fx=0
  );
end;
$function$
;

