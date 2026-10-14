CREATE OR REPLACE FUNCTION public.amazon_analytics_products(from_date date, to_date date, marketplace_ids text[] DEFAULT NULL::text[], search text DEFAULT NULL::text, page integer DEFAULT 1, page_size integer DEFAULT 50, sort_by text DEFAULT 'profit_before_ads'::text, sort_dir text DEFAULT 'desc'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_timezone text:=private.amazon_analytics_timezone(); v_owner uuid; v_result jsonb; v_default_vat numeric;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then raise exception 'Forbidden'; end if;
  if from_date is null or to_date is null or to_date<from_date then raise exception 'Invalid analytics date range'; end if;
  if page<1 or page_size<1 or page_size>100 then raise exception 'Invalid pagination'; end if;
  if sort_by not in ('product_name','orders','units','gross_sales','net_sales','product_cost','amazon_fees','refunds','profit_before_ads','margin_pct') then raise exception 'Invalid sort'; end if;
  if sort_dir not in ('asc','desc') then raise exception 'Invalid sort direction'; end if;

  begin v_default_vat:=private.amazon_setting_text(v_owner,'defaultVatRate','21')::numeric; exception when others then v_default_vat:=21; end;
  v_default_vat:=greatest(0,least(100,v_default_vat));

  with eligible_orders as (
    select o.*,case when upper(coalesce(nullif(trim(o.currency_code),''),'EUR'))='EUR' then 1::numeric else private.amazon_rate_to_eur(o.currency_code,(o.purchase_date at time zone v_timezone)::date) end order_fx
    from public.amazon_orders o
    where o.owner_id=v_owner
      and o.purchase_date >= (from_date::timestamp at time zone v_timezone) and o.purchase_date < ((to_date+1)::timestamp at time zone v_timezone)
      and lower(coalesce(o.order_status,'')) not in ('canceled','cancelled')
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or o.marketplace_id=any(marketplace_ids))
  ),
  item_identity as materialized (
    select i.*,eo.order_fx,(eo.purchase_date at time zone v_timezone)::date purchase_date,coalesce(eo.is_business_order,false) is_business_order
    from public.amazon_order_items i join eligible_orders eo
      on eo.owner_id=i.owner_id and eo.amazon_account_id=i.amazon_account_id and eo.marketplace_id=i.marketplace_id and eo.amazon_order_id=i.amazon_order_id
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
  item_facts as (
    select i.*,mc.mapping_count,mc.mapped_unit_cost_eur,mc.missing_historical_count,mc.missing_cost_fx_count,
      case when i.item_tax is not null then i.item_tax
        when i.is_business_order then 0::numeric
        when i.item_price is null then null::numeric
        when v_default_vat=0 then 0::numeric
        else i.item_price-i.item_price/(1+v_default_vat/100) end effective_item_tax
    from item_identity i join cost_snapshots mc
      on mc.owner_id=i.owner_id and mc.amazon_account_id=i.amazon_account_id and mc.seller_sku is not distinct from i.seller_sku and mc.purchase_date=i.purchase_date
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
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or c.marketplace_id=any(marketplace_ids)
        or (c.component_category='refund' and c.marketplace_id is null and exists (
          select 1 from public.amazon_orders refund_order where refund_order.owner_id=c.owner_id
            and refund_order.amazon_account_id=c.amazon_account_id and refund_order.amazon_order_id=c.amazon_order_id
            and refund_order.marketplace_id=any(marketplace_ids))))
      and c.component_category not in ('sale_audit','tax_audit','ads_payment_excluded')
  ),
  finance_group as (
    select c.seller_sku,c.asin,
      coalesce(sum((c.amount_original-coalesce(c.tax_amount_original,0))*case when c.posted_date is null then null::numeric when upper(coalesce(nullif(trim(c.currency_code),''),'EUR'))='EUR' then 1::numeric else private.amazon_rate_to_eur(c.currency_code,(c.posted_date at time zone v_timezone)::date) end)
        filter(where c.component_category in ('commission_fee','fba_fee','digital_services_fee','storage_fee','other_amazon_fee')),0)::numeric fee_effect,
      coalesce(sum(coalesce(c.tax_amount_original,0)*case when c.posted_date is null then null::numeric when upper(coalesce(nullif(trim(c.currency_code),''),'EUR'))='EUR' then 1::numeric else private.amazon_rate_to_eur(c.currency_code,(c.posted_date at time zone v_timezone)::date) end)
        filter(where c.component_category in ('commission_fee','fba_fee','digital_services_fee','storage_fee','other_amazon_fee')),0)::numeric fee_vat_effect,
      coalesce(sum((c.amount_original-coalesce(c.tax_amount_original,0))*case when c.posted_date is null then null::numeric when upper(coalesce(nullif(trim(c.currency_code),''),'EUR'))='EUR' then 1::numeric else private.amazon_rate_to_eur(c.currency_code,(c.posted_date at time zone v_timezone)::date) end)
        filter(where c.component_category='refund'),0)::numeric refund_effect,
      coalesce(sum((c.amount_original-coalesce(c.tax_amount_original,0))*case when c.posted_date is null then null::numeric when upper(coalesce(nullif(trim(c.currency_code),''),'EUR'))='EUR' then 1::numeric else private.amazon_rate_to_eur(c.currency_code,(c.posted_date at time zone v_timezone)::date) end)
        filter(where c.component_category='adjustment'),0)::numeric adjustment_effect,
      count(*) filter(where c.amount_original<>0 and case when c.posted_date is null then null::numeric when upper(coalesce(nullif(trim(c.currency_code),''),'EUR'))='EUR' then 1::numeric else private.amazon_rate_to_eur(c.currency_code,(c.posted_date at time zone v_timezone)::date) end is null)::bigint missing_fx
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

