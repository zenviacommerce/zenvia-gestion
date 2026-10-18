-- Pre-MFA restoration, do not apply until production incident reviewed.

-- Exact source: production snapshot 20261018; deploy previous Edge bundles before dropping MFA-specific SQL.

BEGIN;

UPDATE private.mfa_configuration SET enabled=false WHERE singleton=true;

DO $restore_policies$ DECLARE pol record; BEGIN FOR pol IN SELECT schemaname,tablename,policyname FROM pg_policies WHERE schemaname='public' AND policyname IN ('mfa_select_gate','mfa_insert_gate','mfa_update_gate','mfa_delete_gate') LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',pol.policyname,pol.schemaname,pol.tablename); END LOOP; END $restore_policies$;

DROP TRIGGER IF EXISTS mfa_admin_promotion ON public.app_users;

DROP TRIGGER IF EXISTS mfa_platform_promotion ON public.platform_admins;

CREATE OR REPLACE FUNCTION public.amazon_add_product_mapping(seller_sku text, product_id uuid, consumption_factor numeric DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid;
  v_product uuid;
  v_account uuid;
  v_mapping uuid;
  v_seller_sku text;
  v_sku_assigned boolean:=false;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then raise exception 'Forbidden'; end if;

  v_seller_sku:=trim(seller_sku);
  if coalesce(v_seller_sku,'')='' then raise exception 'seller_sku is required'; end if;
  if consumption_factor is null or consumption_factor<=0 then raise exception 'consumption_factor must be greater than zero'; end if;

  select p.id into v_product
  from public.products p
  where p.id=product_id and p.owner_id=v_owner;
  if v_product is null then raise exception 'Product not found in workspace'; end if;

  select a.id into v_account
  from public.amazon_accounts a
  where a.owner_id=v_owner and a.status='connected'
  order by a.created_at limit 1;
  if v_account is null then raise exception 'Amazon account not connected'; end if;

  insert into public.amazon_product_mappings(
    owner_id,amazon_account_id,seller_sku,product_id,consumption_factor,mapping_source,created_at,updated_at
  )
  values(v_owner,v_account,v_seller_sku,v_product,consumption_factor,'manual',now(),now())
  on conflict on constraint amazon_product_mappings_owner_account_sku_product_key
  do update set consumption_factor=excluded.consumption_factor,mapping_source='manual',updated_at=now()
  returning id into v_mapping;

  begin
    update public.products p
    set sku=v_seller_sku,updated_at=now()
    where p.id=v_product and p.owner_id=v_owner
      and nullif(trim(coalesce(p.sku,'')),'') is null;
    v_sku_assigned:=found;
  exception when unique_violation then
    v_sku_assigned:=false;
  end;

  return jsonb_build_object(
    'ok',true,'id',v_mapping,'sellerSku',v_seller_sku,'productId',v_product,
    'consumptionFactor',consumption_factor,'skuAssigned',v_sku_assigned
  );
end;
$function$
;

ALTER FUNCTION amazon_add_product_mapping(text,uuid,numeric) OWNER TO "postgres";

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

ALTER FUNCTION amazon_analytics_detail(date,date,text[]) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.amazon_analytics_inventory(marketplace_ids text[] DEFAULT NULL::text[], search text DEFAULT NULL::text, page integer DEFAULT 1, page_size integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid; v_result jsonb;
begin
  v_owner:=private.app_workspace_owner_id(); if v_owner is null or not private.app_has_permission('amazon') then raise exception 'Forbidden'; end if; if page<1 or page_size<1 or page_size>100 then raise exception 'Invalid pagination'; end if;
  with rows as (
    select i.*,count(*) over() total_rows from public.amazon_inventory_current i
    where i.owner_id=v_owner and (marketplace_ids is null or cardinality(marketplace_ids)=0 or i.marketplace_id=any(marketplace_ids))
      and (coalesce(search,'')='' or i.seller_sku ilike '%'||search||'%' or i.asin ilike '%'||search||'%')
    order by i.total_quantity desc,i.seller_sku offset (page-1)*page_size limit page_size
  )
  select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('sellerSku',seller_sku,'asin',asin,'marketplaceId',marketplace_id,'fulfillable',fulfillable_quantity,'reserved',reserved_quantity,'inbound',inbound_working_quantity+inbound_shipped_quantity+inbound_receiving_quantity,'unfulfillable',unfulfillable_quantity,'researching',researching_quantity,'total',total_quantity,'lastSync',synced_at) order by total_quantity desc),'[]'::jsonb),'page',page,'pageSize',page_size,'total',coalesce(max(total_rows),0)) into v_result from rows;
  return coalesce(v_result,jsonb_build_object('items','[]'::jsonb,'page',page,'pageSize',page_size,'total',0));
end;$function$
;

ALTER FUNCTION amazon_analytics_inventory(text[],text,integer,integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.amazon_analytics_marketplaces(from_date date, to_date date, marketplace_ids text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '25s'
AS $function$
declare v_owner uuid; v_result jsonb;
begin
  v_owner:=private.app_workspace_owner_id(); if v_owner is null or not private.app_has_permission('amazon') then raise exception 'Forbidden'; end if;
  if from_date is null or to_date is null or to_date<from_date then raise exception 'Invalid analytics date range'; end if;
  with markets as (
    select m.marketplace_id,m.country_code,m.name,public.amazon_analytics_summary(from_date,to_date,array[m.marketplace_id]) summary
    from public.amazon_marketplaces m where m.owner_id=v_owner and m.active and (marketplace_ids is null or cardinality(marketplace_ids)=0 or m.marketplace_id=any(marketplace_ids))
  )
  select coalesce(jsonb_build_object('items',jsonb_agg(jsonb_build_object('marketplaceId',marketplace_id,'countryCode',country_code,'name',name,'orders',summary->'orders','units',summary->'units','netSales',summary->'netSales','amazonFees',summary->'amazonFees','refunds',summary->'refunds','productCost',summary->'productCost','profitBeforeAds',summary->'profitBeforeAds','marginPct',summary->'marginPct','profitComplete',summary->'profitComplete') order by country_code)),jsonb_build_object('items','[]'::jsonb)) into v_result from markets; return v_result;
end;$function$
;

ALTER FUNCTION amazon_analytics_marketplaces(date,date,text[]) OWNER TO "postgres";

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

ALTER FUNCTION amazon_analytics_orders(date,date,text[],text,integer,integer) OWNER TO "postgres";

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

ALTER FUNCTION amazon_analytics_products(date,date,text[],text,integer,integer,text,text) OWNER TO "postgres";

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
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or c.marketplace_id=any(marketplace_ids)
        or (c.component_category='refund' and c.marketplace_id is null and exists (
          select 1 from public.amazon_orders refund_order where refund_order.owner_id=c.owner_id
            and refund_order.amazon_account_id=c.amazon_account_id and refund_order.amazon_order_id=c.amazon_order_id
            and refund_order.marketplace_id=any(marketplace_ids))))
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

ALTER FUNCTION amazon_analytics_series_without_fbm_20260917(date,date,text[],text) OWNER TO "postgres";

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

ALTER FUNCTION amazon_analytics_series(date,date,text[],text) OWNER TO "postgres";

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
$function$
;

ALTER FUNCTION amazon_analytics_summary_without_fbm_20260917(date,date,text[]) OWNER TO "postgres";

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

ALTER FUNCTION amazon_analytics_summary(date,date,text[]) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.amazon_analytics_unmapped_skus(search text DEFAULT NULL::text, page integer DEFAULT 1, page_size integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid; v_result jsonb;
begin
  v_owner:=private.app_workspace_owner_id(); if v_owner is null or not private.app_has_permission('amazon') then raise exception 'Forbidden'; end if; if page<1 or page_size<1 or page_size>100 then raise exception 'Invalid pagination'; end if;
  with grouped as (
    select i.seller_sku,max(i.asin) asin,array_agg(distinct i.marketplace_id order by i.marketplace_id) marketplace_ids,count(distinct i.amazon_order_id)::bigint orders,sum(i.quantity_ordered)::bigint units,
      coalesce(sum(case when o.purchase_date::date>=current_date-29 and i.item_price is not null then i.item_price*private.amazon_rate_to_eur(i.currency_code,o.purchase_date::date) else 0 end),0)::numeric recent_net_sales
    from public.amazon_order_items i join public.amazon_orders o on o.owner_id=i.owner_id and o.amazon_account_id=i.amazon_account_id and o.marketplace_id=i.marketplace_id and o.amazon_order_id=i.amazon_order_id
    left join public.amazon_product_mappings m on m.owner_id=i.owner_id and m.amazon_account_id=i.amazon_account_id and m.seller_sku=i.seller_sku
    where i.owner_id=v_owner and m.id is null and nullif(trim(i.seller_sku),'') is not null and lower(coalesce(o.order_status,'')) not in ('canceled','cancelled')
      and (coalesce(search,'')='' or i.seller_sku ilike '%'||search||'%' or i.asin ilike '%'||search||'%') group by i.seller_sku
  ), rows as (select *,count(*) over() total_rows from grouped order by units desc,seller_sku offset (page-1)*page_size limit page_size)
  select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('sellerSku',seller_sku,'asin',asin,'marketplaceIds',marketplace_ids,'orders',orders,'units',units,'recentNetSales',round(recent_net_sales,2)) order by units desc),'[]'::jsonb),'page',page,'pageSize',page_size,'total',coalesce(max(total_rows),0)) into v_result from rows;
  return coalesce(v_result,jsonb_build_object('items','[]'::jsonb,'page',page,'pageSize',page_size,'total',0));
end;$function$
;

