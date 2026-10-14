-- Use the workspace calendar for all Amazon analytics, and recognize refunds on their transaction date.
create or replace function private.amazon_analytics_timezone()
returns text language sql stable security definer set search_path='' as $$
  select coalesce((select z.name from public.app_settings s join pg_catalog.pg_timezone_names z
    on z.name=s.config->'general'->>'timezone' where s.owner_id=private.app_workspace_owner_id() limit 1),'Europe/Madrid')
$$;
revoke all on function private.amazon_analytics_timezone() from public,anon;
grant execute on function private.amazon_analytics_timezone() to authenticated;

CREATE OR REPLACE FUNCTION public.amazon_analytics_detail(from_date date, to_date date, marketplace_ids text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_timezone text:=private.amazon_analytics_timezone();
  v_owner uuid;
  v_result jsonb;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then
    raise exception 'Forbidden';
  end if;
  if from_date is null or to_date is null or to_date<from_date then
    raise exception 'Invalid analytics date range';
  end if;

  with eligible_orders as (
    select o.*,
           private.amazon_rate_to_eur(o.currency_code,(o.purchase_date at time zone v_timezone)::date) as order_fx
    from public.amazon_orders o
    where o.owner_id=v_owner
      and o.purchase_date >= (from_date::timestamp at time zone v_timezone)
      and o.purchase_date < ((to_date+1)::timestamp at time zone v_timezone)
      and lower(coalesce(o.order_status,'')) not in ('canceled','cancelled')
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or o.marketplace_id=any(marketplace_ids))
  ),
  item_metrics as (
    select
      count(*)::bigint as order_lines,
      coalesce(sum(case when eo.order_fx is not null then coalesce(i.promotion_discount,0)*eo.order_fx else 0 end),0)::numeric as promotion_discounts,
      coalesce(sum(case when eo.order_fx is not null then coalesce(i.shipping_price,0)*eo.order_fx else 0 end),0)::numeric as shipping_charged,
      coalesce(sum(case when eo.order_fx is not null then coalesce(i.shipping_tax,0)*eo.order_fx else 0 end),0)::numeric as shipping_tax
    from public.amazon_order_items i
    join eligible_orders eo
      on eo.owner_id=i.owner_id
     and eo.amazon_account_id=i.amazon_account_id
     and eo.marketplace_id=i.marketplace_id
     and eo.amazon_order_id=i.amazon_order_id
  ),
  finance_rows as materialized (
    select c.finance_transaction_id,c.amazon_order_id,c.component_category,
           c.amount_original,c.tax_amount_original,c.currency_code,c.posted_date,
           private.amazon_rate_to_eur(c.currency_code,(c.posted_date at time zone v_timezone)::date) as finance_fx
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
    select c.finance_transaction_id,c.amazon_order_id,c.component_category,
           c.amount_original,c.tax_amount_original,c.currency_code,c.posted_date,
           private.amazon_rate_to_eur(c.currency_code,(c.posted_date at time zone v_timezone)::date) as finance_fx
    from private.amazon_finance_components_analytics c
    where c.owner_id=v_owner
      and (nullif(c.amazon_order_id,'') is null or c.component_category='refund')
      and c.posted_date >= (from_date::timestamp at time zone v_timezone)
      and c.posted_date < ((to_date+1)::timestamp at time zone v_timezone)
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or c.marketplace_id=any(marketplace_ids))
      and c.component_category not in ('sale_audit','tax_audit')
  ),
  finance_metrics as (
    select
      count(distinct finance_transaction_id) filter(where component_category='refund')::bigint as refund_transactions,
      count(distinct amazon_order_id) filter(where component_category='refund' and amazon_order_id is not null)::bigint as refund_orders,
      coalesce(sum(-amount_original*finance_fx) filter(where component_category='refund' and finance_fx is not null),0)::numeric as refund_gross_impact,
      coalesce(sum(-coalesce(tax_amount_original,0)*finance_fx) filter(where component_category='refund' and finance_fx is not null),0)::numeric as refund_tax_impact,
      coalesce(sum(-(amount_original-coalesce(tax_amount_original,0))*finance_fx) filter(where component_category='commission_fee' and finance_fx is not null),0)::numeric as commission_fees,
      coalesce(sum(-(amount_original-coalesce(tax_amount_original,0))*finance_fx) filter(where component_category='fba_fee' and finance_fx is not null),0)::numeric as fba_fees,
      coalesce(sum(-(amount_original-coalesce(tax_amount_original,0))*finance_fx) filter(where component_category='digital_services_fee' and finance_fx is not null),0)::numeric as digital_services_fees,
      coalesce(sum(-(amount_original-coalesce(tax_amount_original,0))*finance_fx) filter(where component_category='storage_fee' and finance_fx is not null),0)::numeric as storage_fees,
      coalesce(sum(-(amount_original-coalesce(tax_amount_original,0))*finance_fx) filter(where component_category='other_amazon_fee' and finance_fx is not null),0)::numeric as other_amazon_fees
    from finance_rows
  )
  select jsonb_build_object(
    'orderLines',im.order_lines,
    'promotionDiscounts',round(im.promotion_discounts,2),
    'shippingCharged',round(im.shipping_charged,2),
    'shippingTax',round(im.shipping_tax,2),
    'refundTransactions',fm.refund_transactions,
    'refundOrders',fm.refund_orders,
    'refundGrossImpact',round(fm.refund_gross_impact,2),
    'refundTaxImpact',round(fm.refund_tax_impact,2),
    'commissionFees',round(fm.commission_fees,2),
    'fbaFees',round(fm.fba_fees,2),
    'digitalServicesFees',round(fm.digital_services_fees,2),
    'storageFees',round(fm.storage_fees,2),
    'otherAmazonFees',round(fm.other_amazon_fees,2)
  )
  into v_result
  from item_metrics im cross join finance_metrics fm;

  return coalesce(v_result,jsonb_build_object(
    'orderLines',0,'promotionDiscounts',0,'shippingCharged',0,'shippingTax',0,
    'refundTransactions',0,'refundOrders',0,'refundGrossImpact',0,'refundTaxImpact',0,
    'commissionFees',0,'fbaFees',0,'digitalServicesFees',0,'storageFees',0,'otherAmazonFees',0
  ));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.amazon_analytics_orders(from_date date, to_date date, marketplace_ids text[] DEFAULT NULL::text[], search text DEFAULT NULL::text, page integer DEFAULT 1, page_size integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_timezone text:=private.amazon_analytics_timezone(); v_owner uuid; v_result jsonb;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then raise exception 'Forbidden'; end if;
  if from_date is null or to_date is null or to_date<from_date then raise exception 'Invalid analytics date range'; end if;
  if page<1 or page_size<1 or page_size>100 then raise exception 'Invalid pagination'; end if;

  with orders as (
    select o.*,private.amazon_rate_to_eur(o.currency_code,(o.purchase_date at time zone v_timezone)::date) order_fx
    from public.amazon_orders o
    where o.owner_id=v_owner
      and o.purchase_date >= (from_date::timestamp at time zone v_timezone) and o.purchase_date < ((to_date+1)::timestamp at time zone v_timezone)
      and lower(coalesce(o.order_status,'')) not in ('canceled','cancelled')
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or o.marketplace_id=any(marketplace_ids))
      and (coalesce(search,'')='' or o.amazon_order_id ilike '%'||search||'%')
  ),
  item_rows as (
    select i.amazon_order_id,i.marketplace_id,i.quantity_ordered,
      coalesce(mc.mapping_count,0) mapping_count,
      coalesce(mc.unit_cost_eur,0) mapped_unit_cost_eur,
      coalesce(mc.missing_historical_count,0) missing_historical_count,
      coalesce(mc.missing_fx_count,0) missing_cost_fx_count
    from public.amazon_order_items i
    join orders o
      on o.owner_id=i.owner_id and o.amazon_account_id=i.amazon_account_id and o.marketplace_id=i.marketplace_id and o.amazon_order_id=i.amazon_order_id
    left join lateral private.amazon_mapping_cost_snapshot(
      i.owner_id,i.amazon_account_id,i.seller_sku,(o.purchase_date at time zone v_timezone)::date
    ) mc on true
  ),
  items as (
    select amazon_order_id,marketplace_id,sum(quantity_ordered)::bigint units,
      coalesce(sum(case when mapping_count>0 then quantity_ordered*mapped_unit_cost_eur else 0 end),0)::numeric product_cost,
      bool_and(mapping_count>0 and missing_historical_count=0 and missing_cost_fx_count=0) item_complete
    from item_rows
    group by amazon_order_id,marketplace_id
  ),
  finance as (
    select c.amazon_order_id,c.marketplace_id,
      coalesce(sum(c.amount_original*private.amazon_rate_to_eur(c.currency_code,(c.posted_date at time zone v_timezone)::date)) filter(where c.component_category in ('commission_fee','fba_fee','digital_services_fee','storage_fee','other_amazon_fee','adjustment')),0)::numeric fee_effect,
      coalesce(sum(c.amount_original*private.amazon_rate_to_eur(c.currency_code,(c.posted_date at time zone v_timezone)::date)) filter(where c.component_category='refund'),0)::numeric refund_effect,
      count(*) filter(where c.amount_original<>0 and private.amazon_rate_to_eur(c.currency_code,(c.posted_date at time zone v_timezone)::date) is null)::bigint missing_fx
    from private.amazon_finance_components_analytics c
    join orders o on o.amazon_order_id=c.amazon_order_id and o.marketplace_id=c.marketplace_id
    where c.owner_id=v_owner and c.component_category not in ('sale_audit','tax_audit','ads_payment_excluded')
    group by c.amazon_order_id,c.marketplace_id
  ),
  combined as (
    select o.amazon_order_id,o.purchase_date,o.marketplace_id,o.order_status,coalesce(i.units,0) units,
      case when o.order_total is not null and o.order_fx is not null then
        (o.order_total-private.amazon_effective_vat_amount(v_owner,o.order_total,o.vat_amount,coalesce(o.is_business_order,false)))*o.order_fx
        else 0 end::numeric net_sales,
      coalesce(f.fee_effect,0) fee_effect,coalesce(f.refund_effect,0) refund_effect,coalesce(i.product_cost,0) product_cost,
      (o.order_total is not null
        and private.amazon_effective_vat_amount(v_owner,o.order_total,o.vat_amount,coalesce(o.is_business_order,false)) is not null
        and o.order_fx is not null
        and coalesce(i.item_complete,false)
        and coalesce(f.missing_fx,0)=0) row_complete,
      count(*) over() total_rows
    from orders o
    left join items i on i.amazon_order_id=o.amazon_order_id and i.marketplace_id=o.marketplace_id
    left join finance f on f.amazon_order_id=o.amazon_order_id and f.marketplace_id=o.marketplace_id
  ),
  paged as (
    select * from combined order by purchase_date desc offset (page-1)*page_size limit page_size
  ),
  sync_bad as (
    select exists(select 1 from public.amazon_sync_jobs j where j.owner_id=v_owner and j.status in ('queued','running','failed')) value
  )
  select jsonb_build_object(
    'items',coalesce(jsonb_agg(jsonb_build_object(
      'amazonOrderId',amazon_order_id,'purchaseDate',purchase_date,'marketplaceId',marketplace_id,'status',order_status,'units',units,
      'netSales',round(net_sales,2),'amazonFees',round(-fee_effect,2),'refunds',round(-refund_effect,2),'productCost',round(product_cost,2),
      'profitBeforeAds',round(net_sales+fee_effect+refund_effect-product_cost,2),'profitComplete',(row_complete and not sb.value)
    ) order by purchase_date desc),'[]'::jsonb),
    'page',page,'pageSize',page_size,'total',coalesce(max(total_rows),0)
  ) into v_result
  from paged cross join sync_bad sb;

  return coalesce(v_result,jsonb_build_object('items','[]'::jsonb,'page',page,'pageSize',page_size,'total',0));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.amazon_analytics_products(from_date date, to_date date, marketplace_ids text[] DEFAULT NULL::text[], search text DEFAULT NULL::text, page integer DEFAULT 1, page_size integer DEFAULT 50, sort_by text DEFAULT 'profit_before_ads'::text, sort_dir text DEFAULT 'desc'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_timezone text:=private.amazon_analytics_timezone(); v_owner uuid; v_result jsonb;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then raise exception 'Forbidden'; end if;
  if from_date is null or to_date is null or to_date<from_date then raise exception 'Invalid analytics date range'; end if;
  if page<1 or page_size<1 or page_size>100 then raise exception 'Invalid pagination'; end if;
  if sort_by not in ('product_name','orders','units','gross_sales','net_sales','product_cost','amazon_fees','refunds','profit_before_ads','margin_pct') then raise exception 'Invalid sort'; end if;
  if sort_dir not in ('asc','desc') then raise exception 'Invalid sort direction'; end if;

  with eligible_orders as (
    select o.*,private.amazon_rate_to_eur(o.currency_code,(o.purchase_date at time zone v_timezone)::date) order_fx
    from public.amazon_orders o
    where o.owner_id=v_owner
      and o.purchase_date >= (from_date::timestamp at time zone v_timezone) and o.purchase_date < ((to_date+1)::timestamp at time zone v_timezone)
      and lower(coalesce(o.order_status,'')) not in ('canceled','cancelled')
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or o.marketplace_id=any(marketplace_ids))
  ),
  item_facts as (
    select i.amazon_order_id,i.amazon_account_id,i.seller_sku,i.asin,i.quantity_ordered,i.item_price,i.item_tax,
      eo.order_fx,(eo.purchase_date at time zone v_timezone)::date purchase_date,coalesce(eo.is_business_order,false) is_business_order,
      coalesce(mc.mapping_count,0) mapping_count,
      coalesce(mc.unit_cost_eur,0) mapped_unit_cost_eur,
      coalesce(mc.missing_historical_count,0) missing_historical_count,
      coalesce(mc.missing_fx_count,0) missing_cost_fx_count,
      private.amazon_effective_vat_amount(v_owner,i.item_price,i.item_tax,coalesce(eo.is_business_order,false)) effective_item_tax
    from public.amazon_order_items i
    join eligible_orders eo
      on eo.owner_id=i.owner_id and eo.amazon_account_id=i.amazon_account_id and eo.marketplace_id=i.marketplace_id and eo.amazon_order_id=i.amazon_order_id
    left join lateral private.amazon_mapping_cost_snapshot(
      i.owner_id,i.amazon_account_id,i.seller_sku,(eo.purchase_date at time zone v_timezone)::date
    ) mc on true
    where coalesce(search,'')=''
       or i.seller_sku ilike '%'||search||'%'
       or i.asin ilike '%'||search||'%'
       or exists (
         select 1
         from public.amazon_product_mappings sm
         join public.products sp on sp.id=sm.product_id and sp.owner_id=sm.owner_id
         left join public.suppliers ss on ss.id=sp.last_supplier_id and ss.owner_id=sp.owner_id
         where sm.owner_id=i.owner_id
           and sm.amazon_account_id=i.amazon_account_id
           and sm.seller_sku=i.seller_sku
           and (sp.name ilike '%'||search||'%' or sp.sku ilike '%'||search||'%' or ss.name ilike '%'||search||'%')
       )
  ),
  item_group as (
    select seller_sku,asin,
      count(distinct amazon_order_id)::bigint orders,
      count(distinct amazon_order_id) filter(where is_business_order)::bigint business_orders,
      sum(quantity_ordered)::bigint units,
      coalesce(sum(case when item_price is not null and order_fx is not null then item_price*order_fx else 0 end),0)::numeric gross_sales,
      coalesce(sum(case when effective_item_tax is not null and order_fx is not null then effective_item_tax*order_fx else 0 end),0)::numeric sales_vat,
      coalesce(sum(case when item_price is not null and order_fx is not null then (item_price-coalesce(effective_item_tax,0))*order_fx else 0 end),0)::numeric net_sales,
      count(distinct amazon_order_id) filter(where item_price is not null and effective_item_tax is null)::bigint missing_vat_orders,
      coalesce(sum(case when mapping_count>0 then quantity_ordered*mapped_unit_cost_eur else 0 end),0)::numeric product_cost,
      bool_and(mapping_count>0 and missing_historical_count=0 and missing_cost_fx_count=0 and (item_price is null or order_fx is not null)) item_complete
    from item_facts
    group by seller_sku,asin
  ),
  mapping_rows as (
    select distinct on (m.seller_sku,m.product_id)
      m.seller_sku,m.id mapping_id,m.product_id,p.name product_name,p.sku product_sku,s.name supplier_name,m.consumption_factor,m.updated_at
    from public.amazon_product_mappings m
    join public.amazon_accounts ma on ma.id=m.amazon_account_id and ma.owner_id=m.owner_id and ma.status='connected'
    join public.products p on p.id=m.product_id and p.owner_id=m.owner_id
    left join public.suppliers s on s.id=p.last_supplier_id and s.owner_id=p.owner_id
    where m.owner_id=v_owner
    order by m.seller_sku,m.product_id,m.updated_at desc
  ),
  mapping_metadata as (
    select seller_sku,
      (array_agg(product_id order by product_name,product_id))[1] first_product_id,
      (array_agg(consumption_factor order by product_name,product_id))[1] first_consumption_factor,
      string_agg(product_name,' + ' order by product_name,product_id) product_name,
      jsonb_agg(jsonb_build_object(
        'id',mapping_id,'productId',product_id,'productName',product_name,'productSku',product_sku,
        'supplierName',supplier_name,'consumptionFactor',consumption_factor
      ) order by product_name,product_id) product_mappings
    from mapping_rows
    group by seller_sku
  ),
  finance_rows as (
    select c.seller_sku,c.asin,c.component_category,c.amount_original,c.tax_amount_original,c.currency_code,c.posted_date
    from private.amazon_finance_components_analytics c
    join eligible_orders eo
      on eo.owner_id=c.owner_id
     and eo.amazon_account_id=c.amazon_account_id
     and eo.amazon_order_id=c.amazon_order_id
     and (c.marketplace_id is null or c.marketplace_id=eo.marketplace_id)
    where c.owner_id=v_owner
      and nullif(c.amazon_order_id,'') is not null
      and c.component_category<>'refund'
      and c.seller_sku is not null
      and c.component_category not in ('sale_audit','tax_audit','ads_payment_excluded')
    union all
    select c.seller_sku,c.asin,c.component_category,c.amount_original,c.tax_amount_original,c.currency_code,c.posted_date
    from private.amazon_finance_components_analytics c
    where c.owner_id=v_owner
      and (nullif(c.amazon_order_id,'') is null or c.component_category='refund')
      and c.seller_sku is not null
      and c.posted_date >= (from_date::timestamp at time zone v_timezone) and c.posted_date < ((to_date+1)::timestamp at time zone v_timezone)
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or c.marketplace_id=any(marketplace_ids))
      and c.component_category not in ('sale_audit','tax_audit','ads_payment_excluded')
  ),
  finance_group as (
    select c.seller_sku,c.asin,
      coalesce(sum((c.amount_original-coalesce(c.tax_amount_original,0))*private.amazon_rate_to_eur(c.currency_code,(c.posted_date at time zone v_timezone)::date))
        filter(where c.component_category in ('commission_fee','fba_fee','digital_services_fee','storage_fee','other_amazon_fee')),0)::numeric fee_effect,
      coalesce(sum(coalesce(c.tax_amount_original,0)*private.amazon_rate_to_eur(c.currency_code,(c.posted_date at time zone v_timezone)::date))
        filter(where c.component_category in ('commission_fee','fba_fee','digital_services_fee','storage_fee','other_amazon_fee')),0)::numeric fee_vat_effect,
      coalesce(sum((c.amount_original-coalesce(c.tax_amount_original,0))*private.amazon_rate_to_eur(c.currency_code,(c.posted_date at time zone v_timezone)::date))
        filter(where c.component_category='refund'),0)::numeric refund_effect,
      coalesce(sum((c.amount_original-coalesce(c.tax_amount_original,0))*private.amazon_rate_to_eur(c.currency_code,(c.posted_date at time zone v_timezone)::date))
        filter(where c.component_category='adjustment'),0)::numeric adjustment_effect,
      count(*) filter(where c.amount_original<>0 and private.amazon_rate_to_eur(c.currency_code,(c.posted_date at time zone v_timezone)::date) is null)::bigint missing_fx
    from finance_rows c
    group by c.seller_sku,c.asin
  ),
  combined as (
    select coalesce(ig.seller_sku,fg.seller_sku) seller_sku,coalesce(ig.asin,fg.asin) asin,
      coalesce(ig.orders,0) orders,coalesce(ig.business_orders,0) business_orders,coalesce(ig.units,0) units,
      coalesce(ig.gross_sales,0) gross_sales,coalesce(ig.sales_vat,0) sales_vat,coalesce(ig.net_sales,0) net_sales,
      coalesce(ig.missing_vat_orders,0) missing_vat_orders,coalesce(ig.product_cost,0) product_cost,
      coalesce(ig.item_complete,true) item_complete,mm.first_product_id product_id,mm.product_name,coalesce(mm.first_consumption_factor,1) consumption_factor,
      coalesce(mm.product_mappings,'[]'::jsonb) product_mappings,
      coalesce(fg.fee_effect,0) fee_effect,coalesce(fg.fee_vat_effect,0) fee_vat_effect,
      coalesce(fg.refund_effect,0) refund_effect,coalesce(fg.adjustment_effect,0) adjustment_effect,coalesce(fg.missing_fx,0) missing_fx,
      (coalesce(ig.net_sales,0)+coalesce(fg.fee_effect,0)+coalesce(fg.refund_effect,0)+coalesce(fg.adjustment_effect,0)-coalesce(ig.product_cost,0))::numeric profit_before_ads,
      case when ig.net_sales<>0 then (coalesce(ig.net_sales,0)+coalesce(fg.fee_effect,0)+coalesce(fg.refund_effect,0)+coalesce(fg.adjustment_effect,0)-coalesce(ig.product_cost,0))/ig.net_sales*100 end::numeric margin_pct
    from item_group ig
    full join finance_group fg on fg.seller_sku=ig.seller_sku and coalesce(fg.asin,'')=coalesce(ig.asin,'')
    left join mapping_metadata mm on mm.seller_sku=coalesce(ig.seller_sku,fg.seller_sku)
    where ig.seller_sku is not null or coalesce(search,'')='' or fg.seller_sku ilike '%'||search||'%' or fg.asin ilike '%'||search||'%'
  ),
  ranked as (
    select c.*,count(*) over() total_rows,
      row_number() over(order by
        case when sort_dir='asc' and sort_by='product_name' then lower(coalesce(product_name,seller_sku)) end asc nulls last,
        case when sort_dir='desc' and sort_by='product_name' then lower(coalesce(product_name,seller_sku)) end desc nulls last,
        case when sort_dir='asc' and sort_by='orders' then orders end asc nulls last,
        case when sort_dir='desc' and sort_by='orders' then orders end desc nulls last,
        case when sort_dir='asc' and sort_by='units' then units end asc nulls last,
        case when sort_dir='desc' and sort_by='units' then units end desc nulls last,
        case when sort_dir='asc' and sort_by='gross_sales' then gross_sales end asc nulls last,
        case when sort_dir='desc' and sort_by='gross_sales' then gross_sales end desc nulls last,
        case when sort_dir='asc' and sort_by='net_sales' then net_sales end asc nulls last,
        case when sort_dir='desc' and sort_by='net_sales' then net_sales end desc nulls last,
        case when sort_dir='asc' and sort_by='product_cost' then product_cost end asc nulls last,
        case when sort_dir='desc' and sort_by='product_cost' then product_cost end desc nulls last,
        case when sort_dir='asc' and sort_by='amazon_fees' then -fee_effect end asc nulls last,
        case when sort_dir='desc' and sort_by='amazon_fees' then -fee_effect end desc nulls last,
        case when sort_dir='asc' and sort_by='refunds' then -refund_effect end asc nulls last,
        case when sort_dir='desc' and sort_by='refunds' then -refund_effect end desc nulls last,
        case when sort_dir='asc' and sort_by='profit_before_ads' then profit_before_ads end asc nulls last,
        case when sort_dir='desc' and sort_by='profit_before_ads' then profit_before_ads end desc nulls last,
        case when sort_dir='asc' and sort_by='margin_pct' then margin_pct end asc nulls last,
        case when sort_dir='desc' and sort_by='margin_pct' then margin_pct end desc nulls last,
        seller_sku asc,coalesce(asin,'') asc
      ) ord
    from combined c
  ),
  paged as (
    select * from ranked
    where ord>((page-1)*page_size) and ord<=(page*page_size)
  ),
  sync_bad as (
    select exists(select 1 from public.amazon_sync_jobs j
    where j.owner_id=v_owner
      and j.source in ('orders','finances')
      and coalesce(j.window_to,'infinity'::timestamptz) >= (from_date::timestamp at time zone v_timezone)
      and coalesce(j.window_from,'-infinity'::timestamptz) < ((to_date+1)::timestamp at time zone v_timezone)
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or j.marketplace_id=any(marketplace_ids))
      and j.status in ('queued','running','failed')) value
  )
  select jsonb_build_object(
    'items',coalesce(jsonb_agg(jsonb_build_object(
      'sellerSku',seller_sku,'asin',asin,'productId',product_id,'productName',product_name,'consumptionFactor',coalesce(consumption_factor,1),
      'productMappings',product_mappings,
      'orders',orders,'businessOrders',business_orders,'units',units,
      'grossSales',round(gross_sales,2),'salesVat',round(sales_vat,2),'netSales',round(net_sales,2),
      'amazonFees',round(-fee_effect,2),'amazonFeeVat',round(-fee_vat_effect,2),'refunds',round(-refund_effect,2),
      'amazonAdjustments',round(adjustment_effect,2),'productCost',round(product_cost,2),
      'profitBeforeAds',round(profit_before_ads,2),'marginPct',case when margin_pct is null then null else round(margin_pct,2) end,
      'missingVatOrders',missing_vat_orders,
      'profitComplete',(item_complete and missing_vat_orders=0 and missing_fx=0 and not sb.value)
    ) order by ord),'[]'::jsonb),
    'page',page,'pageSize',page_size,'total',coalesce(max(total_rows),0)
  ) into v_result
  from paged cross join sync_bad sb;

  return coalesce(v_result,jsonb_build_object('items','[]'::jsonb,'page',page,'pageSize',page_size,'total',0));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.amazon_analytics_series(from_date date, to_date date, marketplace_ids text[] DEFAULT NULL::text[], grain text DEFAULT 'day'::text)
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
  v_result jsonb;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then raise exception 'Forbidden'; end if;
  if grain not in ('day','month') then raise exception 'Invalid analytics grain'; end if;

  v_base:=public.amazon_analytics_series_without_fbm_20260917(from_date,to_date,marketplace_ids,grain);

  with tax_audit_by_order as (
    select c.owner_id,c.amazon_account_id,c.marketplace_id,c.amazon_order_id,sum(c.amount_original) tax_amount
    from private.amazon_finance_components_analytics c
    where c.owner_id=v_owner and c.component_category='tax_audit' and c.amazon_order_id is not null
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
    where i.owner_id=v_owner
    group by i.owner_id,i.amazon_account_id,i.marketplace_id,i.amazon_order_id
  ),
  eligible_orders as (
    select o.owner_id,o.amazon_account_id,o.marketplace_id,o.amazon_order_id,o.purchase_date,
      o.order_total,
      coalesce(o.order_total,it.item_total) effective_order_total,
      private.amazon_effective_vat_amount(
        v_owner,
        coalesce(o.order_total,it.item_total),
        coalesce(o.vat_amount,ta.tax_amount,it.item_tax_total),
        coalesce(o.is_business_order,false)
      ) effective_vat_amount,
      private.amazon_rate_to_eur(o.currency_code,(o.purchase_date at time zone v_timezone)::date) order_fx,
      o.fulfillment_channel,
      case when grain='month' then date_trunc('month',o.purchase_date at time zone v_timezone)::date else (o.purchase_date at time zone v_timezone)::date end bucket_start
    from public.amazon_orders o
    left join tax_audit_by_order ta
      on ta.owner_id=o.owner_id
     and ta.amazon_account_id=o.amazon_account_id
     and ta.marketplace_id=o.marketplace_id
     and ta.amazon_order_id=o.amazon_order_id
    left join item_totals it
      on it.owner_id=o.owner_id
     and it.amazon_account_id=o.amazon_account_id
     and it.marketplace_id=o.marketplace_id
     and it.amazon_order_id=o.amazon_order_id
    where o.owner_id=v_owner
      and o.purchase_date >= (from_date::timestamp at time zone v_timezone)
      and o.purchase_date < ((to_date+1)::timestamp at time zone v_timezone)
      and lower(coalesce(o.order_status,'')) not in ('canceled','cancelled')
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or o.marketplace_id=any(marketplace_ids))
  ),
  sales as (
    select bucket_start,
      coalesce(sum(case when effective_order_total is not null and order_fx is not null then effective_order_total*order_fx else 0 end),0)::numeric gross_sales,
      coalesce(sum(case when effective_vat_amount is not null and order_fx is not null then effective_vat_amount*order_fx else 0 end),0)::numeric sales_vat,
      coalesce(sum(case when effective_order_total is not null and order_fx is not null then (effective_order_total-coalesce(effective_vat_amount,0))*order_fx else 0 end),0)::numeric net_sales,
      count(*) filter(where effective_order_total is not null and effective_vat_amount is null)::bigint missing_vat_orders,
      count(*) filter(where order_total is null and effective_order_total is not null and order_fx is null)::bigint fallback_missing_fx
    from eligible_orders
    group by bucket_start
  ),
  shipping as (
    select eo.bucket_start,
      coalesce(sum(case when fo.shipping_cost_net_amount is not null and fx.shipping_fx is not null then fo.shipping_cost_net_amount*fx.shipping_fx else 0 end),0)::numeric shipping_cost,
      count(*) filter(where fo.shipping_cost_net_amount is null or fx.shipping_fx is null)::bigint missing_cost
    from eligible_orders eo
    left join lateral (
      select f.shipping_cost_net_amount,f.shipping_cost_currency,f.shipping_cost_recorded_at
      from public.fulfillment_orders f
      where f.owner_id=eo.owner_id
        and f.source_channel='amazon'
        and (f.order_number=eo.amazon_order_id or f.order_id=eo.amazon_order_id)
      order by f.shipping_cost_recorded_at desc nulls last,f.last_synced_at desc nulls last
      limit 1
    ) fo on true
    left join lateral (
      select private.amazon_rate_to_eur(
        coalesce(nullif(fo.shipping_cost_currency,''),'EUR'),
        coalesce((fo.shipping_cost_recorded_at at time zone v_timezone)::date,(eo.purchase_date at time zone v_timezone)::date)
      ) shipping_fx
    ) fx on true
    where eo.fulfillment_channel='MERCHANT'
    group by eo.bucket_start
  ),
  elements as (
    select e.value item,e.ordinality ord,(e.value->>'period')::date bucket_start
    from jsonb_array_elements(coalesce(v_base,'[]'::jsonb)) with ordinality e(value,ordinality)
  )
  select coalesce(jsonb_agg(
    e.item || jsonb_build_object(
      'grossSales',round(coalesce(s.gross_sales,0),2),
      'salesVat',round(coalesce(s.sales_vat,0),2),
      'netSales',round(coalesce(s.net_sales,0),2),
      'fbmShippingCost',round(coalesce(sh.shipping_cost,0),2),
      'netProfit',round(
        coalesce((e.item->>'netProfit')::numeric,0)
        +(coalesce(s.net_sales,0)-coalesce((e.item->>'netSales')::numeric,0))
        -coalesce(sh.shipping_cost,0),2
      ),
      'profitComplete',
        coalesce((e.item->>'profitComplete')::boolean,false)
        and coalesce(s.missing_vat_orders,0)=0
        and coalesce(s.fallback_missing_fx,0)=0
        and coalesce(sh.missing_cost,0)=0
    ) order by e.ord
  ),'[]'::jsonb)
  into v_result
  from elements e
  left join sales s on s.bucket_start=e.bucket_start
  left join shipping sh on sh.bucket_start=e.bucket_start;

  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.amazon_analytics_series_without_fbm_20260917(from_date date, to_date date, marketplace_ids text[] DEFAULT NULL::text[], grain text DEFAULT 'day'::text)
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
  if grain not in ('day','month') then raise exception 'Invalid analytics grain'; end if;

  with buckets as (
    select bucket_start::date
    from generate_series(
      case when grain='month' then date_trunc('month',from_date::timestamp)::date else from_date end,
      to_date,
      case when grain='month' then interval '1 month' else interval '1 day' end
    ) bucket_start
  ),
  tax_audit_by_order as (
    select c.owner_id,c.amazon_account_id,c.marketplace_id,c.amazon_order_id,sum(c.amount_original) as tax_amount
    from private.amazon_finance_components_analytics c
    where c.owner_id=v_owner and c.component_category='tax_audit' and c.amazon_order_id is not null
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
    select o.owner_id,o.amazon_account_id,o.marketplace_id,o.amazon_order_id,o.purchase_date,o.order_total,o.is_business_order,
      coalesce(o.vat_amount,ta.tax_amount,case when coalesce(o.is_business_order,false) then 0::numeric end) as effective_vat_amount,
      private.amazon_rate_to_eur(o.currency_code,(o.purchase_date at time zone v_timezone)::date) as order_fx,
      case when grain='month' then date_trunc('month',o.purchase_date at time zone v_timezone)::date else (o.purchase_date at time zone v_timezone)::date end as bucket_start
    from public.amazon_orders o
    left join tax_audit_by_order ta
      on ta.owner_id=o.owner_id and ta.amazon_account_id=o.amazon_account_id and ta.marketplace_id=o.marketplace_id and ta.amazon_order_id=o.amazon_order_id
    where o.owner_id=v_owner
      and o.purchase_date >= (from_date::timestamp at time zone v_timezone)
      and o.purchase_date < ((to_date+1)::timestamp at time zone v_timezone)
      and lower(coalesce(o.order_status,'')) not in ('canceled','cancelled')
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or o.marketplace_id=any(marketplace_ids))
  ),
  order_metrics as (
    select bucket_start,count(distinct amazon_order_id)::bigint as orders,
      coalesce(sum(case when order_total is not null and order_fx is not null then order_total*order_fx else 0 end),0)::numeric as gross_sales,
      coalesce(sum(case when effective_vat_amount is not null and order_fx is not null then effective_vat_amount*order_fx else 0 end),0)::numeric as sales_vat,
      coalesce(sum(case when order_total is not null and order_fx is not null then (order_total-coalesce(effective_vat_amount,0))*order_fx else 0 end),0)::numeric as net_sales,
      count(*) filter(where order_total is not null and effective_vat_amount is null)::bigint as missing_vat_orders,
      count(*) filter(where order_total is not null and order_fx is null)::bigint as missing_order_fx
    from eligible_orders group by bucket_start
  ),
  item_rows as (
    select eo.bucket_start,i.seller_sku,i.quantity_ordered,
      coalesce(mc.mapping_count,0) mapping_count,
      coalesce(mc.unit_cost_eur,0) mapped_unit_cost_eur,
      coalesce(mc.missing_historical_count,0) missing_historical_count,
      coalesce(mc.missing_fx_count,0) missing_cost_fx_count
    from public.amazon_order_items i
    join eligible_orders eo
      on eo.owner_id=i.owner_id and eo.amazon_account_id=i.amazon_account_id and eo.marketplace_id=i.marketplace_id and eo.amazon_order_id=i.amazon_order_id
    left join lateral private.amazon_mapping_cost_snapshot(
      i.owner_id,i.amazon_account_id,i.seller_sku,(eo.purchase_date at time zone v_timezone)::date
    ) mc on true
  ),
  item_metrics as (
    select bucket_start,
      coalesce(sum(quantity_ordered),0)::bigint as units,
      coalesce(sum(case when mapping_count>0 then quantity_ordered*mapped_unit_cost_eur else 0 end),0)::numeric as product_cost,
      count(distinct seller_sku) filter(where seller_sku is not null and mapping_count=0)::bigint as unmapped_skus,
      count(distinct seller_sku) filter(where mapping_count>0 and missing_historical_count>0)::bigint as missing_historical_cost,
      coalesce(sum(missing_cost_fx_count),0)::bigint as missing_cost_fx
    from item_rows group by bucket_start
  ),
  finance_rows as materialized (
    select eo.bucket_start,c.component_category,c.amount_original,c.tax_amount_original,
      private.amazon_rate_to_eur(c.currency_code,(c.posted_date at time zone v_timezone)::date) as finance_fx
    from private.amazon_finance_components_analytics c
    join eligible_orders eo
      on eo.owner_id=c.owner_id and eo.amazon_account_id=c.amazon_account_id and eo.amazon_order_id=c.amazon_order_id
     and (c.marketplace_id is null or c.marketplace_id=eo.marketplace_id)
    where c.owner_id=v_owner
      and nullif(c.amazon_order_id,'') is not null
      and c.component_category<>'refund'
      and c.component_category not in ('sale_audit','tax_audit')
    union all
    select case when grain='month' then date_trunc('month',c.posted_date at time zone v_timezone)::date else (c.posted_date at time zone v_timezone)::date end as bucket_start,
      c.component_category,c.amount_original,c.tax_amount_original,
      private.amazon_rate_to_eur(c.currency_code,(c.posted_date at time zone v_timezone)::date) as finance_fx
    from private.amazon_finance_components_analytics c
    where c.owner_id=v_owner
      and (nullif(c.amazon_order_id,'') is null or c.component_category='refund')
      and c.posted_date >= (from_date::timestamp at time zone v_timezone) and c.posted_date < ((to_date+1)::timestamp at time zone v_timezone)
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or c.marketplace_id=any(marketplace_ids))
      and c.component_category not in ('sale_audit','tax_audit')
  ),
  finance_metrics as (
    select bucket_start,
      coalesce(sum((amount_original-coalesce(tax_amount_original,0))*finance_fx) filter(where component_category in ('commission_fee','fba_fee','digital_services_fee','storage_fee','other_amazon_fee') and finance_fx is not null),0)::numeric as amazon_fee_effect,
      coalesce(sum((amount_original-coalesce(tax_amount_original,0))*finance_fx) filter(where component_category='refund' and finance_fx is not null),0)::numeric as refund_effect,
      coalesce(sum((amount_original-coalesce(tax_amount_original,0))*finance_fx) filter(where component_category='ads_payment_excluded' and finance_fx is not null),0)::numeric as ads_effect,
      coalesce(sum((amount_original-coalesce(tax_amount_original,0))*finance_fx) filter(where component_category='adjustment' and finance_fx is not null),0)::numeric as adjustment_effect,
      count(*) filter(where amount_original<>0 and finance_fx is null)::bigint as missing_finance_fx
    from finance_rows group by bucket_start
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
    select b.bucket_start,coalesce(om.orders,0)::bigint as orders,coalesce(im.units,0)::bigint as units,
      coalesce(om.gross_sales,0)::numeric as gross_sales,coalesce(om.sales_vat,0)::numeric as sales_vat,coalesce(om.net_sales,0)::numeric as net_sales,
      coalesce(fm.amazon_fee_effect,0)::numeric as amazon_fee_effect,coalesce(fm.refund_effect,0)::numeric as refund_effect,
      coalesce(fm.ads_effect,0)::numeric as ads_effect,coalesce(fm.adjustment_effect,0)::numeric as adjustment_effect,
      coalesce(im.product_cost,0)::numeric as product_cost,
      coalesce(im.unmapped_skus,0)::bigint as unmapped_skus,coalesce(im.missing_historical_cost,0)::bigint as missing_historical_cost,
      (coalesce(om.missing_order_fx,0)+coalesce(fm.missing_finance_fx,0)+coalesce(im.missing_cost_fx,0))::bigint as missing_fx_events,
      coalesce(om.missing_vat_orders,0)::bigint as missing_vat_orders,sm.sync_queued,sm.sync_running,sm.sync_failed
    from buckets b
    left join order_metrics om on om.bucket_start=b.bucket_start
    left join item_metrics im on im.bucket_start=b.bucket_start
    left join finance_metrics fm on fm.bucket_start=b.bucket_start
    cross join sync_metrics sm
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'period',c.bucket_start::text,'grossSales',round(c.gross_sales,2),'salesVat',round(c.sales_vat,2),'netSales',round(c.net_sales,2),
    'amazonFees',round(-c.amazon_fee_effect,2),'refunds',round(-c.refund_effect,2),'adsCost',round(-c.ads_effect,2),'productCost',round(c.product_cost,2),'fbmShippingCost',0,
    'netProfit',round(c.net_sales+c.amazon_fee_effect+c.refund_effect+c.ads_effect+c.adjustment_effect-c.product_cost,2),
    'orders',c.orders,'units',c.units,
    'profitComplete',(c.unmapped_skus=0 and c.missing_historical_cost=0 and c.missing_fx_events=0 and c.missing_vat_orders=0 and c.sync_queued=0 and c.sync_running=0 and c.sync_failed=0)
  ) order by c.bucket_start),'[]'::jsonb) into v_result from combined c;

  return v_result;
end;
$function$
;

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
      private.amazon_effective_vat_amount(
        v_owner,
        coalesce(n.order_total,it.item_total),
        coalesce(n.vat_amount,ta.tax_amount,it.item_tax_total),
        coalesce(n.is_business_order,false)
      ) corrected_vat,
      private.amazon_rate_to_eur(n.currency_code,(n.purchase_date at time zone v_timezone)::date) order_fx
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
      private.amazon_rate_to_eur(
        coalesce(nullif(fo.shipping_cost_currency,''),'EUR'),
        coalesce((fo.shipping_cost_recorded_at at time zone v_timezone)::date,(mo.purchase_date at time zone v_timezone)::date)
      ) shipping_fx
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
           private.amazon_rate_to_eur(o.currency_code,(o.purchase_date at time zone v_timezone)::date) as order_fx
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
  item_rows as (
    select i.amazon_order_id,i.marketplace_id,i.seller_sku,i.asin,i.quantity_ordered,
      (eo.purchase_date at time zone v_timezone)::date as purchase_date,
      coalesce(mc.mapping_count,0) mapping_count,
      coalesce(mc.unit_cost_eur,0) mapped_unit_cost_eur,
      coalesce(mc.missing_historical_count,0) missing_historical_count,
      coalesce(mc.missing_fx_count,0) missing_cost_fx_count
    from public.amazon_order_items i
    join eligible_orders eo
      on eo.owner_id=i.owner_id
     and eo.amazon_account_id=i.amazon_account_id
     and eo.marketplace_id=i.marketplace_id
     and eo.amazon_order_id=i.amazon_order_id
    left join lateral private.amazon_mapping_cost_snapshot(
      i.owner_id,i.amazon_account_id,i.seller_sku,(eo.purchase_date at time zone v_timezone)::date
    ) mc on true
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
    select c.component_category,c.amount_original,c.tax_amount_original,
           private.amazon_rate_to_eur(c.currency_code,(c.posted_date at time zone v_timezone)::date) as finance_fx
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
    select c.component_category,c.amount_original,c.tax_amount_original,
           private.amazon_rate_to_eur(c.currency_code,(c.posted_date at time zone v_timezone)::date) as finance_fx
    from private.amazon_finance_components_analytics c
    where c.owner_id=v_owner
      and (nullif(c.amazon_order_id,'') is null or c.component_category='refund')
      and c.posted_date >= (from_date::timestamp at time zone v_timezone)
      and c.posted_date < ((to_date+1)::timestamp at time zone v_timezone)
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or c.marketplace_id=any(marketplace_ids))
      and c.component_category not in ('sale_audit','tax_audit')
  ),
  finance_metrics as (
    select
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
      sm.sync_queued,sm.sync_running,sm.sync_failed
    from order_metrics om cross join item_metrics im cross join finance_metrics fm cross join sync_metrics sm
  )
  select jsonb_build_object(
    'grossSales',round(gross_sales,2),'salesVat',round(sales_vat,2),'netSales',round(net_sales,2),
    'orders',orders,'businessOrders',business_orders,'units',units,'amazonFees',round(amazon_fees,2),'amazonFeeVat',round(amazon_fee_vat,2),
    'refunds',round(refunds,2),'adsCost',round(ads_cost,2),'amazonAdjustments',round(amazon_adjustments,2),
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
$function$
;