ALTER FUNCTION amazon_analytics_unmapped_skus(text,integer,integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.amazon_claim_sync_jobs(limit_count integer, p_holder_id uuid)
 RETURNS SETOF amazon_sync_jobs
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '3s'
 SET lock_timeout TO '500ms'
AS $function$
 SELECT * FROM private.amazon_claim_sync_jobs(limit_count,p_holder_id);
$function$
;

ALTER FUNCTION amazon_claim_sync_jobs(integer,uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.amazon_claim_sync_jobs(limit_count integer DEFAULT 3)
 RETURNS SETOF amazon_sync_jobs
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '3s'
 SET lock_timeout TO '500ms'
AS $function$
 SELECT * FROM private.amazon_claim_sync_jobs(limit_count);
$function$
;

ALTER FUNCTION amazon_claim_sync_jobs(integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.amazon_close_recovered_order_failures()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.amazon_sync_jobs f
  set status='superseded',
      updated_at=now(),
      last_error=concat('Recuperado mediante reproceso diario. Error original: ',coalesce(f.last_error,''))
  where f.owner_id=new.owner_id and f.amazon_account_id=new.amazon_account_id
    and f.marketplace_id=new.marketplace_id
    and f.source='orders' and f.status='failed'
    and f.window_from < new.window_to and f.window_to > new.window_from
    and not exists (
      select 1 from generate_series(date_trunc('day',f.window_from),date_trunc('day',f.window_to-interval '1 microsecond'),interval '1 day') d
      where not exists (
        select 1 from public.amazon_sync_jobs r
        where r.owner_id=f.owner_id and r.amazon_account_id=f.amazon_account_id
          and r.marketplace_id=f.marketplace_id and r.status='success'
          and r.job_key='recovery:v2:orders:'||f.marketplace_id||':'||to_char(d,'YYYY-MM-DD')
      )
    );
  return new;
end $function$
;

ALTER FUNCTION amazon_close_recovered_order_failures() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.amazon_delete_product_mapping_item(seller_sku text, product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid;
  v_account uuid;
  v_seller_sku text;
  v_product_id uuid;
  v_count integer;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then
    raise exception 'Forbidden';
  end if;

  v_seller_sku:=trim(seller_sku);
  v_product_id:=product_id;
  if coalesce(v_seller_sku,'')='' then raise exception 'seller_sku is required'; end if;

  select a.id into v_account
  from public.amazon_accounts a
  where a.owner_id=v_owner and a.status='connected'
  order by a.created_at
  limit 1;
  if v_account is null then raise exception 'Amazon account not connected'; end if;

  delete from public.amazon_product_mappings m
  where m.owner_id=v_owner
    and m.amazon_account_id=v_account
    and m.seller_sku=v_seller_sku
    and m.product_id=v_product_id;

  get diagnostics v_count=row_count;
  return jsonb_build_object('ok',true,'deleted',v_count);
end;
$function$
;

ALTER FUNCTION amazon_delete_product_mapping_item(text,uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.amazon_delete_product_mapping(seller_sku text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid;
  v_count integer;
  v_seller_sku text;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then
    raise exception 'Forbidden';
  end if;

  v_seller_sku:=trim(seller_sku);
  if coalesce(v_seller_sku,'')='' then
    raise exception 'seller_sku is required';
  end if;

  delete from public.amazon_product_mappings m
  using public.amazon_accounts a
  where m.amazon_account_id=a.id
    and m.owner_id=v_owner
    and a.owner_id=v_owner
    and a.status='connected'
    and m.seller_sku=v_seller_sku;

  get diagnostics v_count=row_count;
  return jsonb_build_object('ok',true,'deleted',v_count);
end;
$function$
;

ALTER FUNCTION amazon_delete_product_mapping(text) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.amazon_get_product_mappings(seller_sku text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid;
  v_account uuid;
  v_seller_sku text;
  v_result jsonb;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then
    raise exception 'Forbidden';
  end if;

  v_seller_sku:=trim(seller_sku);
  if coalesce(v_seller_sku,'')='' then raise exception 'seller_sku is required'; end if;

  select a.id into v_account
  from public.amazon_accounts a
  where a.owner_id=v_owner and a.status='connected'
  order by a.created_at
  limit 1;

  if v_account is null then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,
    'productId',p.id,
    'productName',p.name,
    'productSku',p.sku,
    'supplierName',s.name,
    'consumptionFactor',m.consumption_factor
  ) order by p.name,p.id),'[]'::jsonb)
  into v_result
  from public.amazon_product_mappings m
  join public.products p
    on p.id=m.product_id and p.owner_id=m.owner_id
  left join public.suppliers s
    on s.id=p.last_supplier_id and s.owner_id=p.owner_id
  where m.owner_id=v_owner
    and m.amazon_account_id=v_account
    and m.seller_sku=v_seller_sku;

  return coalesce(v_result,'[]'::jsonb);
end;
$function$
;

ALTER FUNCTION amazon_get_product_mappings(text) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.amazon_pii_claim_external_read(p_order_id uuid, p_owner_id uuid, p_lease uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '3s'
 SET lock_timeout TO '500ms'
AS $function$
declare item public.fulfillment_orders%rowtype;
begin
 if p_order_id is null or p_owner_id is null or p_lease is null then raise exception 'Invalid read lease parameters' using errcode='22023';end if;
 select * into item from public.fulfillment_orders where id=p_order_id and owner_id=p_owner_id for update;
 if not found then return 'not_found';end if;
 if item.source_channel<>'amazon' then return 'not_found';end if;
 if item.pii_purged_at is not null then return 'purged';end if;
 if item.order_action_lease_until>clock_timestamp() or item.shopify_tracking_lease_until>clock_timestamp() then return 'busy';end if;
 update public.fulfillment_orders set order_action_lease=p_lease,order_action_lease_until=clock_timestamp()+interval '480 seconds' where id=p_order_id and owner_id=p_owner_id;
 return 'claimed';
end $function$
;

ALTER FUNCTION amazon_pii_claim_external_read(uuid,uuid,uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.amazon_pii_run_batch(p_owner uuid, p_run uuid, p_mode text DEFAULT 'pilot'::text, p_limit integer DEFAULT 10, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '3s'
 SET lock_timeout TO '500ms'
AS $function$
declare v_at timestamptz:=statement_timestamp();v_started timestamptz:=clock_timestamp();v_refs text[];v_ref text;v_rows int;v_cancellations int:=0;v_orders int;v_result jsonb;v_existing private.amazon_pii_batch_runs%rowtype;v_gate private.amazon_pii_execution_gates%rowtype;v_missing int;v_active int;v_young int;v_invalid int;
begin
 if p_owner is null or p_run is null or p_mode is null or p_mode not in ('pilot','batch') or p_limit is null or p_limit<1 or p_limit>50 or (p_mode='pilot' and p_limit<>10) or p_dry_run is null then raise exception 'Invalid purge mode or limit' using errcode='22023';end if;
 if not p_dry_run then
   if not pg_try_advisory_xact_lock(hashtextextended('amazon-pii-owner:'||p_owner::text,0)) then raise exception 'Purge owner lease busy' using errcode='55P03';end if;
   select * into v_existing from private.amazon_pii_batch_runs where owner_id=p_owner and run_id=p_run;
   if found then
     if v_existing.mode<>p_mode or v_existing.batch_limit<>p_limit then raise exception 'Run identity parameters changed' using errcode='22023';end if;
     return v_existing.result;
   end if;
   select * into v_gate from private.amazon_pii_execution_gates where owner_id=p_owner for update;
   if v_gate.reconciliation_verified_at is null or v_gate.cycle_verified_at is null or v_gate.deployment_reviewed_at is null or v_gate.copies_reviewed_at is null then raise exception 'Execution gates are not verified' using errcode='55000';end if;
   if p_mode='pilot' and v_gate.pilot_run_id is not null then raise exception 'Pilot already executed; verify before remaining batches' using errcode='55000';end if;
   if p_mode='batch' and (v_gate.pilot_run_id is null or v_gate.pilot_verified_at is null) then raise exception 'Pilot verification is required' using errcode='55000';end if;
   if exists(select 1 from public.amazon_sync_jobs where owner_id=p_owner and (payload is distinct from private.amazon_pii_job_controls(payload) or (last_error is distinct from private.amazon_pii_error_code(last_error))))
   or exists(select 1 from public.amazon_sync_runs where owner_id=p_owner and (checkpoint is distinct from private.amazon_pii_checkpoint(checkpoint) or (error_message is distinct from private.amazon_pii_error_code(error_message))))
   or exists(select 1 from public.amazon_sync_state where owner_id=p_owner and checkpoint is distinct from private.amazon_pii_checkpoint(checkpoint)) then raise exception 'Historical control copies must be scrubbed first' using errcode='55000';end if;
 end if;
 select array_agg(amazon_ref order by purchase_at,amazon_ref),sum(row_count)::int into v_refs,v_rows from private.amazon_pii_candidates(p_owner,v_at,p_limit);
 v_orders:=coalesce(cardinality(v_refs),0);v_rows:=coalesce(v_rows,0);
 select count(*) into v_cancellations from public.order_cancellation_operations c where c.owner_id=p_owner and c.order_id in(select f.id from public.fulfillment_orders f where f.owner_id=p_owner and f.source_channel='amazon' and private.amazon_pii_order_ref(f.order_number,f.order_id)=any(v_refs));
 if v_rows+v_cancellations>500 then raise exception 'Duplicate row budget exceeded' using errcode='54000';end if;
 if not p_dry_run and p_mode='pilot' and v_orders<>10 then raise exception 'Pilot requires exactly ten eligible canonical orders' using errcode='55000';end if;
 if not p_dry_run then
   foreach v_ref in array coalesce(v_refs,array[]::text[]) loop
     if not pg_try_advisory_xact_lock(hashtextextended('amazon-pii-order:'||p_owner::text||':'||v_ref,0)) then raise exception 'Order writer lease busy' using errcode='55P03';end if;
   end loop;
   -- Lock one representative with SKIP LOCKED; then lock every duplicate NOWAIT.
   -- A locked/mutated duplicate aborts the whole short transaction, never a
   -- partial canonical purge or a pilot silently smaller than ten.
   if (select count(*) from(select f.id from public.fulfillment_orders f where f.owner_id=p_owner and f.source_channel='amazon' and private.amazon_pii_order_ref(f.order_number,f.order_id)=any(v_refs) order by f.id for update skip locked) locked)<>v_rows then raise exception 'Candidate rows busy or changed; retry dry-run' using errcode='55P03';end if;
   if exists(select 1 from public.fulfillment_orders f where f.owner_id=p_owner and f.source_channel='amazon' and private.amazon_pii_order_ref(f.order_number,f.order_id)=any(v_refs) and (f.order_created_at is null or private.amazon_pii_deadline(f.order_created_at,null)>v_at or f.order_action_lease_until>clock_timestamp() or f.shopify_tracking_lease_until>clock_timestamp() or exists(select 1 from public.order_cancellation_operations c where c.owner_id=p_owner and c.order_id=f.id and c.status in ('submitting','pending','unknown')))) then raise exception 'Candidate eligibility changed' using errcode='55000';end if;
   update public.fulfillment_orders f set pii_purged_at=v_at where f.owner_id=p_owner and f.source_channel='amazon' and private.amazon_pii_order_ref(f.order_number,f.order_id)=any(v_refs);
   get diagnostics v_rows=row_count;
   -- Selected closed cancellation copies contain historical tracking/capability
   -- identifiers and provider errors. Keep operation identity/status, not PII.
   update public.order_cancellation_operations c set details='{}'::jsonb,message=null,remote_id=null,reference='amazon-purged:'||c.id::text
   where c.owner_id=p_owner and c.order_id in(select f.id from public.fulfillment_orders f where f.owner_id=p_owner and f.source_channel='amazon' and private.amazon_pii_order_ref(f.order_number,f.order_id)=any(v_refs));
   get diagnostics v_cancellations=row_count;
 end if;
 select count(*) filter(where ref is null),count(*) filter(where missing),count(*) filter(where leased),count(*) filter(where not missing and private.amazon_pii_deadline(purchased,null)>v_at)
 into v_invalid,v_missing,v_active,v_young from (
   select private.amazon_pii_order_ref(order_number,order_id) ref,bool_or(order_created_at is null) missing,max(order_created_at) purchased,
   bool_or(coalesce(order_action_lease_until>v_at,false) or coalesce(shopify_tracking_lease_until>v_at,false)) leased
   from public.fulfillment_orders where owner_id=p_owner and source_channel='amazon' and pii_purged_at is null group by private.amazon_pii_order_ref(order_number,order_id)
 ) s;
 v_result:=jsonb_build_object('run_id',p_run,'policy_version','amazon-pii-v2-purchase60','evaluated_at',v_at,'dry_run',p_dry_run,'mode',p_mode,'selected_orders',v_orders,'fulfillment_rows',v_rows,'skipped_missing_purchase',v_missing,'skipped_action_lease',v_active,'skipped_within_period',v_young,'invalid_identity_groups',v_invalid,'tables',jsonb_build_object('fulfillment_orders',v_rows,'amazon_orders',0,'amazon_order_items',0,'order_cancellation_operations',v_cancellations),'cohort_fingerprint',md5(coalesce(array_to_string(v_refs,','),'')),'errors',0,'duration_ms',floor(extract(epoch from clock_timestamp()-v_started)*1000));
 if not p_dry_run then
   insert into private.amazon_pii_batch_runs values(p_owner,p_run,p_mode,p_limit,'amazon-pii-v2-purchase60',v_at,v_result);
   if p_mode='pilot' then update private.amazon_pii_execution_gates set pilot_run_id=p_run where owner_id=p_owner;end if;
 end if;
 return v_result;
end $function$
;

ALTER FUNCTION amazon_pii_run_batch(uuid,uuid,text,integer,boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.amazon_pii_scrub_control_copies(p_owner uuid, p_limit integer DEFAULT 50, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '3s'
 SET lock_timeout TO '500ms'
AS $function$
declare v_jobs uuid[];v_runs uuid[];v_states uuid[];
begin
 if p_owner is null or p_limit is null or p_limit<1 or p_limit>50 or p_dry_run is null then raise exception 'Invalid control scrub parameters' using errcode='22023';end if;
 if not p_dry_run and not exists(select 1 from private.amazon_pii_execution_gates where owner_id=p_owner and reconciliation_verified_at is not null and cycle_verified_at is not null and deployment_reviewed_at is not null and copies_reviewed_at is not null) then raise exception 'Execution gates are not verified' using errcode='55000';end if;
 if not p_dry_run and not pg_try_advisory_xact_lock(hashtextextended('amazon-pii-owner:'||p_owner::text,0)) then raise exception 'Purge owner lease busy' using errcode='55P03';end if;
 select array_agg(id order by id) into v_jobs from(select id from public.amazon_sync_jobs where owner_id=p_owner and (payload is distinct from private.amazon_pii_job_controls(payload) or (last_error is distinct from private.amazon_pii_error_code(last_error))) order by id limit p_limit) s;
 select array_agg(id order by id) into v_runs from(select id from public.amazon_sync_runs where owner_id=p_owner and (checkpoint is distinct from private.amazon_pii_checkpoint(checkpoint) or (error_message is distinct from private.amazon_pii_error_code(error_message))) order by id limit p_limit) s;
 select array_agg(id order by id) into v_states from(select id from public.amazon_sync_state where owner_id=p_owner and checkpoint is distinct from private.amazon_pii_checkpoint(checkpoint) order by id limit p_limit) s;
 if not p_dry_run then
   perform 1 from public.amazon_sync_jobs where owner_id=p_owner and id=any(v_jobs) for update nowait;
   perform 1 from public.amazon_sync_runs where owner_id=p_owner and id=any(v_runs) for update nowait;
   perform 1 from public.amazon_sync_state where owner_id=p_owner and id=any(v_states) for update nowait;
   update public.amazon_sync_jobs set payload=private.amazon_pii_job_controls(payload),last_error=private.amazon_pii_error_code(last_error) where owner_id=p_owner and id=any(v_jobs);
   update public.amazon_sync_runs set checkpoint=private.amazon_pii_checkpoint(checkpoint),error_message=private.amazon_pii_error_code(error_message) where owner_id=p_owner and id=any(v_runs);
   update public.amazon_sync_state set checkpoint=private.amazon_pii_checkpoint(checkpoint) where owner_id=p_owner and id=any(v_states);
 end if;
 return jsonb_build_object('dry_run',p_dry_run,'jobs',coalesce(cardinality(v_jobs),0),'runs',coalesce(cardinality(v_runs),0),'states',coalesce(cardinality(v_states),0));
end $function$
;

ALTER FUNCTION amazon_pii_scrub_control_copies(uuid,integer,boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.amazon_set_product_mapping(seller_sku text, product_id uuid, consumption_factor numeric DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid;
  v_product uuid;
  v_account uuid;
  v_mapping uuid;
  v_seller_sku text;
  v_sku_assigned boolean:=false;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then raise exception 'Forbidden'; end if;

  v_seller_sku:=trim(seller_sku);
  if coalesce(v_seller_sku,'')='' then raise exception 'seller_sku is required'; end if;
  if consumption_factor is null or consumption_factor<=0 then raise exception 'consumption_factor must be greater than zero'; end if;

  select p.id into v_product
  from public.products p
  where p.id=product_id and p.owner_id=v_owner;
  if v_product is null then raise exception 'Product not found in workspace'; end if;

  select a.id into v_account
  from public.amazon_accounts a
  where a.owner_id=v_owner and a.status='connected'
  order by a.created_at limit 1;
  if v_account is null then raise exception 'Amazon account not connected'; end if;

  -- Legacy clients expect "set" to replace the previous relation.
  delete from public.amazon_product_mappings m
  where m.owner_id=v_owner
    and m.amazon_account_id=v_account
    and m.seller_sku=v_seller_sku
    and m.product_id<>v_product;

  insert into public.amazon_product_mappings(
    owner_id,amazon_account_id,seller_sku,product_id,consumption_factor,mapping_source,created_at,updated_at
  )
  values(v_owner,v_account,v_seller_sku,v_product,consumption_factor,'manual',now(),now())
  on conflict on constraint amazon_product_mappings_owner_account_sku_product_key
  do update set consumption_factor=excluded.consumption_factor,mapping_source='manual',updated_at=now()
  returning id into v_mapping;

  begin
    update public.products p
    set sku=v_seller_sku,updated_at=now()
    where p.id=v_product and p.owner_id=v_owner
      and nullif(trim(coalesce(p.sku,'')),'') is null;
    v_sku_assigned:=found;
  exception when unique_violation then
    v_sku_assigned:=false;
  end;

  return jsonb_build_object(
    'ok',true,'id',v_mapping,'sellerSku',v_seller_sku,'productId',v_product,
    'consumptionFactor',consumption_factor,'skuAssigned',v_sku_assigned
  );
end;
$function$
;

ALTER FUNCTION amazon_set_product_mapping(text,uuid,numeric) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.amazon_worker_acquire_lease(p_holder_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_ok boolean;
BEGIN
 IF p_holder_id IS NULL THEN RAISE EXCEPTION 'holder required'; END IF;
 INSERT INTO public.amazon_worker_leases AS l(lease_key,holder_id,acquired_at,heartbeat_at,expires_at)
 VALUES ('amazon-sync-worker',p_holder_id,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '480 seconds')
 ON CONFLICT (lease_key) DO UPDATE
 SET holder_id=excluded.holder_id,acquired_at=excluded.acquired_at,heartbeat_at=excluded.heartbeat_at,expires_at=excluded.expires_at
 WHERE l.expires_at<=clock_timestamp()
 RETURNING true INTO v_ok;
 RETURN coalesce(v_ok,false);
END $function$
;

ALTER FUNCTION amazon_worker_acquire_lease(uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.amazon_worker_release_lease(p_holder_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_ok boolean;
BEGIN
 DELETE FROM public.amazon_worker_leases WHERE lease_key='amazon-sync-worker' AND holder_id=p_holder_id RETURNING true INTO v_ok;
 RETURN coalesce(v_ok,false);
END $function$
;

ALTER FUNCTION amazon_worker_release_lease(uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.amazon_worker_renew_lease(p_holder_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_ok boolean;
BEGIN
 UPDATE public.amazon_worker_leases SET heartbeat_at=clock_timestamp(),expires_at=clock_timestamp()+interval '480 seconds'
 WHERE lease_key='amazon-sync-worker' AND holder_id=p_holder_id AND expires_at>clock_timestamp()
 RETURNING true INTO v_ok;
 RETURN coalesce(v_ok,false);
END $function$
;

ALTER FUNCTION amazon_worker_renew_lease(uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.configuration_apply_invoice_reprocess(p_invoice_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid := private.app_workspace_owner_id();
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_invoice public.invoices%rowtype;
  v_category uuid;
  v_supplier uuid;
  v_issue_date date;
  v_supplier_tax text;
begin
  if not coalesce(private.app_is_admin(),false) then
    raise exception 'Solo un administrador puede reprocesar facturas.';
  end if;
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb))<>'object' then
    raise exception 'Payload de reprocesado no válido.';
  end if;

  select * into v_invoice
  from public.invoices
  where id=p_invoice_id and owner_id=v_owner
  for update;
  if not found then raise exception 'Factura no encontrada en este workspace.'; end if;
  if v_invoice.file_path is null then raise exception 'La factura no conserva archivo para reprocesar.'; end if;

  begin
    v_issue_date:=nullif(p_payload->>'invoiceDate','')::date;
  exception when invalid_text_representation or datetime_field_overflow then
    raise exception 'Fecha de factura no válida en el reprocesado.';
  end;

  if nullif(p_payload->>'categoryId','') is not null then
    begin
      v_category:=(p_payload->>'categoryId')::uuid;
    exception when invalid_text_representation then
      raise exception 'Categoría no válida en el reprocesado.';
    end;
    if not exists(
      select 1 from public.expense_categories
      where id=v_category and owner_id=v_owner and active=true
    ) then
      raise exception 'La categoría reprocesada no pertenece al workspace.';
    end if;
  else
    v_category:=v_invoice.expense_category_id;
  end if;

  v_supplier_tax:=regexp_replace(upper(coalesce(p_payload->>'supplierTaxId','')),'[^A-Z0-9]','','g');
  if length(v_supplier_tax)>0 then
    select id into v_supplier
    from public.suppliers
    where owner_id=v_owner
      and active=true
      and regexp_replace(upper(coalesce(tax_id,'')),'[^A-Z0-9]','','g')=v_supplier_tax
    order by id
    limit 1;
  end if;

  update public.invoices
  set
    supplier_id=coalesce(v_supplier,v_invoice.supplier_id),
    invoice_number=coalesce(nullif(trim(p_payload->>'invoiceNumber'),''),v_invoice.invoice_number),
    issue_date=coalesce(v_issue_date,v_invoice.issue_date),
    expense_category_id=coalesce(v_category,v_invoice.expense_category_id),
    net_amount=coalesce((p_payload->>'subtotal')::numeric,v_invoice.net_amount),
    tax_amount=coalesce((p_payload->>'vat')::numeric,v_invoice.tax_amount),
    equivalence_surcharge_amount=coalesce((p_payload->>'equivalenceSurcharge')::numeric,v_invoice.equivalence_surcharge_amount),
    withholding_amount=coalesce((p_payload->>'withholding')::numeric,v_invoice.withholding_amount),
    total_amount=coalesce((p_payload->>'total')::numeric,v_invoice.total_amount),
    ocr_text=coalesce(p_payload->>'text',v_invoice.ocr_text),
    extraction=coalesce(v_invoice.extraction,'{}'::jsonb)
      || jsonb_build_object(
        'maintenanceReprocess',
        jsonb_build_object(
          'at',now(),
          'supplierName',p_payload->>'supplierName',
          'supplierTaxId',nullif(p_payload->>'supplierTaxId',''),
          'recipientTaxId',nullif(p_payload->>'recipientTaxId',''),
          'recipientName',nullif(p_payload->>'recipientName',''),
          'usedOcr',coalesce((p_payload->>'usedOcr')::boolean,false),
          'lineCount',coalesce(jsonb_array_length(coalesce(p_payload->'lines','[]'::jsonb)),0)
        )
      ),
    extraction_confidence=coalesce((p_payload->>'confidence')::numeric,v_invoice.extraction_confidence),
    updated_at=now()
  where id=p_invoice_id and owner_id=v_owner;

  select email into v_actor_email from public.app_users where user_id=v_actor limit 1;
  insert into public.audit_logs(
    workspace_owner_id,actor_user_id,actor_email,module,action,
    entity_type,entity_id,entity_label,summary,details
  ) values (
    v_owner,v_actor,v_actor_email,'settings','reprocess','invoices',
    p_invoice_id::text,coalesce(p_payload->>'invoiceNumber',v_invoice.invoice_number),
    'Reprocesó una factura de gasto con el parser y política actuales',
    jsonb_build_object(
      'invoice_id',p_invoice_id,
      'supplier_relinked_by_exact_tax_id',v_supplier is not null,
      'lines_preserved',true,
      'historical_rows_deleted',0
    )
  );

  return jsonb_build_object(
    'ok',true,'invoiceId',p_invoice_id,
    'supplierRelinked',v_supplier is not null,
    'linesPreserved',true,'historicalRowsDeleted',0
  );
end;
$function$
;

ALTER FUNCTION configuration_apply_invoice_reprocess(uuid,jsonb) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.configuration_merge_client(p_source_id uuid, p_destination_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid := private.app_workspace_owner_id();
  v_source public.clients%rowtype;
  v_destination public.clients%rowtype;
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_invoice_count integer := 0;
  v_alias_count integer := 0;
begin
  if not coalesce(private.app_is_admin(),false) then
    raise exception 'Solo un administrador puede fusionar clientes.';
  end if;
  if p_source_id is null or p_destination_id is null or p_source_id=p_destination_id then
    raise exception 'El cliente origen y destino deben ser distintos.';
  end if;

  select * into v_source
  from public.clients
  where id=p_source_id and owner_id=v_owner
  for update;
  if not found then raise exception 'Cliente origen no encontrado en este workspace.'; end if;

  select * into v_destination
  from public.clients
  where id=p_destination_id and owner_id=v_owner
  for update;
  if not found then raise exception 'Cliente destino no encontrado en este workspace.'; end if;

  if nullif(regexp_replace(upper(coalesce(v_source.tax_id,'')),'[^A-Z0-9]','','g'),'') is not null
     and nullif(regexp_replace(upper(coalesce(v_destination.tax_id,'')),'[^A-Z0-9]','','g'),'') is not null
     and regexp_replace(upper(v_source.tax_id),'[^A-Z0-9]','','g')
       <> regexp_replace(upper(v_destination.tax_id),'[^A-Z0-9]','','g') then
    raise exception 'Los clientes tienen identificaciones fiscales diferentes. Revisa la fusión manualmente.';
  end if;

  select count(*) into v_invoice_count from public.sales_invoices where owner_id=v_owner and client_id=p_source_id;
  select count(*) into v_alias_count from public.entity_alias_rules where owner_id=v_owner and entity_type='client' and target_entity_id=p_source_id;

  update public.clients
  set
    tax_id=coalesce(nullif(trim(v_destination.tax_id),''),v_source.tax_id),
    email=coalesce(nullif(trim(v_destination.email),''),v_source.email),
    phone=coalesce(nullif(trim(v_destination.phone),''),v_source.phone),
    address_line1=coalesce(nullif(trim(v_destination.address_line1),''),v_source.address_line1),
    address_line2=coalesce(nullif(trim(v_destination.address_line2),''),v_source.address_line2),
    postal_code=coalesce(nullif(trim(v_destination.postal_code),''),v_source.postal_code),
    city=coalesce(nullif(trim(v_destination.city),''),v_source.city),
    province=coalesce(nullif(trim(v_destination.province),''),v_source.province),
    notes=case
      when nullif(trim(coalesce(v_destination.notes,'')),'') is null then v_source.notes
      when nullif(trim(coalesce(v_source.notes,'')),'') is null then v_destination.notes
      when position(v_source.notes in v_destination.notes)>0 then v_destination.notes
      else v_destination.notes || E'\n' || v_source.notes
    end
  where id=p_destination_id and owner_id=v_owner;

  update public.sales_invoices
  set client_id=p_destination_id
  where owner_id=v_owner and client_id=p_source_id;

  update public.entity_alias_rules
  set target_entity_id=p_destination_id
  where owner_id=v_owner and entity_type='client' and target_entity_id=p_source_id;

  delete from public.clients where id=p_source_id and owner_id=v_owner;

  select email into v_actor_email from public.app_users where user_id=v_actor limit 1;
  insert into public.audit_logs(
    workspace_owner_id,actor_user_id,actor_email,module,action,
    entity_type,entity_id,entity_label,summary,details
  ) values (
    v_owner,v_actor,v_actor_email,'settings','merge','clients',
    p_destination_id::text,v_destination.name,
    'Fusionó cliente '||v_source.name||' en '||v_destination.name,
    jsonb_build_object(
      'source_id',p_source_id,'destination_id',p_destination_id,
      'source_name',v_source.name,'destination_name',v_destination.name,
      'affected',jsonb_build_object('sales_invoices',v_invoice_count,'aliases',v_alias_count)
    )
  );

  return jsonb_build_object(
    'ok',true,'sourceId',p_source_id,'destinationId',p_destination_id,
    'affected',jsonb_build_object('salesInvoices',v_invoice_count,'aliases',v_alias_count)
  );
end;
$function$
;

ALTER FUNCTION configuration_merge_client(uuid,uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.configuration_merge_supplier(p_source_id uuid, p_destination_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ declare v_owner uuid := private.app_workspace_owner_id(); v_source public.suppliers%rowtype; v_destination public.suppliers%rowtype; v_actor uuid := auth.uid(); v_actor_email text; v_invoice_count integer := 0; v_history_count integer := 0; v_product_count integer := 0; v_relation_count integer := 0; v_alias_count integer := 0; v_relation record; v_destination_relation uuid; begin if v_owner is null or auth.uid() is null or not coalesce(private.app_is_admin(),false) then raise exception 'Solo un administrador puede fusionar proveedores.'; end if; if p_source_id is null or p_destination_id is null or p_source_id=p_destination_id then raise exception 'El proveedor origen y destino deben ser distintos.'; end if; select * into v_source from public.suppliers where id=p_source_id and owner_id=v_owner for update; if not found then raise exception 'Proveedor origen no encontrado en este workspace.'; end if; select * into v_destination from public.suppliers where id=p_destination_id and owner_id=v_owner for update; if not found then raise exception 'Proveedor destino no encontrado en este workspace.'; end if; if nullif(regexp_replace(upper(coalesce(v_source.tax_id,'')),'[^A-Z0-9]','','g'),'') is not null and nullif(regexp_replace(upper(coalesce(v_destination.tax_id,'')),'[^A-Z0-9]','','g'),'') is not null and regexp_replace(upper(v_source.tax_id),'[^A-Z0-9]','','g') <> regexp_replace(upper(v_destination.tax_id),'[^A-Z0-9]','','g') then raise exception 'Los proveedores tienen identificaciones fiscales diferentes. Revisa la fusión manualmente.'; end if; perform 1 from public.supplier_products where owner_id=v_owner and supplier_id=p_source_id order by id for update; perform 1 from public.invoices where owner_id=v_owner and supplier_id=p_source_id order by id for update; if exists(select 1 from public.invoices where supplier_id=p_source_id and owner_id is distinct from v_owner) or exists(select 1 from public.products where last_supplier_id=p_source_id and owner_id is distinct from v_owner) or exists(select 1 from public.product_price_history where supplier_id=p_source_id and owner_id is distinct from v_owner) or exists(select 1 from public.supplier_products where supplier_id=p_source_id and owner_id is distinct from v_owner) or exists( select 1 from public.invoice_lines l join public.supplier_products sp on sp.id=l.supplier_product_id where sp.owner_id=v_owner and sp.supplier_id=p_source_id and l.owner_id is distinct from v_owner ) or exists( select 1 from public.invoice_lines l join public.invoices i on i.id=l.invoice_id where i.owner_id=v_owner and i.supplier_id=p_source_id and l.owner_id is distinct from v_owner ) or exists( select 1 from public.product_price_history h join public.invoices i on i.id=h.invoice_id where i.owner_id=v_owner and i.supplier_id=p_source_id and h.owner_id is distinct from v_owner ) then raise exception 'La fusión contiene referencias de otro workspace; revisa la integridad antes de continuar.' using errcode='42501'; end if; if exists( select 1 from public.invoices s join public.invoices d on d.owner_id=v_owner and d.supplier_id=p_destination_id and d.invoice_number=s.invoice_number where s.owner_id=v_owner and s.supplier_id=p_source_id and s.invoice_number is not null and length(trim(s.invoice_number))>0 ) then raise exception 'La fusión produciría facturas duplicadas con el mismo número. No se ha modificado ningún dato.'; end if; select count(*) into v_invoice_count from public.invoices where owner_id=v_owner and supplier_id=p_source_id; select count(*) into v_history_count from public.product_price_history where owner_id=v_owner and supplier_id=p_source_id; select count(*) into v_product_count from public.products where owner_id=v_owner and last_supplier_id=p_source_id; select count(*) into v_relation_count from public.supplier_products where owner_id=v_owner and supplier_id=p_source_id; select count(*) into v_alias_count from public.entity_alias_rules where owner_id=v_owner and entity_type='supplier' and target_entity_id=p_source_id; update public.suppliers set tax_id=coalesce(nullif(trim(v_destination.tax_id),''),v_source.tax_id), email=coalesce(nullif(trim(v_destination.email),''),v_source.email), phone=coalesce(nullif(trim(v_destination.phone),''),v_source.phone), address=coalesce(nullif(trim(v_destination.address),''),v_source.address), website=coalesce(nullif(trim(v_destination.website),''),v_source.website), default_category_id=coalesce(v_destination.default_category_id,v_source.default_category_id), notes=case when nullif(trim(coalesce(v_destination.notes,'')),'') is null then v_source.notes when nullif(trim(coalesce(v_source.notes,'')),'') is null then v_destination.notes when position(v_source.notes in v_destination.notes)>0 then v_destination.notes else v_destination.notes || E'\n' || v_source.notes end where id=p_destination_id and owner_id=v_owner; for v_relation in select id,supplier_description from public.supplier_products where owner_id=v_owner and supplier_id=p_source_id order by id loop select id into v_destination_relation from public.supplier_products where owner_id=v_owner and supplier_id=p_destination_id and supplier_description=v_relation.supplier_description limit 1; if v_destination_relation is not null then update public.invoice_lines set supplier_product_id=v_destination_relation where supplier_product_id=v_relation.id and owner_id=v_owner; delete from public.supplier_products where id=v_relation.id and owner_id=v_owner; end if; v_destination_relation := null; end loop; update public.supplier_products set supplier_id=p_destination_id where owner_id=v_owner and supplier_id=p_source_id; update public.invoices set supplier_id=p_destination_id where owner_id=v_owner and supplier_id=p_source_id; update public.product_price_history set supplier_id=p_destination_id where owner_id=v_owner and supplier_id=p_source_id; update public.products set last_supplier_id=p_destination_id where owner_id=v_owner and last_supplier_id=p_source_id; update public.entity_alias_rules set target_entity_id=p_destination_id where owner_id=v_owner and entity_type='supplier' and target_entity_id=p_source_id; delete from public.suppliers where id=p_source_id and owner_id=v_owner; select email into v_actor_email from public.app_users where user_id=v_actor limit 1; insert into public.audit_logs( workspace_owner_id,actor_user_id,actor_email,module,action, entity_type,entity_id,entity_label,summary,details ) values ( v_owner,v_actor,v_actor_email,'settings','merge','suppliers', p_destination_id::text,v_destination.name, 'Fusionó proveedor '||v_source.name||' en '||v_destination.name, jsonb_build_object( 'source_id',p_source_id,'destination_id',p_destination_id, 'source_name',v_source.name,'destination_name',v_destination.name, 'affected',jsonb_build_object( 'invoices',v_invoice_count,'price_history',v_history_count, 'products',v_product_count,'supplier_products',v_relation_count, 'aliases',v_alias_count ) ) ); return jsonb_build_object( 'ok',true,'sourceId',p_source_id,'destinationId',p_destination_id, 'affected',jsonb_build_object( 'invoices',v_invoice_count,'priceHistory',v_history_count, 'products',v_product_count,'supplierProducts',v_relation_count, 'aliases',v_alias_count ) ); end; $function$
;

ALTER FUNCTION configuration_merge_supplier(uuid,uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.configuration_rebuild_price_history_links(p_apply boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ declare v_owner uuid := private.app_workspace_owner_id(); v_actor uuid := auth.uid(); v_actor_email text; v_missing integer := 0; v_mismatched integer := 0; v_written integer := 0; begin if v_owner is null or auth.uid() is null or not coalesce(private.app_is_admin(),false) then raise exception 'Solo un administrador puede reconstruir el histórico de precios.'; end if; if p_apply and exists( select 1 from public.invoice_lines l join public.invoices i on i.id=l.invoice_id and i.owner_id=v_owner join public.products p on p.id=l.product_id and p.owner_id=v_owner join public.product_price_history h on h.invoice_line_id=l.id where l.owner_id=v_owner and l.normalized_unit_price is not null and h.owner_id is distinct from v_owner ) then raise exception 'El histórico contiene referencias de otro workspace; revisa la integridad antes de continuar.' using errcode='42501'; end if; with candidates as ( select l.id as invoice_line_id,l.product_id,i.supplier_id,i.id as invoice_id, coalesce(i.issue_date,i.received_date) as price_date, l.unit_price,l.normalized_unit_price, coalesce(p.base_unit,l.unit,'ud') as base_unit, coalesce(i.currency,'EUR') as currency from public.invoice_lines l join public.invoices i on i.id=l.invoice_id and i.owner_id=v_owner join public.products p on p.id=l.product_id and p.owner_id=v_owner where l.owner_id=v_owner and l.product_id is not null and l.normalized_unit_price is not null ) select count(*) filter (where h.id is null), count(*) filter ( where h.id is not null and ( h.product_id is distinct from c.product_id or h.supplier_id is distinct from c.supplier_id or h.invoice_id is distinct from c.invoice_id or h.price_date is distinct from c.price_date or h.normalized_unit_price is distinct from c.normalized_unit_price or h.base_unit is distinct from c.base_unit or h.currency is distinct from c.currency ) ) into v_missing,v_mismatched from candidates c left join public.product_price_history h on h.owner_id=v_owner and h.invoice_line_id=c.invoice_line_id; if not p_apply then return jsonb_build_object( 'ok',true,'preview',true, 'missing',v_missing,'mismatched',v_mismatched, 'historicalRowsDeleted',0 ); end if; with candidates as ( select l.id as invoice_line_id,l.product_id,i.supplier_id,i.id as invoice_id, coalesce(i.issue_date,i.received_date) as price_date, l.unit_price,l.normalized_unit_price, coalesce(p.base_unit,l.unit,'ud') as base_unit, coalesce(i.currency,'EUR') as currency from public.invoice_lines l join public.invoices i on i.id=l.invoice_id and i.owner_id=v_owner join public.products p on p.id=l.product_id and p.owner_id=v_owner where l.owner_id=v_owner and l.product_id is not null and l.normalized_unit_price is not null ), written as ( insert into public.product_price_history( owner_id,product_id,supplier_id,invoice_id,invoice_line_id,price_date, purchase_unit_price,normalized_unit_price,base_unit,currency ) select v_owner,product_id,supplier_id,invoice_id,invoice_line_id,price_date, unit_price,normalized_unit_price,base_unit,currency from candidates on conflict(invoice_line_id) do update set product_id=excluded.product_id, supplier_id=excluded.supplier_id, invoice_id=excluded.invoice_id, price_date=excluded.price_date, purchase_unit_price=excluded.purchase_unit_price, normalized_unit_price=excluded.normalized_unit_price, base_unit=excluded.base_unit, currency=excluded.currency where product_price_history.owner_id=excluded.owner_id returning id ) select count(*) into v_written from written; select email into v_actor_email from public.app_users where user_id=v_actor limit 1; insert into public.audit_logs( workspace_owner_id,actor_user_id,actor_email,module,action, entity_type,entity_id,entity_label,summary,details ) values ( v_owner,v_actor,v_actor_email,'settings','rebuild','product_price_history', null,null, 'Reconstruyó enlaces del histórico de precios desde líneas de factura', jsonb_build_object( 'rows_written',v_written,'missing_before',v_missing, 'mismatched_before',v_mismatched,'historical_rows_deleted',0 ) ); return jsonb_build_object( 'ok',true,'preview',false, 'rowsWritten',v_written,'missingBefore',v_missing,'mismatchedBefore',v_mismatched, 'historicalRowsDeleted',0 ); end; $function$
;

ALTER FUNCTION configuration_rebuild_price_history_links(boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.configuration_rebuild_supplier_product_links(p_apply boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid := private.app_workspace_owner_id();
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_missing_relations integer := 0;
  v_lines_to_link integer := 0;
  v_conflicts integer := 0;
  v_inserted integer := 0;
  v_linked integer := 0;
begin
  if not coalesce(private.app_is_admin(),false) then
    raise exception 'Solo un administrador puede reconstruir relaciones producto-proveedor.';
  end if;

  with source_rows as (
    select l.*,i.supplier_id
    from public.invoice_lines l
    join public.invoices i on i.id=l.invoice_id and i.owner_id=v_owner
    where l.owner_id=v_owner
      and l.product_id is not null
      and i.supplier_id is not null
      and length(trim(l.description))>0
  )
  select
    count(distinct (s.supplier_id::text||'|'||s.description)) filter (where sp.id is null),
    count(*) filter (where sp.id is not null and sp.product_id=s.product_id and s.supplier_product_id is distinct from sp.id),
    count(*) filter (where sp.id is not null and sp.product_id is distinct from s.product_id)
  into v_missing_relations,v_lines_to_link,v_conflicts
  from source_rows s
  left join public.supplier_products sp
    on sp.owner_id=v_owner
   and sp.supplier_id=s.supplier_id
   and sp.supplier_description=s.description;

  if not p_apply then
    return jsonb_build_object(
      'ok',true,'preview',true,
      'missingRelations',v_missing_relations,
      'linesToLink',v_lines_to_link,
      'conflicts',v_conflicts
    );
  end if;

  with candidates as (
    select distinct on (i.supplier_id,l.description)
      i.supplier_id,l.product_id,l.supplier_sku,l.description,l.unit,l.units_per_purchase,l.created_at
    from public.invoice_lines l
    join public.invoices i on i.id=l.invoice_id and i.owner_id=v_owner
    left join public.supplier_products sp
      on sp.owner_id=v_owner
     and sp.supplier_id=i.supplier_id
     and sp.supplier_description=l.description
    where l.owner_id=v_owner
      and l.product_id is not null
      and i.supplier_id is not null
      and length(trim(l.description))>0
      and sp.id is null
    order by i.supplier_id,l.description,l.created_at desc
  ),
  inserted as (
    insert into public.supplier_products(
      owner_id,supplier_id,product_id,supplier_sku,supplier_description,purchase_unit,units_per_purchase
    )
    select
      v_owner,supplier_id,product_id,nullif(trim(supplier_sku),''),
      description,nullif(trim(unit),''),coalesce(nullif(units_per_purchase,0),1)
    from candidates
    on conflict(owner_id,supplier_id,supplier_description) do nothing
    returning id
  )
  select count(*) into v_inserted from inserted;

  with matched as (
    select l.id,sp.id as supplier_product_id
    from public.invoice_lines l
    join public.invoices i on i.id=l.invoice_id and i.owner_id=v_owner
    join public.supplier_products sp
      on sp.owner_id=v_owner
     and sp.supplier_id=i.supplier_id
     and sp.supplier_description=l.description
     and sp.product_id=l.product_id
    where l.owner_id=v_owner
      and l.product_id is not null
      and l.supplier_product_id is distinct from sp.id
  ),
  updated as (
    update public.invoice_lines l
    set supplier_product_id=m.supplier_product_id,updated_at=now()
    from matched m
    where l.id=m.id
    returning l.id
  )
  select count(*) into v_linked from updated;

  select email into v_actor_email from public.app_users where user_id=v_actor limit 1;
  insert into public.audit_logs(
    workspace_owner_id,actor_user_id,actor_email,module,action,
    entity_type,entity_id,entity_label,summary,details
  ) values (
    v_owner,v_actor,v_actor_email,'settings','rebuild','supplier_products',
    null,null,
    'Reconstruyó relaciones producto-proveedor desde líneas de factura',
    jsonb_build_object(
      'inserted_relations',v_inserted,'linked_lines',v_linked,'conflicts_skipped',v_conflicts
    )
  );

  return jsonb_build_object(
    'ok',true,'preview',false,
    'insertedRelations',v_inserted,'linkedLines',v_linked,'conflicts',v_conflicts
  );
end;
$function$
;

ALTER FUNCTION configuration_rebuild_supplier_product_links(boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.configuration_recalculate_product_costs(p_apply boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid := private.app_workspace_owner_id();
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_method text := 'last_purchase';
  v_decimals integer := 4;
  v_eligible integer := 0;
  v_changed integer := 0;
begin
  if not coalesce(private.app_is_admin(),false) then
    raise exception 'Solo un administrador puede recalcular costes.';
  end if;

  select
    coalesce(nullif(config->'products'->>'costMethod',''),'last_purchase'),
    greatest(0,least(8,coalesce((config->'products'->>'costDecimals')::integer,4)))
  into v_method,v_decimals
  from public.app_settings
  where owner_id=v_owner;

  v_method:=coalesce(v_method,'last_purchase');
  v_decimals:=coalesce(v_decimals,4);

  if v_method='manual' then
    return jsonb_build_object(
      'ok',true,'preview',not p_apply,'method',v_method,
      'eligible',0,'changed',0,
      'message','El método de coste configurado es manual; no hay costes automáticos que recalcular.'
    );
  end if;

  with latest as (
    select distinct on (h.product_id)
      h.product_id,h.normalized_unit_price,h.supplier_id,h.price_date,h.base_unit
    from public.product_price_history h
    join public.products p on p.id=h.product_id and p.owner_id=v_owner and p.active=true
    where h.owner_id=v_owner
    order by h.product_id,h.price_date desc,h.created_at desc
  ),
  averages as (
    select h.product_id,avg(h.normalized_unit_price)::numeric as average_cost
    from public.product_price_history h
    join public.products p on p.id=h.product_id and p.owner_id=v_owner and p.active=true
    where h.owner_id=v_owner
    group by h.product_id
  ),
  desired as (
    select
      p.id,
      round((case when v_method='average' then a.average_cost else l.normalized_unit_price end)::numeric,v_decimals) as next_cost,
      l.supplier_id,
      l.price_date,
      coalesce(l.base_unit,p.base_unit) as cost_unit
    from public.products p
    join latest l on l.product_id=p.id
    left join averages a on a.product_id=p.id
    where p.owner_id=v_owner and p.active=true
  )
  select
    count(*),
    count(*) filter (where p.last_cost is distinct from d.next_cost)
  into v_eligible,v_changed
  from desired d
  join public.products p on p.id=d.id;

  if not p_apply then
    return jsonb_build_object(
      'ok',true,'preview',true,'method',v_method,
      'eligible',v_eligible,'changed',v_changed,
      'historicalRowsDeleted',0
    );
  end if;

  with latest as (
    select distinct on (h.product_id)
      h.product_id,h.normalized_unit_price,h.supplier_id,h.price_date,h.base_unit
    from public.product_price_history h
    join public.products p on p.id=h.product_id and p.owner_id=v_owner and p.active=true
    where h.owner_id=v_owner
    order by h.product_id,h.price_date desc,h.created_at desc
  ),
  averages as (
    select h.product_id,avg(h.normalized_unit_price)::numeric as average_cost
    from public.product_price_history h
    join public.products p on p.id=h.product_id and p.owner_id=v_owner and p.active=true
    where h.owner_id=v_owner
    group by h.product_id
  ),
  desired as (
    select
      p.id,
      round((case when v_method='average' then a.average_cost else l.normalized_unit_price end)::numeric,v_decimals) as next_cost,
      l.supplier_id,
      l.price_date,
      coalesce(l.base_unit,p.base_unit) as cost_unit
    from public.products p
    join latest l on l.product_id=p.id
    left join averages a on a.product_id=p.id
    where p.owner_id=v_owner and p.active=true
  )
  update public.products p
  set
    previous_cost=case when p.last_cost is distinct from d.next_cost then p.last_cost else p.previous_cost end,
    last_cost=d.next_cost,
    cost_unit=d.cost_unit,
    last_supplier_id=d.supplier_id,
    last_purchase_date=d.price_date,
    updated_at=now()
  from desired d
  where p.id=d.id
    and p.owner_id=v_owner
    and p.last_cost is distinct from d.next_cost;

  select email into v_actor_email from public.app_users where user_id=v_actor limit 1;
  insert into public.audit_logs(
    workspace_owner_id,actor_user_id,actor_email,module,action,
    entity_type,entity_id,entity_label,summary,details
  ) values (
    v_owner,v_actor,v_actor_email,'settings','recalculate','products',
    null,null,
    'Recalculó los costes actuales de productos',
    jsonb_build_object(
      'method',v_method,'eligible',v_eligible,'changed',v_changed,
      'historical_rows_deleted',0
    )
  );

  return jsonb_build_object(
    'ok',true,'preview',false,'method',v_method,
    'eligible',v_eligible,'changed',v_changed,
    'historicalRowsDeleted',0
  );
end;
$function$
;

ALTER FUNCTION configuration_recalculate_product_costs(boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.configuration_reset_app_settings(p_schema_version integer, p_config jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid := private.app_workspace_owner_id();
  v_changed text[] := array[]::text[];
  v_before jsonb := '{}'::jsonb;
begin
  if not coalesce(private.app_is_admin(),false) then
    raise exception 'Solo un administrador puede restaurar la configuración global.';
  end if;
  if jsonb_typeof(coalesce(p_config,'{}'::jsonb))<>'object' then
    raise exception 'Configuración predeterminada no válida.';
  end if;

  select coalesce(config,'{}'::jsonb)
    into v_before
  from public.app_settings
  where owner_id=v_owner;

  select coalesce(array_agg(key order by key),array[]::text[])
    into v_changed
  from (
    select key from jsonb_object_keys(coalesce(v_before,'{}'::jsonb)) key
    union
    select key from jsonb_object_keys(p_config) key
  ) keys
  where coalesce(v_before->key,'null'::jsonb)
        is distinct from coalesce(p_config->key,'null'::jsonb);

  insert into public.app_settings(owner_id,schema_version,config,updated_at)
  values(v_owner,p_schema_version,p_config,now())
  on conflict(owner_id) do update set
    schema_version=excluded.schema_version,
    config=excluded.config,
    updated_at=excluded.updated_at;

  return jsonb_build_object('ok',true,'changedSections',to_jsonb(v_changed));
end;
$function$
;

ALTER FUNCTION configuration_reset_app_settings(integer,jsonb) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.integration_preserve_cancellations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 if exists(select 1 from order_cancellation_operations where owner_id=new.owner_id and order_id=new.id and kind='order' and status='confirmed') then new.source_status='cancelled';end if;
 if exists(select 1 from order_cancellation_operations where owner_id=new.owner_id and order_id=new.id and kind='label' and status='confirmed' and (details->>'shipmentRef'=coalesce(new.shipping_remote_id,new.sendcloud_parcel_id::text,new.tracking_number,'') or (nullif(details->>'trackingNumber','') is not null and details->>'trackingNumber'=new.tracking_number))) then
  if old.label_created_at is not null and not exists(select 1 from order_cancellation_operations where owner_id=old.owner_id and order_id=old.id and kind='label' and status='confirmed' and (details->>'shipmentRef'=coalesce(old.shipping_remote_id,old.sendcloud_parcel_id::text,old.tracking_number,'') or details->>'trackingNumber'=old.tracking_number)) then
   new.shipping_remote_id=old.shipping_remote_id;new.sendcloud_parcel_id=old.sendcloud_parcel_id;new.sendcloud_shipment_id=old.sendcloud_shipment_id;new.shipping_label_url=old.shipping_label_url;new.label_created_at=old.label_created_at;new.label_printed_at=old.label_printed_at;new.label_print_count=old.label_print_count;
   new.tracking_number=old.tracking_number;new.tracking_url=old.tracking_url;new.tracking_status_code=old.tracking_status_code;new.tracking_status_message=old.tracking_status_message;new.tracking_updated_at=old.tracking_updated_at;new.fulfilled_at=old.fulfilled_at;
   return new;
  end if;
  new.label_cancelled_at=coalesce(new.label_cancelled_at,now());new.shipping_remote_id=null;new.sendcloud_parcel_id=null;new.sendcloud_shipment_id=null;new.shipping_label_url=null;new.label_created_at=null;new.label_printed_at=null;new.label_print_count=0;
  new.tracking_number=null;new.tracking_url=null;new.tracking_status_code=null;new.tracking_status_message=null;new.tracking_updated_at=null;new.fulfilled_at=null;
  new.shipping_cost_amount=null;new.shipping_cost_net_amount=null;new.shipping_cost_tax_amount=null;new.shipping_cost_recorded_at=null;
 end if;
 return new;
end $function$
;

ALTER FUNCTION integration_preserve_cancellations() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.platform_reset_demo_workspace(p_workspace_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_workspace public.workspaces%rowtype;
  v_now timestamptz:=now();
  v_demo_today timestamptz:=(((now() at time zone 'Europe/Madrid')::date + time '00:10') at time zone 'Europe/Madrid');
  v_year integer:=extract(year from current_date)::integer;
  v_merchandise_category uuid;
  v_transport_category uuid;
  v_software_category uuid;
  v_supplier_goods uuid:=gen_random_uuid();
  v_supplier_logistics uuid:=gen_random_uuid();
  v_supplier_software uuid:=gen_random_uuid();
  v_product_cups uuid:=gen_random_uuid();
  v_product_film uuid:=gen_random_uuid();
  v_product_bags uuid:=gen_random_uuid();
  v_product_tubs uuid:=gen_random_uuid();
  v_client_restaurant uuid:=gen_random_uuid();
  v_client_fruit uuid:=gen_random_uuid();
  v_client_catering uuid:=gen_random_uuid();
  v_purchase_1 uuid:=gen_random_uuid();
  v_purchase_2 uuid:=gen_random_uuid();
  v_purchase_3 uuid:=gen_random_uuid();
  v_sales_series uuid:=gen_random_uuid();
  v_sale_1 uuid:=gen_random_uuid();
  v_sale_2 uuid:=gen_random_uuid();
  v_amazon_account uuid:=gen_random_uuid();
  v_config jsonb;
begin
  select * into v_workspace
  from public.workspaces
  where id=p_workspace_id;

  if v_workspace.id is null then
    raise exception 'Workspace demo no encontrado.';
  end if;

  select config into v_config
  from public.app_settings
  where owner_id=p_workspace_id;

  if coalesce(v_config->'demo'->>'enabled','false')<>'true' then
    raise exception 'El workspace no está autorizado como cuenta demo.';
  end if;

  -- El reset demo es deliberadamente destructivo, pero siempre acotado al owner_id.
  delete from public.gmail_imports where owner_id=p_workspace_id;
  delete from public.fulfillment_orders where owner_id=p_workspace_id;
  delete from public.amazon_accounts where owner_id=p_workspace_id;

  delete from public.sales_payments where owner_id=p_workspace_id;
  -- Delete the parent first: issued-invoice line guards permit the ON DELETE CASCADE
  -- only after the parent row is no longer visible to the child trigger.
  delete from public.sales_invoices where owner_id=p_workspace_id;
  delete from public.sales_invoice_series where owner_id=p_workspace_id;
  delete from public.sales_receipt_payments where owner_id=p_workspace_id;
  delete from public.sales_receipt_lines where owner_id=p_workspace_id;
  delete from public.sales_receipts where owner_id=p_workspace_id;

  delete from public.product_price_history where owner_id=p_workspace_id;
  delete from public.invoice_lines where owner_id=p_workspace_id;
  delete from public.invoices where owner_id=p_workspace_id;
  delete from public.source_documents where owner_id=p_workspace_id;
  delete from public.supplier_products where owner_id=p_workspace_id;
  delete from public.products where owner_id=p_workspace_id;
  delete from public.suppliers where owner_id=p_workspace_id;
  delete from public.clients where owner_id=p_workspace_id;
  delete from public.integration_accounts where owner_id=p_workspace_id;

  insert into public.expense_categories(owner_id,name,icon,active,sort_order)
  values
    (p_workspace_id,'Mercancía','Package',true,10),
    (p_workspace_id,'Transporte','Truck',true,20),
    (p_workspace_id,'Software','Monitor',true,30)
  on conflict(owner_id,name) do update
    set active=true,updated_at=v_now;

  select id into v_merchandise_category from public.expense_categories where owner_id=p_workspace_id and name='Mercancía';
  select id into v_transport_category from public.expense_categories where owner_id=p_workspace_id and name='Transporte';
  select id into v_software_category from public.expense_categories where owner_id=p_workspace_id and name='Software';

  insert into public.business_settings(
    owner_id,legal_name,trade_name,tax_id,address_line1,postal_code,city,province,country_code,email,phone,website,invoice_footer,updated_at
  ) values (
    p_workspace_id,'Comercial Bahía Demo SL','Bahía Demo','B12345678','Avenida del Comercio 24','11011','Cádiz','Cádiz','ES',
    'administracion@example.com','600000000','https://example.com','Cuenta de demostración · Datos ficticios',v_now
  )
  on conflict(owner_id) do update set
    legal_name=excluded.legal_name,trade_name=excluded.trade_name,tax_id=excluded.tax_id,address_line1=excluded.address_line1,
    postal_code=excluded.postal_code,city=excluded.city,province=excluded.province,country_code=excluded.country_code,
    email=excluded.email,phone=excluded.phone,website=excluded.website,invoice_footer=excluded.invoice_footer,updated_at=v_now;

  insert into public.suppliers(id,owner_id,name,tax_id,email,phone,supplier_type,default_category_id,notes,active,address,website)
  values
    (v_supplier_goods,p_workspace_id,'Envases Iberia Demo SL','B11000001','ventas.envases@example.com','956000101','goods',v_merchandise_category,'Proveedor ficticio para demostraciones.',true,'Polígono Industrial Bahía, Cádiz','https://example.com'),
    (v_supplier_logistics,p_workspace_id,'Logística Atlántico Demo SL','B11000002','facturacion.logistica@example.com','956000102','service',v_transport_category,'Proveedor ficticio para demostraciones.',true,'Zona Franca, Cádiz','https://example.com'),
    (v_supplier_software,p_workspace_id,'Cloud Metrics Demo Ltd','EU000000003','billing.cloud@example.com',null,'service',v_software_category,'Proveedor ficticio en USD.',true,'Dublin, Ireland','https://example.com');

  insert into public.products(id,owner_id,name,sku,category,base_unit,active,last_cost,previous_cost,cost_unit,last_supplier_id,last_purchase_date,sale_price,sales_tax_rate,invoice_description,ean)
  values
    (v_product_cups,p_workspace_id,'Vaso kraft 240 ml','DEMO-VASO-240','Vasos','ud',true,0.071,0.069,'ud',v_supplier_goods,current_date-12,0.16,21,'Vaso kraft 240 ml','8400000000001'),
    (v_product_film,p_workspace_id,'Film alimentario 45 cm','DEMO-FILM-45','Film','rollo',true,3.15,3.05,'rollo',v_supplier_goods,current_date-8,7.95,21,'Film alimentario 45 cm','8400000000002'),
    (v_product_bags,p_workspace_id,'Bolsa camiseta 40x50','DEMO-BOLSA-4050','Bolsas','ud',true,0.031,0.030,'ud',v_supplier_goods,current_date-5,0.075,21,'Bolsa camiseta 40x50','8400000000003'),
    (v_product_tubs,p_workspace_id,'Tarrina salsa 60 ml','DEMO-TARRINA-60','Tarrinas','ud',true,0.052,0.049,'ud',v_supplier_goods,current_date-3,0.13,21,'Tarrina salsa 60 ml','8400000000004');

  insert into public.clients(id,owner_id,name,tax_id,email,phone,address_line1,postal_code,city,province,country_code,payment_terms_days,notes,active,default_vat_rate,default_payment_method)
  values
    (v_client_restaurant,p_workspace_id,'Restaurante La Marina Demo','B11010001','compras.marina@example.com','600000111','Paseo Marítimo 8','11010','Cádiz','Cádiz','ES',30,'Cliente ficticio.',true,21,'transfer'),
    (v_client_fruit,p_workspace_id,'Frutas del Sur Demo','B41010002','pedidos.frutas@example.com','600000112','Calle Mercado 14','41001','Sevilla','Sevilla','ES',15,'Cliente ficticio.',true,21,'card'),
    (v_client_catering,p_workspace_id,'Catering Costa Demo','B29010003','administracion.catering@example.com','600000113','Avenida del Puerto 31','29002','Málaga','Málaga','ES',30,'Cliente ficticio.',true,21,'transfer');

  insert into public.invoices(
    id,owner_id,supplier_id,invoice_number,issue_date,received_date,fiscal_year,fiscal_quarter,currency,net_amount,tax_amount,withholding_amount,
    total_amount,expense_category_id,status,source,extraction,extraction_confidence,notes,equivalence_surcharge_amount,payment_status,paid_at
  ) values
    (v_purchase_1,p_workspace_id,v_supplier_goods,'DEMO-COMP-001',current_date-35,current_date-34,extract(year from current_date-35)::int,extract(quarter from current_date-35)::int,'EUR',824.00,173.04,0,997.04,v_merchandise_category,'accounted','manual','{"demo":true}'::jsonb,1,'Factura ficticia.',0,'paid',current_date-25),
    (v_purchase_2,p_workspace_id,v_supplier_logistics,'DEMO-LOG-014',current_date-12,current_date-11,extract(year from current_date-12)::int,extract(quarter from current_date-12)::int,'EUR',186.00,39.06,0,225.06,v_transport_category,'reviewed','manual','{"demo":true}'::jsonb,1,'Factura ficticia pendiente de pago.',0,'unpaid',null),
    (v_purchase_3,p_workspace_id,v_supplier_software,'DEMO-SAA-089',current_date-7,current_date-7,extract(year from current_date-7)::int,extract(quarter from current_date-7)::int,'USD',49.00,0,0,49.00,v_software_category,'accounted','manual','{"demo":true,"reverse_charge":true}'::jsonb,1,'Servicio SaaS ficticio en USD.',0,'paid',current_date-7);

  insert into public.invoice_lines(owner_id,invoice_id,product_id,description,supplier_sku,quantity,unit,units_per_purchase,unit_price,normalized_unit_price,line_net,tax_rate,tax_amount,line_total,ai_confidence,price_update_status)
  values
    (p_workspace_id,v_purchase_1,v_product_cups,'Vaso kraft 240 ml','VASO-K240',6000,'ud',1,0.071,0.071,426.00,21,89.46,515.46,1,'confirmed'),
    (p_workspace_id,v_purchase_1,v_product_bags,'Bolsa camiseta 40x50','BOL-4050',10000,'ud',1,0.031,0.031,310.00,21,65.10,375.10,1,'confirmed'),
    (p_workspace_id,v_purchase_1,v_product_tubs,'Tarrina salsa 60 ml','TAR-60',1692.3077,'ud',1,0.052,0.052,88.00,21,18.48,106.48,1,'confirmed'),
    (p_workspace_id,v_purchase_2,null,'Servicio transporte nacional',null,1,'servicio',1,186,186,186,21,39.06,225.06,1,'pending'),
    (p_workspace_id,v_purchase_3,null,'Suscripción analítica mensual',null,1,'mes',1,49,49,49,0,0,49,1,'pending');

  insert into public.sales_invoice_series(id,owner_id,code,name,kind,year,prefix,next_number,padding,active)
  values(v_sales_series,p_workspace_id,'DEMO','Serie Demo','standard',v_year,'D-'||v_year||'-',3,4,true);

  insert into public.sales_invoices(
    id,owner_id,client_id,series_id,invoice_type,invoice_number,status,issue_date,due_date,currency,subtotal,discount_amount,tax_amount,total_amount,
    payment_method,notes,client_name,client_tax_id,client_email,client_phone,client_address,issuer_name,issuer_tax_id,issuer_email,issuer_phone,issuer_address,
    issued_at,sent_at,paid_at,reserved_number,document_kind,fiscal_treatment
  ) values
    (v_sale_1,p_workspace_id,v_client_restaurant,v_sales_series,'standard','D-'||v_year||'-0001','draft',current_date-20,current_date+10,'EUR',412.00,0,86.52,498.52,'transfer','Venta ficticia.',
      'Restaurante La Marina Demo','B11010001','compras.marina@example.com','600000111','Paseo Marítimo 8, Cádiz','Comercial Bahía Demo SL','B12345678','administracion@example.com','600000000','Avenida del Comercio 24, Cádiz',
      v_now-interval '20 days',null,null,1,'invoice','taxable'),
    (v_sale_2,p_workspace_id,v_client_fruit,v_sales_series,'standard','D-'||v_year||'-0002','draft',current_date-4,current_date+26,'EUR',286.00,0,60.06,346.06,'transfer','Venta ficticia pendiente.',
      'Frutas del Sur Demo','B41010002','pedidos.frutas@example.com','600000112','Calle Mercado 14, Sevilla','Comercial Bahía Demo SL','B12345678','administracion@example.com','600000000','Avenida del Comercio 24, Cádiz',
      null,null,null,2,'invoice','taxable');

  insert into public.sales_invoice_lines(owner_id,invoice_id,product_id,position,description,quantity,unit,unit_price,discount_percent,tax_rate,line_net,tax_amount,line_total)
  values
    (p_workspace_id,v_sale_1,v_product_film,1,'Film alimentario 45 cm',30,'rollo',7.95,0,21,238.50,50.085,288.585),
    (p_workspace_id,v_sale_1,v_product_tubs,2,'Tarrina salsa 60 ml',1334.6154,'ud',0.13,0,21,173.50,36.435,209.935),
    (p_workspace_id,v_sale_2,v_product_cups,1,'Vaso kraft 240 ml',1000,'ud',0.16,0,21,160.00,33.60,193.60),
    (p_workspace_id,v_sale_2,v_product_bags,2,'Bolsa camiseta 40x50',1680,'ud',0.075,0,21,126.00,26.46,152.46);

  -- Lines are guarded as immutable once an invoice leaves draft.
  update public.sales_invoices
  set status='issued'
  where id=v_sale_1 and owner_id=p_workspace_id;

  insert into public.fulfillment_orders(
    owner_id,sendcloud_id,order_id,order_number,integration_id,integration_name,integration_type,source_channel,source_status,
    order_created_at,order_updated_at,customer_name,customer_email,customer_phone,shipping_address,billing_address,items,total_amount,currency,raw_payload,
    tracking_number,tracking_url,label_created_at,fulfilled_at,last_synced_at,carrier_code,carrier_name,shipping_service_name,tracking_status_code,tracking_status_message,
    shipping_cost_amount,shipping_cost_currency,shipping_cost_source,shipping_cost_net_amount,shipping_cost_tax_amount,shipping_cost_recorded_at
  ) values
    (p_workspace_id,'demo-order-1001','AMZ-DEMO-1001','DEMO-1001',900001,'Amazon Demo','amazon','amazon','shipped',v_demo_today-interval '8 days',v_demo_today-interval '7 days','Laura Martín','laura.martin@example.com','600100001',
      '{"street":"Calle Sol 10","city":"Sevilla","postal_code":"41001","country":"ES"}','{}',
      '[{"sku":"DEMO-FILM-45","name":"Film alimentario 45 cm","quantity":2}]',15.90,'EUR','{"demo":true}',
      'DEMO-TRK-1001','https://example.com/tracking/demo-1001',v_now-interval '7 days',v_now-interval '7 days',v_now,'ctt','CTT Express','24H','delivered','Entregado',4.20,'EUR','demo',3.47,0.73,v_now-interval '7 days'),
    (p_workspace_id,'demo-order-1002','WEB-DEMO-1002','DEMO-1002',900002,'Web Demo','shop','other','pending',v_now-interval '1 day',v_now-interval '1 day','Miguel Ruiz','miguel.ruiz@example.com','600100002',
      '{"street":"Avenida Andalucía 22","city":"Málaga","postal_code":"29002","country":"ES"}','{}',
      '[{"sku":"DEMO-VASO-240","name":"Vaso kraft 240 ml","quantity":500},{"sku":"DEMO-TARRINA-60","name":"Tarrina salsa 60 ml","quantity":500}]',145.00,'EUR','{"demo":true}',
      null,null,null,null,v_now,null,null,null,null,'Pendiente de preparar',null,null,null,null,null,null),
    (p_workspace_id,'demo-order-1003','AMZ-DEMO-1003','DEMO-1003',900001,'Amazon Demo','amazon','amazon','unshipped',v_demo_today+interval '30 minutes',v_demo_today+interval '35 minutes','Ana López','ana.lopez@example.com','600100003',
      '{"street":"Calle Real 5","city":"Cádiz","postal_code":"11001","country":"ES"}','{}',
      '[{"sku":"DEMO-BOLSA-4050","name":"Bolsa camiseta 40x50","quantity":1000}]',75.00,'EUR','{"demo":true}',
      null,null,null,null,v_now,null,null,null,null,'Pendiente de etiqueta',null,null,null,null,null,null);

  insert into public.amazon_accounts(id,owner_id,seller_id,display_name,region,status,initial_sync_from,last_successful_sync_at)
  values(v_amazon_account,p_workspace_id,'A-DEMO-ZENVIA','Amazon Europe · Demo','EU','disabled',v_now-interval '90 days',v_now-interval '1 hour');

  insert into public.amazon_orders(
    owner_id,amazon_account_id,amazon_order_id,marketplace_id,purchase_date,last_update_date,order_status,fulfillment_channel,sales_channel,currency_code,
    gross_sales,vat_amount,shipping_amount,promotion_discount,order_total,synced_at,programs,is_business_order
  ) values
    (p_workspace_id,v_amazon_account,'404-DEMO-0000001','A1RKKUPIHCS9HS',v_now-interval '8 days',v_now-interval '7 days','Shipped','MFN','Amazon.es','EUR',15.90,2.76,0,0,15.90,v_now,'{}',false),
    (p_workspace_id,v_amazon_account,'404-DEMO-0000002','A1RKKUPIHCS9HS',v_demo_today+interval '20 minutes',v_demo_today+interval '25 minutes','Unshipped','MFN','Amazon.es','EUR',75.00,13.02,0,0,75.00,v_now,'{}',true),
    (p_workspace_id,v_amazon_account,'171-DEMO-0000003','A13V1IB3VIYZZH',v_now-interval '5 days',v_now-interval '4 days','Shipped','AFN','Amazon.fr','EUR',34.90,5.82,0,0,34.90,v_now,'{}',false);

  insert into public.amazon_order_items(
    owner_id,amazon_account_id,amazon_order_id,marketplace_id,order_item_id,asin,seller_sku,quantity_ordered,quantity_shipped,item_price,item_tax,shipping_price,shipping_tax,promotion_discount,currency_code,synced_at
  ) values
    (p_workspace_id,v_amazon_account,'404-DEMO-0000001','A1RKKUPIHCS9HS','DEMO-ITEM-1','B0DEMOFILM1','DEMO-FILM-45',2,2,15.90,2.76,0,0,0,'EUR',v_now),
    (p_workspace_id,v_amazon_account,'404-DEMO-0000002','A1RKKUPIHCS9HS','DEMO-ITEM-2','B0DEMOBAGS1','DEMO-BOLSA-4050',1,0,75.00,13.02,0,0,0,'EUR',v_now),
    (p_workspace_id,v_amazon_account,'171-DEMO-0000003','A13V1IB3VIYZZH','DEMO-ITEM-3','B0DEMOCUPS1','DEMO-VASO-240',1,1,34.90,5.82,0,0,0,'EUR',v_now);

  update public.app_settings
  set config=jsonb_set(
        coalesce(config,'{}'::jsonb),
        '{demo}',
        jsonb_build_object(
          'enabled',true,
          'scenario','commerce_full',
          'scenario_version',1,
          'last_reset_at',v_now,
          'external_actions_disabled',true
        ),
        true
      ),
      updated_at=v_now
  where owner_id=p_workspace_id;

  return jsonb_build_object(
    'ok',true,
    'workspaceId',p_workspace_id,
    'scenario','commerce_full',
    'scenarioVersion',1,
    'resetAt',v_now,
    'counts',jsonb_build_object(
      'products',4,'clients',3,'suppliers',3,'purchaseInvoices',3,'salesInvoices',2,'fulfillmentOrders',3,'amazonOrders',3
    )
  );
end;
$function$
;

ALTER FUNCTION platform_reset_demo_workspace(uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.shopify_add_product_mapping(integration_account_id uuid, seller_sku text, product_id uuid, consumption_factor numeric DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare v uuid:=private.shopify_analytics_owner();begin
 if coalesce(trim(seller_sku),'')='' or consumption_factor is null or consumption_factor<=0 or consumption_factor::text in ('NaN','Infinity','-Infinity') then raise exception 'Indica un SKU y un factor de consumo válido.';end if;
 if not exists(select 1 from public.integration_accounts a where a.id=integration_account_id and a.owner_id=v and a.provider='shopify') or not exists(select 1 from public.products p where p.id=product_id and p.owner_id=v) then raise exception 'Producto o tienda no permitido.' using errcode='42501';end if;
 insert into public.shopify_product_mappings(owner_id,integration_account_id,seller_sku,product_id,consumption_factor) values(v,integration_account_id,trim(seller_sku),product_id,consumption_factor) on conflict (integration_account_id,seller_sku,product_id) do update set consumption_factor=excluded.consumption_factor;
 return jsonb_build_object('ok',true);end;$function$
;

ALTER FUNCTION shopify_add_product_mapping(uuid,text,uuid,numeric) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.shopify_analytics_products(from_date date, to_date date, integration_account_ids uuid[] DEFAULT NULL::uuid[], search text DEFAULT NULL::text, page integer DEFAULT 1, page_size integer DEFAULT 50, sort_by text DEFAULT 'product_name'::text, sort_dir text DEFAULT 'asc'::text, include_catalog boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v uuid:=private.shopify_analytics_owner(); result jsonb;v_sort text:=coalesce(sort_by,'product_name');v_dir text:=case when lower(sort_dir)='desc' then 'desc' else 'asc' end;v_page integer:=greatest(1,coalesce(page,1));v_size integer:=greatest(1,least(200,coalesce(page_size,50)));begin
 if from_date is null or to_date is null or from_date>to_date then raise exception 'El período no es válido.';end if;
 with stores as(select a.id,a.display_name from public.integration_accounts a where a.owner_id=v and a.provider='shopify' and a.enabled and a.status<>'disabled' and a.credential_source<>'derived' and (coalesce(cardinality(integration_account_ids),0)=0 or a.id=any(integration_account_ids))),
 eligible as(select o.*,(o.event_at at time zone private.amazon_analytics_timezone())::date d,private.amazon_rate_to_eur(o.currency,(o.event_at at time zone private.amazon_analytics_timezone())::date) fx from public.shopify_analytics_orders o join stores s on s.id=o.integration_account_id
 where o.owner_id=v and not o.test and o.financial_status in ('PAID','PARTIALLY_PAID','PARTIALLY_REFUNDED','REFUNDED') and o.event_at>=(from_date::timestamp at time zone private.amazon_analytics_timezone()) and o.event_at<((to_date+1)::timestamp at time zone private.amazon_analytics_timezone())),
 item_rows as(select i.*,o.fx,c.cost,c.missing,c.mapping_count from eligible o join public.shopify_analytics_items i on i.integration_account_id=o.integration_account_id and i.order_id=o.order_id and i.owner_id=v left join lateral private.shopify_cost(v,i.integration_account_id,i.seller_sku,o.d) c on true),
 sales as(select integration_account_id,seller_sku,max(variant_id) variant_id,max(name) name,max(image_url) image_url,count(distinct order_id) orders,sum(quantity) units,sum(gross_sales*fx) gross,sum(net_sales*fx) net,sum(quantity*cost) cost,count(*) filter(where fx is null) missing_fx,count(*) filter(where missing>0 or mapping_count=0 or fx is null) missing from item_rows group by integration_account_id,seller_sku),
 refunds as(select r.integration_account_id,r.seller_sku,sum(r.net_amount*private.amazon_rate_to_eur(r.currency,(r.event_at at time zone private.amazon_analytics_timezone())::date)) net,count(*) filter(where private.amazon_rate_to_eur(r.currency,(r.event_at at time zone private.amazon_analytics_timezone())::date) is null) missing from public.shopify_analytics_refund_items r join stores s on s.id=r.integration_account_id where r.owner_id=v and exists(select 1 from public.shopify_analytics_orders ro where ro.integration_account_id=r.integration_account_id and ro.order_id=r.order_id and ro.owner_id=v and not ro.test) and r.event_at>=(from_date::timestamp at time zone private.amazon_analytics_timezone()) and r.event_at<((to_date+1)::timestamp at time zone private.amazon_analytics_timezone()) group by r.integration_account_id,r.seller_sku),
 catalog as(select c.integration_account_id,c.seller_sku,max(c.variant_id) variant_id,max(c.name) name,max(c.image_url) image_url,case when count(*) filter(where c.inventory_quantity is null)>0 then null else sum(c.inventory_quantity)::integer end inventory from public.shopify_analytics_catalog c join stores s on s.id=c.integration_account_id where c.owner_id=v group by c.integration_account_id,c.seller_sku),
 keys as(select integration_account_id,seller_sku from sales union select integration_account_id,seller_sku from catalog where include_catalog union select integration_account_id,seller_sku from refunds),
 mappings as(select m.integration_account_id,m.seller_sku,(array_agg(p.id order by p.name))[1] product_id,string_agg(p.name,' + ' order by p.name) name,(array_agg(m.consumption_factor order by p.name))[1] factor from public.shopify_product_mappings m join public.products p on p.id=m.product_id and p.owner_id=v where m.owner_id=v group by m.integration_account_id,m.seller_sku),
 rows as(select k.*,st.display_name,coalesce(c.variant_id,s.variant_id) variant_id,coalesce(c.name,s.name,k.seller_sku) name,coalesce(c.image_url,s.image_url) image_url,coalesce(s.orders,0) orders,coalesce(s.units,0) units,coalesce(s.gross,0) gross,coalesce(s.net,0) net,coalesce(r.net,0) refunds,coalesce(s.cost,0) cost,coalesce(s.missing,0)+coalesce(r.missing,0) missing,coalesce(s.missing_fx,0)+coalesce(r.missing,0) missing_fx,c.inventory,m.product_id,m.name mapping_name,coalesce(m.factor,1) factor from keys k join stores st on st.id=k.integration_account_id left join sales s using(integration_account_id,seller_sku) left join catalog c using(integration_account_id,seller_sku) left join refunds r using(integration_account_id,seller_sku) left join mappings m using(integration_account_id,seller_sku)
 where coalesce(search,'')='' or k.seller_sku ilike '%'||search||'%' or coalesce(c.name,s.name,'') ilike '%'||search||'%'),
 sortable as(select rows.*,case v_sort when 'product_name' then name when 'mapping_product_name' then mapping_name end sort_text,case v_sort when 'units' then units when 'orders' then orders when 'gross_sales' then gross when 'net_sales' then net when 'refunds' then refunds when 'product_cost' then case when missing=0 then cost end when 'inventory_quantity' then inventory else null end sort_number from rows),
 selected as(select * from sortable order by case when v_dir='asc' then sort_text end asc nulls last,case when v_dir='desc' then sort_text end desc nulls last,case when v_dir='asc' then sort_number end asc nulls last,case when v_dir='desc' then sort_number end desc nulls last,seller_sku,integration_account_id limit v_size offset (v_page-1)*v_size)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',integration_account_id::text||':'||seller_sku,'storeId',integration_account_id,'storeName',display_name,'sku',seller_sku,'variantId',variant_id,'name',name,'imageUrl',image_url,'mappingProductId',product_id,'mappingProductName',mapping_name,'consumptionFactor',factor,'orders',orders,'units',units,'grossSales',case when missing_fx=0 then round(gross,2) end,'netSales',case when missing_fx=0 then round(net,2) end,'refunds',case when missing_fx=0 then round(refunds,2) end,'productCost',case when missing=0 then round(cost,2) end,'shippingCost',null,'profitBeforeAds',null,'profitComplete',false,'currency','EUR','inventoryQuantity',inventory) order by case when v_dir='asc' then sort_text end asc nulls last,case when v_dir='desc' then sort_text end desc nulls last,case when v_dir='asc' then sort_number end asc nulls last,case when v_dir='desc' then sort_number end desc nulls last,seller_sku,integration_account_id) from selected),'[]'::jsonb),'total',(select count(*) from rows),'page',v_page,'pageSize',v_size) into result;
 return result;end;$function$
;

ALTER FUNCTION shopify_analytics_products(date,date,uuid[],text,integer,integer,text,text,boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.shopify_analytics_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v uuid:=private.shopify_analytics_owner();result jsonb;begin
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.display_name,'domain',coalesce(a.config->>'shopDomain',a.external_account_id),'status',coalesce(s.status,'pending'),'lastSyncedAt',s.last_synced_at,'availableFrom',s.available_from,'inventoryAvailable',coalesce(s.inventory_available,false),'catalogAvailable',coalesce(s.catalog_available,false),'historyLimited',coalesce(s.history_limited,true),'error',s.error) order by a.display_name),'[]'::jsonb) into result
 from public.integration_accounts a left join public.shopify_analytics_sync_state s on s.integration_account_id=a.id and s.owner_id=v
 where a.owner_id=v and a.provider='shopify' and a.enabled and a.status<>'disabled' and a.credential_source<>'derived';
 return jsonb_build_object('stores',result,'connected',jsonb_array_length(result)>0);end;$function$
;

ALTER FUNCTION shopify_analytics_status() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.shopify_analytics_summary(from_date date, to_date date, integration_account_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v uuid:=private.shopify_analytics_owner(); result jsonb;begin
 if from_date is null or to_date is null or from_date>to_date then raise exception 'El período no es válido.';end if;
 with eligible as(select o.*,(o.event_at at time zone private.amazon_analytics_timezone())::date d,private.amazon_rate_to_eur(o.currency,(o.event_at at time zone private.amazon_analytics_timezone())::date) fx
 from public.shopify_analytics_orders o join public.integration_accounts a on a.id=o.integration_account_id and a.owner_id=v and a.enabled and a.status<>'disabled'
 where o.owner_id=v and not o.test and o.financial_status in ('PAID','PARTIALLY_PAID','PARTIALLY_REFUNDED','REFUNDED')
 and o.event_at>=(from_date::timestamp at time zone private.amazon_analytics_timezone()) and o.event_at<((to_date+1)::timestamp at time zone private.amazon_analytics_timezone()) and (coalesce(cardinality(integration_account_ids),0)=0 or o.integration_account_id=any(integration_account_ids))),
 sales as(select count(*) orders,coalesce(sum(gross_sales*fx),0) gross,coalesce(sum(sales_vat*fx),0) vat,coalesce(sum(discounts*fx),0) discounts,coalesce(sum(shipping_charged*fx),0) shipping_charged,count(*) filter(where fx is null) missing_fx from eligible),
 cost_rows as(select i.quantity,c.cost,c.missing,c.mapping_count from eligible o join public.shopify_analytics_items i on i.integration_account_id=o.integration_account_id and i.order_id=o.order_id and i.owner_id=v left join lateral private.shopify_cost(v,i.integration_account_id,i.seller_sku,o.d) c on true),
 costs as(select coalesce(sum(quantity),0) units,coalesce(sum(quantity*cost),0) product_cost,count(*) filter(where mapping_count=0) unmapped,count(*) filter(where mapping_count=0 or missing>0) missing from cost_rows),
 shipping_rows as(select case when not requires_shipping then 0 else private.shopify_shipping(v,integration_account_id,order_id,d) end cost from eligible),
 shipping as(select coalesce(sum(cost),0) cost,count(*) filter(where cost is null) missing from shipping_rows),
 refund_rows as(select r.*,private.amazon_rate_to_eur(r.currency,(r.event_at at time zone private.amazon_analytics_timezone())::date) fx from public.shopify_analytics_refunds r join public.integration_accounts a on a.id=r.integration_account_id and a.owner_id=v and a.enabled and a.status<>'disabled'
 where r.owner_id=v and exists(select 1 from public.shopify_analytics_orders ro where ro.integration_account_id=r.integration_account_id and ro.order_id=r.order_id and ro.owner_id=v and not ro.test) and r.event_at>=(from_date::timestamp at time zone private.amazon_analytics_timezone()) and r.event_at<((to_date+1)::timestamp at time zone private.amazon_analytics_timezone()) and (coalesce(cardinality(integration_account_ids),0)=0 or r.integration_account_id=any(integration_account_ids))),
 refunds as(select count(*) n,coalesce(sum(gross_amount*fx),0) gross,coalesce(sum(net_amount*fx),0) net,count(*) filter(where fx is null) missing_fx from refund_rows)
 select jsonb_build_object('grossSales',case when s.missing_fx=0 then round(s.gross,2) end,'salesVat',case when s.missing_fx=0 then round(s.vat,2) end,'netSales',case when s.missing_fx=0 then round(s.gross-s.vat,2) end,'orders',s.orders,'units',c.units,'refunds',case when r.missing_fx=0 then round(r.net,2) end,'refundGross',case when r.missing_fx=0 then round(r.gross,2) end,'refundCount',r.n,'discounts',case when s.missing_fx=0 then round(s.discounts,2) end,'shippingCharged',case when s.missing_fx=0 then round(s.shipping_charged,2) end,'productCost',case when c.missing=0 then round(c.product_cost,2) end,'shippingCost',case when sh.missing=0 then round(sh.cost,2) end,'paymentFees',null,'adsCost',null,'netProfit',null,'profitBeforeAds',case when c.missing+sh.missing+s.missing_fx+r.missing_fx=0 then round(s.gross-s.vat-r.net-c.product_cost-sh.cost,2) end,'marginPct',null,'knownMarginPct',case when s.missing_fx=0 and r.missing_fx=0 and s.gross-s.vat>0 then round(100*(s.gross-s.vat-r.net-c.product_cost-sh.cost)/nullif(s.gross-s.vat,0),1) end,'unmappedSkuCount',c.unmapped,'missingCostCount',c.missing+sh.missing,'missingFxCount',s.missing_fx+r.missing_fx,'profitComplete',false,'currency','EUR','availableFrom',(select min(st.available_from) from public.shopify_analytics_sync_state st where st.owner_id=v and (coalesce(cardinality(integration_account_ids),0)=0 or st.integration_account_id=any(integration_account_ids)))) into result from sales s cross join costs c cross join shipping sh cross join refunds r;
 return result;end;$function$
;

ALTER FUNCTION shopify_analytics_summary(date,date,uuid[]) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.shopify_get_product_mappings(integration_account_id uuid, seller_sku text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v uuid:=private.shopify_analytics_owner();result jsonb;begin
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'productId',p.id,'productName',p.name,'productSku',p.sku,'unitCost',p.last_cost,'costUnit',p.cost_unit,'consumptionFactor',m.consumption_factor,'supplierName',s.name) order by p.name),'[]'::jsonb) into result from public.shopify_product_mappings m join public.products p on p.id=m.product_id and p.owner_id=v left join public.suppliers s on s.id=p.last_supplier_id and s.owner_id=v where m.owner_id=v and m.integration_account_id=shopify_get_product_mappings.integration_account_id and m.seller_sku=trim(shopify_get_product_mappings.seller_sku);return result;end;$function$
;

ALTER FUNCTION shopify_get_product_mappings(uuid,text) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.shopify_product_options(search text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v uuid:=private.shopify_analytics_owner();result jsonb;begin
 select coalesce(jsonb_agg(row),'[]'::jsonb) into result from(select p.id,p.name,p.sku,s.name as "supplierName",p.last_cost as "unitCost",p.cost_unit as "costUnit" from public.products p left join public.suppliers s on s.id=p.last_supplier_id and s.owner_id=v where p.owner_id=v and (coalesce(search,'')='' or p.name ilike '%'||search||'%' or p.sku ilike '%'||search||'%') order by p.name limit 500) row;return result;end;$function$
;

ALTER FUNCTION shopify_product_options(text) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.transport_tariff_activate(document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid;
  v_document public.transport_tariff_documents%rowtype;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('orders') then raise exception 'Forbidden'; end if;

  select * into v_document from public.transport_tariff_documents
  where id=document_id and owner_id=v_owner for update;
  if not found then raise exception 'Tarifa no encontrada'; end if;
  if v_document.status<>'reviewed' then raise exception 'La tarifa debe estar revisada antes de activarla'; end if;
  if v_document.effective_from is null then raise exception 'La tarifa no tiene fecha de inicio'; end if;

  update public.transport_tariff_documents
  set effective_to=v_document.effective_from-1,status='superseded',updated_at=now()
  where owner_id=v_owner
    and shipping_provider=v_document.shipping_provider
    and carrier_code=v_document.carrier_code
    and status='active'
    and id<>document_id
    and effective_from<v_document.effective_from
    and (effective_to is null or effective_to>=v_document.effective_from);

  if exists(
    select 1 from public.transport_tariff_documents d
    where d.owner_id=v_owner
      and d.shipping_provider=v_document.shipping_provider
      and d.carrier_code=v_document.carrier_code
      and d.status='active'
      and d.id<>document_id
      and daterange(d.effective_from,coalesce(d.effective_to,'infinity'::date),'[]') &&
          daterange(v_document.effective_from,coalesce(v_document.effective_to,'infinity'::date),'[]')
  ) then
    raise exception 'Existe otra tarifa activa del transportista para esta plataforma que solapa este periodo';
  end if;

  update public.transport_tariff_documents
  set status='active',activated_by=auth.uid(),activated_at=now(),updated_at=now()
  where id=document_id and owner_id=v_owner;

  return jsonb_build_object('ok',true,'status','active','shippingProvider',v_document.shipping_provider);
end;
$function$
;

ALTER FUNCTION transport_tariff_activate(uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.transport_tariff_mark_reviewed(document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid;
  v_document public.transport_tariff_documents%rowtype;
  v_unconfirmed bigint;
  v_band_count bigint;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('orders') then raise exception 'Forbidden'; end if;

  select * into v_document from public.transport_tariff_documents d
  where d.id=$1 and d.owner_id=v_owner for update;
  if not found then raise exception 'Tarifa no encontrada'; end if;
  if v_document.status<>'draft' then raise exception 'Solo una tarifa en borrador puede marcarse como revisada'; end if;
  if v_document.effective_from is null then raise exception 'Indica la fecha de inicio de vigencia'; end if;

  select count(*) into v_unconfirmed from public.transport_tariff_services s
  where s.owner_id=v_owner and s.document_id=$1 and s.mapping_status<>'confirmed';
  if v_unconfirmed>0 then raise exception 'Confirma la asociación de todos los servicios antes de revisar'; end if;

  select count(*) into v_band_count
  from public.transport_tariff_bands b
  join public.transport_tariff_services s on s.id=b.service_id and s.owner_id=b.owner_id
  where s.owner_id=v_owner and s.document_id=$1;
  if v_band_count=0 then raise exception 'La tarifa no contiene tramos'; end if;

  update public.transport_tariff_documents d
  set status='reviewed',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
  where d.id=$1 and d.owner_id=v_owner;

  insert into public.transport_service_mappings(owner_id,carrier_code,canonical_service_key,external_provider,external_service_code,confirmed_by,confirmed_at,updated_at)
  select v_owner,v_document.carrier_code,s.canonical_service_key,s.external_provider,s.external_service_code,auth.uid(),now(),now()
  from public.transport_tariff_services s
  where s.owner_id=v_owner and s.document_id=$1 and s.mapping_status='confirmed'
    and nullif(s.external_provider,'') is not null and nullif(s.external_service_code,'') is not null
  on conflict(owner_id,carrier_code,canonical_service_key) do update
  set external_provider=excluded.external_provider,external_service_code=excluded.external_service_code,
      confirmed_by=excluded.confirmed_by,confirmed_at=excluded.confirmed_at,updated_at=excluded.updated_at;

  return jsonb_build_object('ok',true,'status','reviewed');
end;
$function$
;

ALTER FUNCTION transport_tariff_mark_reviewed(uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.transport_tariff_reprice_estimates(document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid;
  v_document public.transport_tariff_documents%rowtype;
  v_count bigint;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('orders') then raise exception 'Forbidden'; end if;

  select * into v_document
  from public.transport_tariff_documents d
  where d.id=document_id and d.owner_id=v_owner;
  if not found then raise exception 'Tarifa no encontrada'; end if;
  if v_document.carrier_code<>'mrw' then return jsonb_build_object('ok',true,'updated',0); end if;

  with candidates as (
    select f.id,f.order_created_at,
      upper(coalesce(f.shipping_address->>'country_code','')) country_code,
      regexp_replace(coalesce(f.shipping_address->>'postal_code',''),'\s+','','g') postal_code,
      case
        when coalesce(f.raw_payload#>>'{shipping_details,measurement,weight,value}','') !~ '^[0-9]+([.][0-9]+)?$' then null
        when lower(coalesce(f.raw_payload#>>'{shipping_details,measurement,weight,unit}','kg'))='g'
          then (f.raw_payload#>>'{shipping_details,measurement,weight,value}')::numeric/1000
        when lower(coalesce(f.raw_payload#>>'{shipping_details,measurement,weight,unit}','kg')) in ('lb','lbs')
          then (f.raw_payload#>>'{shipping_details,measurement,weight,value}')::numeric*0.45359237
        else (f.raw_payload#>>'{shipping_details,measurement,weight,value}')::numeric
      end weight_kg
    from public.fulfillment_orders f
    where f.owner_id=v_owner
      and f.shipping_cost_source='tariff_estimate'
      and f.order_created_at is not null
      and f.order_created_at::date between coalesce(v_document.effective_from,'1900-01-01'::date) and coalesce(v_document.effective_to,'9999-12-31'::date)
  ),
  priced as (
    select c.id,p.price
    from candidates c
    cross join lateral (
      select private.transport_tariff_estimate_for_date(
        v_owner,document_id,c.order_created_at::date,c.country_code,c.postal_code,c.weight_kg
      ) price
    ) p
    where p.price is not null
  ),
  updated as (
    update public.fulfillment_orders f
    set shipping_cost_amount=(p.price->>'totalAmount')::numeric,
        shipping_cost_net_amount=(p.price->>'netAmount')::numeric,
        shipping_cost_tax_amount=(p.price->>'taxAmount')::numeric,
        shipping_cost_currency=coalesce(p.price->>'currency','EUR'),
        shipping_cost_source='tariff_estimate',
        updated_at=now()
    from priced p
    where f.id=p.id and f.owner_id=v_owner
    returning f.id
  )
  select count(*) into v_count from updated;

  return jsonb_build_object('ok',true,'updated',v_count);
end;
$function$
;

ALTER FUNCTION transport_tariff_reprice_estimates(uuid) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.transport_tariff_save_active(document_id uuid, apply_from date, snapshot jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid;
  v_document public.transport_tariff_documents%rowtype;
  v_baseline date;
  v_effective_from date;
  v_effective_to date;
  v_service jsonb;
  v_band jsonb;
  v_service_id uuid;
  v_service_index integer:=0;
  v_band_index integer;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('orders') then raise exception 'Forbidden'; end if;
  if apply_from is null then raise exception 'Indica desde qué fecha se aplican los cambios'; end if;
  if snapshot is null or jsonb_typeof(snapshot)<>'object' then raise exception 'Configuración de tarifa no válida'; end if;

  select * into v_document
  from public.transport_tariff_documents d
  where d.id=document_id and d.owner_id=v_owner
  for update;

  if not found then raise exception 'Tarifa no encontrada'; end if;
  if v_document.status<>'active' then raise exception 'La tarifa no está activa'; end if;

  v_effective_from:=coalesce(nullif(snapshot->>'effectiveFrom','')::date,v_document.effective_from);
  v_effective_to:=case when snapshot ? 'effectiveTo' then nullif(snapshot->>'effectiveTo','')::date else v_document.effective_to end;

  if v_effective_from is not null and apply_from<v_effective_from then
    raise exception 'La fecha de aplicación no puede ser anterior al inicio de vigencia';
  end if;
  if v_effective_to is not null and apply_from>v_effective_to then
    raise exception 'La fecha de aplicación no puede ser posterior al fin de vigencia';
  end if;

  v_baseline:=coalesce(v_document.effective_from,apply_from);

  if not exists(
    select 1 from public.transport_tariff_revisions r
    where r.owner_id=v_owner and r.document_id=document_id and r.effective_from=v_baseline
  ) then
    insert into public.transport_tariff_revisions(owner_id,document_id,effective_from,snapshot,created_by)
    values(v_owner,document_id,v_baseline,private.transport_tariff_snapshot(v_owner,document_id),auth.uid());
  end if;

  insert into public.transport_tariff_revisions(owner_id,document_id,effective_from,snapshot,created_by,updated_at)
  values(v_owner,document_id,apply_from,snapshot,auth.uid(),now())
  on conflict(owner_id,document_id,effective_from) do update
  set snapshot=excluded.snapshot,updated_at=now();

  update public.transport_tariff_documents d
  set carrier_code=coalesce(nullif(snapshot->>'carrierCode',''),d.carrier_code),
      carrier_name=coalesce(nullif(snapshot->>'carrierName',''),d.carrier_name),
      effective_from=v_effective_from,
      effective_to=v_effective_to,
      currency_code=coalesce(nullif(snapshot->>'currencyCode',''),d.currency_code),
      prices_include_vat=coalesce(nullif(snapshot->>'pricesIncludeVat','')::boolean,d.prices_include_vat),
      vat_rate_pct=coalesce(nullif(snapshot->>'vatRatePct','')::numeric,d.vat_rate_pct),
      fuel_surcharge_pct=case when snapshot ? 'fuelSurchargePct' then nullif(snapshot->>'fuelSurchargePct','')::numeric else d.fuel_surcharge_pct end,
      fuel_surcharge_included=coalesce(nullif(snapshot->>'fuelSurchargeIncluded','')::boolean,d.fuel_surcharge_included),
      updated_at=now()
  where d.id=document_id and d.owner_id=v_owner;

  delete from public.transport_tariff_services s
  where s.owner_id=v_owner and s.document_id=document_id;

  for v_service in
    select value from jsonb_array_elements(coalesce(snapshot->'services','[]'::jsonb))
  loop
    insert into public.transport_tariff_services(
      owner_id,document_id,service_name,canonical_service_key,external_provider,
      external_service_code,mapping_status,sort_order
    )
    values(
      v_owner,document_id,
      coalesce(nullif(v_service->>'serviceName',''),'Servicio'),
      coalesce(nullif(v_service->>'canonicalServiceKey',''),'service-'||v_service_index),
      nullif(v_service->>'externalProvider',''),
      nullif(v_service->>'externalServiceCode',''),
      case when v_service->>'mappingStatus' in ('suggested','confirmed','unmapped') then v_service->>'mappingStatus' else 'confirmed' end,
      coalesce(nullif(v_service->>'sortOrder','')::integer,v_service_index)
    )
    returning id into v_service_id;

    if (v_service->>'mappingStatus')='confirmed'
       and nullif(v_service->>'externalProvider','') is not null
       and nullif(v_service->>'externalServiceCode','') is not null then
      insert into public.transport_service_mappings(
        owner_id,carrier_code,canonical_service_key,external_provider,external_service_code,
        confirmed_by,confirmed_at,updated_at
      )
      values(
        v_owner,
        coalesce(nullif(snapshot->>'carrierCode',''),v_document.carrier_code),
        coalesce(nullif(v_service->>'canonicalServiceKey',''),'service-'||v_service_index),
        v_service->>'externalProvider',v_service->>'externalServiceCode',
        auth.uid(),now(),now()
      )
      on conflict(owner_id,carrier_code,canonical_service_key) do update
      set external_provider=excluded.external_provider,
          external_service_code=excluded.external_service_code,
          confirmed_by=excluded.confirmed_by,
          confirmed_at=excluded.confirmed_at,
          updated_at=excluded.updated_at;
    end if;

    v_band_index:=0;
    for v_band in
      select value from jsonb_array_elements(coalesce(v_service->'bands','[]'::jsonb))
    loop
      insert into public.transport_tariff_bands(
        owner_id,service_id,country_code,zone_code,zone_name,min_weight_kg,max_weight_kg,
        base_price,extra_kg_price,notes,sort_order
      )
      values(
        v_owner,v_service_id,
        upper(coalesce(nullif(v_band->>'countryCode',''),'ES')),
        coalesce(nullif(v_band->>'zoneCode',''),'peninsular'),
        coalesce(nullif(v_band->>'zoneName',''),'Zona'),
        coalesce(nullif(v_band->>'minWeightKg','')::numeric,0),
        nullif(v_band->>'maxWeightKg','')::numeric,
        nullif(v_band->>'basePrice','')::numeric,
        nullif(v_band->>'extraKgPrice','')::numeric,
        nullif(v_band->>'notes',''),
        coalesce(nullif(v_band->>'sortOrder','')::integer,v_band_index)
      );
      v_band_index:=v_band_index+1;
    end loop;
    v_service_index:=v_service_index+1;
  end loop;

  return jsonb_build_object('ok',true,'effectiveFrom',apply_from);
end;
$function$
;

ALTER FUNCTION transport_tariff_save_active(uuid,date,jsonb) OWNER TO "postgres";

-- Remove every MFA-only public/private function created by #222.
-- At preflight there were 0 functions matching these names.
DO $cleanup_mfa_functions$
DECLARE f record;
BEGIN
 FOR f IN
   SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE (n.nspname='public' AND p.proname LIKE 'security_mfa_%')
      OR (n.nspname='private' AND p.proname LIKE 'mfa_%')
   ORDER BY CASE WHEN n.nspname='public' THEN 0 ELSE 1 END,p.proname
 LOOP
   EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE',f.nspname,f.proname,f.args);
 END LOOP;
END $cleanup_mfa_functions$;

DROP TABLE IF EXISTS private.mfa_recovery_peer_approvals;
DROP TABLE IF EXISTS private.mfa_function_manifest;
DROP TABLE IF EXISTS private.mfa_audit;
DROP TABLE IF EXISTS private.mfa_principals;
DROP TABLE IF EXISTS private.mfa_configuration;

DO $verify_mfa_removed$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE (n.nspname='public' AND p.proname LIKE 'security_mfa_%')
              OR (n.nspname='private' AND p.proname LIKE 'mfa_%'))
 THEN RAISE EXCEPTION 'MFA function cleanup incomplete';END IF;
 IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND
           policyname IN ('mfa_select_gate','mfa_insert_gate','mfa_update_gate','mfa_delete_gate'))
 THEN RAISE EXCEPTION 'MFA RLS cleanup incomplete';END IF;
END $verify_mfa_removed$;

NOTIFY pgrst,'reload schema';
COMMIT;

-- Compare current pg_policies and RLS flags with 20261018_pre_mfa_rls_triggers_views.json.

-- This script removes MFA-only SQL after frontend/Edge rollback. Validate role ACLs, 128 RLS policies, 75 flags and 77 triggers against the snapshots before resuming.
-- Do not restore anonymized buyer PII or change Amazon purge guard/tombstones.
