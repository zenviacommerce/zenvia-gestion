-- Shopify financial snapshots are independent of operational orders and labels.
create table public.shopify_analytics_orders (
 owner_id uuid not null references public.workspaces(id), integration_account_id uuid not null references public.integration_accounts(id) on delete cascade,
 order_id text not null,event_at timestamptz not null,updated_at timestamptz not null,currency text not null,
 gross_sales numeric not null,sales_vat numeric not null,discounts numeric not null,shipping_charged numeric not null,
 cancelled boolean not null default false,test boolean not null default false,financial_status text,requires_shipping boolean not null default true,
 primary key(integration_account_id,order_id));
create table public.shopify_analytics_items (
 owner_id uuid not null,integration_account_id uuid not null,order_id text not null,line_id text not null,currency text not null,
 seller_sku text not null,variant_id text,name text not null,image_url text,quantity numeric not null,gross_sales numeric not null,net_sales numeric not null,sales_vat numeric not null,
 primary key(integration_account_id,order_id,line_id),foreign key(integration_account_id,order_id) references public.shopify_analytics_orders on delete cascade);
create table public.shopify_analytics_refunds (
 owner_id uuid not null,integration_account_id uuid not null,order_id text not null,refund_id text not null,currency text not null,event_at timestamptz not null,
 gross_amount numeric not null,tax_amount numeric not null,net_amount numeric not null,
 primary key(integration_account_id,refund_id),foreign key(integration_account_id,order_id) references public.shopify_analytics_orders on delete cascade);
create table public.shopify_analytics_refund_items (
 owner_id uuid not null,integration_account_id uuid not null,order_id text not null,refund_id text not null,line_id text not null,seller_sku text not null,currency text not null,event_at timestamptz not null,
 quantity numeric not null,net_amount numeric not null,tax_amount numeric not null,
 primary key(integration_account_id,refund_id,line_id),foreign key(integration_account_id,refund_id) references public.shopify_analytics_refunds on delete cascade);
create table public.shopify_analytics_catalog (
 owner_id uuid not null,integration_account_id uuid not null references public.integration_accounts on delete cascade,variant_id text not null,seller_sku text not null,name text not null,image_url text,inventory_quantity integer,
 primary key(integration_account_id,variant_id));
create table public.shopify_analytics_sync_state (
 owner_id uuid not null,integration_account_id uuid primary key references public.integration_accounts on delete cascade,last_synced_at timestamptz,available_from timestamptz,
 inventory_available boolean not null default false,catalog_available boolean not null default false,history_limited boolean not null default true,status text not null default 'pending',error text);
create table public.shopify_product_mappings (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null,integration_account_id uuid not null references public.integration_accounts on delete cascade,seller_sku text not null,
 product_id uuid not null references public.products on delete cascade,consumption_factor numeric not null default 1 check(consumption_factor>0 and consumption_factor::text not in ('NaN','Infinity','-Infinity')),
 unique(integration_account_id,seller_sku,product_id));
create index shopify_orders_period_idx on public.shopify_analytics_orders(owner_id,event_at,integration_account_id);
create index shopify_items_sku_idx on public.shopify_analytics_items(owner_id,integration_account_id,seller_sku);
create index shopify_refunds_period_idx on public.shopify_analytics_refunds(owner_id,event_at,integration_account_id);
create index shopify_refund_items_period_idx on public.shopify_analytics_refund_items(owner_id,event_at,integration_account_id);
create index shopify_catalog_owner_idx on public.shopify_analytics_catalog(owner_id,integration_account_id);
create index shopify_mappings_owner_idx on public.shopify_product_mappings(owner_id,integration_account_id,seller_sku);
alter table public.shopify_analytics_orders enable row level security;
revoke all on public.shopify_analytics_orders from anon,authenticated;
grant select on public.shopify_analytics_orders to authenticated;
grant all on public.shopify_analytics_orders to service_role;
create policy shopify_read on public.shopify_analytics_orders for select to authenticated using(owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('shopify')));
alter table public.shopify_analytics_items enable row level security;
revoke all on public.shopify_analytics_items from anon,authenticated;
grant select on public.shopify_analytics_items to authenticated;
grant all on public.shopify_analytics_items to service_role;
create policy shopify_read on public.shopify_analytics_items for select to authenticated using(owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('shopify')));
alter table public.shopify_analytics_refunds enable row level security;
revoke all on public.shopify_analytics_refunds from anon,authenticated;
grant select on public.shopify_analytics_refunds to authenticated;
grant all on public.shopify_analytics_refunds to service_role;
create policy shopify_read on public.shopify_analytics_refunds for select to authenticated using(owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('shopify')));
alter table public.shopify_analytics_refund_items enable row level security;
revoke all on public.shopify_analytics_refund_items from anon,authenticated;
grant select on public.shopify_analytics_refund_items to authenticated;
grant all on public.shopify_analytics_refund_items to service_role;
create policy shopify_read on public.shopify_analytics_refund_items for select to authenticated using(owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('shopify')));
alter table public.shopify_analytics_catalog enable row level security;
revoke all on public.shopify_analytics_catalog from anon,authenticated;
grant select on public.shopify_analytics_catalog to authenticated;
grant all on public.shopify_analytics_catalog to service_role;
create policy shopify_read on public.shopify_analytics_catalog for select to authenticated using(owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('shopify')));
alter table public.shopify_analytics_sync_state enable row level security;
revoke all on public.shopify_analytics_sync_state from anon,authenticated;
grant select on public.shopify_analytics_sync_state to authenticated;
grant all on public.shopify_analytics_sync_state to service_role;
create policy shopify_read on public.shopify_analytics_sync_state for select to authenticated using(owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('shopify')));
alter table public.shopify_product_mappings enable row level security;
revoke all on public.shopify_product_mappings from anon,authenticated;
grant select,insert,delete on public.shopify_product_mappings to authenticated;
grant all on public.shopify_product_mappings to service_role;
create policy shopify_mapping_read on public.shopify_product_mappings for select to authenticated using(owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('shopify')));
create policy shopify_mapping_insert on public.shopify_product_mappings for insert to authenticated with check(owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('shopify')) and exists(select 1 from public.integration_accounts a where a.id=integration_account_id and a.owner_id=shopify_product_mappings.owner_id and a.provider='shopify'));
create policy shopify_mapping_delete on public.shopify_product_mappings for delete to authenticated using(owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('shopify')));
-- Definer RPCs intentionally read internal cost/shipping data for Shopify-only users.
-- Every public entry checks a real authenticated workspace member and permission.
create function private.shopify_analytics_owner() returns uuid language plpgsql stable security definer set search_path='' as $$
declare v uuid:=private.app_workspace_owner_id(); begin
 if auth.uid() is null or v is null or not private.app_has_permission('shopify') then raise exception 'No tienes permiso de Shopify.' using errcode='42501';end if;return v;end;$$;
revoke all on function private.shopify_analytics_owner() from public,anon;grant execute on function private.shopify_analytics_owner() to authenticated;
create function private.shopify_cost(owner uuid,store uuid,sku text,event_date date) returns table(cost numeric,missing bigint,mapping_count bigint) language sql stable security definer set search_path='' as $$
 select sum(h.normalized_unit_price*m.consumption_factor*private.amazon_rate_to_eur(h.currency,event_date)),count(*) filter(where h.id is null or private.amazon_rate_to_eur(h.currency,event_date) is null),count(*)
 from public.shopify_product_mappings m
 left join lateral(select ph.* from public.product_price_history ph where ph.owner_id=m.owner_id and ph.product_id=m.product_id and ph.price_date<=event_date order by ph.price_date desc,ph.created_at desc limit 1) h on true
 where m.owner_id=owner and m.integration_account_id=store and m.seller_sku=sku and owner=private.shopify_analytics_owner();$$;
revoke all on function private.shopify_cost(uuid,uuid,text,date) from public,anon;grant execute on function private.shopify_cost(uuid,uuid,text,date) to authenticated;
create function private.shopify_shipping(owner uuid,store uuid,remote_order text,event_date date) returns numeric language sql stable security definer set search_path='' as $$
 select f.shipping_cost_net_amount*private.amazon_rate_to_eur(coalesce(nullif(f.shipping_cost_currency,''),'EUR'),coalesce((f.shipping_cost_recorded_at at time zone 'Europe/Madrid')::date,event_date))
 from public.fulfillment_orders f where f.owner_id=owner and owner=private.shopify_analytics_owner() and f.source_channel='shopify'
 and f.source_integration_account_id=store and (f.order_id=remote_order or f.sendcloud_id='shopify:'||store::text||':'||remote_order)
 order by f.shipping_cost_recorded_at desc nulls last,f.last_synced_at desc nulls last limit 1;$$;
revoke all on function private.shopify_shipping(uuid,uuid,text,date) from public,anon;grant execute on function private.shopify_shipping(uuid,uuid,text,date) to authenticated;
create function public.shopify_analytics_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v uuid:=private.shopify_analytics_owner();result jsonb;begin
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.display_name,'domain',coalesce(a.config->>'shopDomain',a.external_account_id),'status',coalesce(s.status,'pending'),'lastSyncedAt',s.last_synced_at,'availableFrom',s.available_from,'inventoryAvailable',coalesce(s.inventory_available,false),'catalogAvailable',coalesce(s.catalog_available,false),'historyLimited',coalesce(s.history_limited,true),'error',s.error) order by a.display_name),'[]'::jsonb) into result
 from public.integration_accounts a left join public.shopify_analytics_sync_state s on s.integration_account_id=a.id and s.owner_id=v
 where a.owner_id=v and a.provider='shopify' and a.enabled and a.status<>'disabled' and a.credential_source<>'derived';
 return jsonb_build_object('stores',result,'connected',jsonb_array_length(result)>0);end;$$;
create function public.shopify_analytics_summary(from_date date,to_date date,integration_account_ids uuid[] default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v uuid:=private.shopify_analytics_owner(); result jsonb;begin
 if from_date is null or to_date is null or from_date>to_date then raise exception 'El período no es válido.';end if;
 with eligible as(select o.*,(o.event_at at time zone 'Europe/Madrid')::date d,private.amazon_rate_to_eur(o.currency,(o.event_at at time zone 'Europe/Madrid')::date) fx
 from public.shopify_analytics_orders o join public.integration_accounts a on a.id=o.integration_account_id and a.owner_id=v and a.enabled and a.status<>'disabled'
 where o.owner_id=v and not o.test and not o.cancelled and o.financial_status in ('PAID','PARTIALLY_PAID','PARTIALLY_REFUNDED','REFUNDED')
 and o.event_at>=(from_date::timestamp at time zone 'Europe/Madrid') and o.event_at<((to_date+1)::timestamp at time zone 'Europe/Madrid') and (integration_account_ids is null or o.integration_account_id=any(integration_account_ids))),
 sales as(select count(*) orders,coalesce(sum(gross_sales*fx),0) gross,coalesce(sum(sales_vat*fx),0) vat,coalesce(sum(discounts*fx),0) discounts,coalesce(sum(shipping_charged*fx),0) shipping_charged,count(*) filter(where fx is null) missing_fx from eligible),
 cost_rows as(select i.quantity,c.cost,c.missing,c.mapping_count from eligible o join public.shopify_analytics_items i on i.integration_account_id=o.integration_account_id and i.order_id=o.order_id and i.owner_id=v left join lateral private.shopify_cost(v,i.integration_account_id,i.seller_sku,o.d) c on true),
 costs as(select coalesce(sum(quantity),0) units,coalesce(sum(quantity*cost),0) product_cost,count(*) filter(where mapping_count=0) unmapped,count(*) filter(where mapping_count=0 or missing>0) missing from cost_rows),
 shipping_rows as(select case when not requires_shipping then 0 else private.shopify_shipping(v,integration_account_id,order_id,d) end cost from eligible),
 shipping as(select coalesce(sum(cost),0) cost,count(*) filter(where cost is null) missing from shipping_rows),
 refund_rows as(select r.*,private.amazon_rate_to_eur(r.currency,(r.event_at at time zone 'Europe/Madrid')::date) fx from public.shopify_analytics_refunds r join public.integration_accounts a on a.id=r.integration_account_id and a.owner_id=v and a.enabled and a.status<>'disabled'
 where r.owner_id=v and r.event_at>=(from_date::timestamp at time zone 'Europe/Madrid') and r.event_at<((to_date+1)::timestamp at time zone 'Europe/Madrid') and (integration_account_ids is null or r.integration_account_id=any(integration_account_ids))),
 refunds as(select count(*) n,coalesce(sum(gross_amount*fx),0) gross,coalesce(sum(net_amount*fx),0) net,count(*) filter(where fx is null) missing_fx from refund_rows)
 select jsonb_build_object('grossSales',round(s.gross,2),'salesVat',round(s.vat,2),'netSales',round(s.gross-s.vat,2),'orders',s.orders,'units',c.units,'refunds',round(r.net,2),'refundGross',round(r.gross,2),'refundCount',r.n,'discounts',round(s.discounts,2),'shippingCharged',round(s.shipping_charged,2),'productCost',round(c.product_cost,2),'shippingCost',round(sh.cost,2),'paymentFees',null,'adsCost',null,'netProfit',null,'profitBeforeAds',case when c.missing+sh.missing+s.missing_fx+r.missing_fx=0 then round(s.gross-s.vat-r.net-c.product_cost-sh.cost,2) end,'marginPct',null,'unmappedSkuCount',c.unmapped,'missingCostCount',c.missing+sh.missing,'missingFxCount',s.missing_fx+r.missing_fx,'profitComplete',false,'currency','EUR','availableFrom',(select min(st.available_from) from public.shopify_analytics_sync_state st where st.owner_id=v and (integration_account_ids is null or st.integration_account_id=any(integration_account_ids)))) into result from sales s cross join costs c cross join shipping sh cross join refunds r;
 return result;end;$$;
create function public.shopify_analytics_products(from_date date,to_date date,integration_account_ids uuid[] default null,search text default null,page integer default 1,page_size integer default 50) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v uuid:=private.shopify_analytics_owner(); result jsonb;v_page integer:=greatest(1,coalesce(page,1));v_size integer:=greatest(1,least(200,coalesce(page_size,50)));begin
 if from_date is null or to_date is null or from_date>to_date then raise exception 'El período no es válido.';end if;
 with stores as(select a.id,a.display_name from public.integration_accounts a where a.owner_id=v and a.provider='shopify' and a.enabled and a.status<>'disabled' and a.credential_source<>'derived' and (integration_account_ids is null or a.id=any(integration_account_ids))),
 eligible as(select o.*,(o.event_at at time zone 'Europe/Madrid')::date d,private.amazon_rate_to_eur(o.currency,(o.event_at at time zone 'Europe/Madrid')::date) fx from public.shopify_analytics_orders o join stores s on s.id=o.integration_account_id
 where o.owner_id=v and not o.test and not o.cancelled and o.financial_status in ('PAID','PARTIALLY_PAID','PARTIALLY_REFUNDED','REFUNDED') and o.event_at>=(from_date::timestamp at time zone 'Europe/Madrid') and o.event_at<((to_date+1)::timestamp at time zone 'Europe/Madrid')),
 item_rows as(select i.*,o.fx,c.cost,c.missing,c.mapping_count from eligible o join public.shopify_analytics_items i on i.integration_account_id=o.integration_account_id and i.order_id=o.order_id and i.owner_id=v left join lateral private.shopify_cost(v,i.integration_account_id,i.seller_sku,o.d) c on true),
 sales as(select integration_account_id,seller_sku,max(variant_id) variant_id,max(name) name,max(image_url) image_url,count(distinct order_id) orders,sum(quantity) units,sum(gross_sales*fx) gross,sum(net_sales*fx) net,sum(quantity*cost) cost,count(*) filter(where missing>0 or mapping_count=0 or fx is null) missing from item_rows group by integration_account_id,seller_sku),
 refunds as(select r.integration_account_id,r.seller_sku,sum(r.net_amount*private.amazon_rate_to_eur(r.currency,(r.event_at at time zone 'Europe/Madrid')::date)) net,count(*) filter(where private.amazon_rate_to_eur(r.currency,(r.event_at at time zone 'Europe/Madrid')::date) is null) missing from public.shopify_analytics_refund_items r join stores s on s.id=r.integration_account_id where r.owner_id=v and r.event_at>=(from_date::timestamp at time zone 'Europe/Madrid') and r.event_at<((to_date+1)::timestamp at time zone 'Europe/Madrid') group by r.integration_account_id,r.seller_sku),
 catalog as(select c.integration_account_id,c.seller_sku,max(c.variant_id) variant_id,max(c.name) name,max(c.image_url) image_url,sum(c.inventory_quantity)::integer inventory from public.shopify_analytics_catalog c join stores s on s.id=c.integration_account_id where c.owner_id=v group by c.integration_account_id,c.seller_sku),
 keys as(select integration_account_id,seller_sku from sales union select integration_account_id,seller_sku from catalog union select integration_account_id,seller_sku from refunds),
 mappings as(select m.integration_account_id,m.seller_sku,(array_agg(p.id order by p.name))[1] product_id,string_agg(p.name,' + ' order by p.name) name,(array_agg(m.consumption_factor order by p.name))[1] factor from public.shopify_product_mappings m join public.products p on p.id=m.product_id and p.owner_id=v where m.owner_id=v group by m.integration_account_id,m.seller_sku),
 rows as(select k.*,st.display_name,coalesce(c.variant_id,s.variant_id) variant_id,coalesce(c.name,s.name,k.seller_sku) name,coalesce(c.image_url,s.image_url) image_url,coalesce(s.orders,0) orders,coalesce(s.units,0) units,coalesce(s.gross,0) gross,coalesce(s.net,0) net,coalesce(r.net,0) refunds,coalesce(s.cost,0) cost,coalesce(s.missing,0)+coalesce(r.missing,0) missing,c.inventory,m.product_id,m.name mapping_name,coalesce(m.factor,1) factor from keys k join stores st on st.id=k.integration_account_id left join sales s using(integration_account_id,seller_sku) left join catalog c using(integration_account_id,seller_sku) left join refunds r using(integration_account_id,seller_sku) left join mappings m using(integration_account_id,seller_sku)
 where coalesce(search,'')='' or k.seller_sku ilike '%'||search||'%' or coalesce(c.name,s.name,'') ilike '%'||search||'%'),
 selected as(select * from rows order by gross desc,seller_sku,integration_account_id limit v_size offset (v_page-1)*v_size)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',integration_account_id::text||':'||seller_sku,'storeId',integration_account_id,'storeName',display_name,'sku',seller_sku,'variantId',variant_id,'name',name,'imageUrl',image_url,'mappingProductId',product_id,'mappingProductName',mapping_name,'consumptionFactor',factor,'orders',orders,'units',units,'grossSales',round(gross,2),'netSales',round(net,2),'refunds',round(refunds,2),'productCost',round(cost,2),'profitBeforeAds',null,'profitComplete',false,'currency','EUR','inventoryQuantity',inventory) order by gross desc,seller_sku,integration_account_id) from selected),'[]'::jsonb),'total',(select count(*) from rows),'page',v_page,'pageSize',v_size) into result;
 return result;end;$$;
create function public.shopify_get_product_mappings(integration_account_id uuid,seller_sku text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v uuid:=private.shopify_analytics_owner();result jsonb;begin
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'productId',p.id,'productName',p.name,'productSku',p.sku,'unitCost',p.last_cost,'costUnit',p.cost_unit,'consumptionFactor',m.consumption_factor,'supplierName',s.name) order by p.name),'[]'::jsonb) into result from public.shopify_product_mappings m join public.products p on p.id=m.product_id and p.owner_id=v left join public.suppliers s on s.id=p.last_supplier_id and s.owner_id=v where m.owner_id=v and m.integration_account_id=shopify_get_product_mappings.integration_account_id and m.seller_sku=trim(shopify_get_product_mappings.seller_sku);return result;end;$$;
create function public.shopify_product_options(search text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v uuid:=private.shopify_analytics_owner();result jsonb;begin
 select coalesce(jsonb_agg(row),'[]'::jsonb) into result from(select p.id,p.name,p.sku,s.name as "supplierName",p.last_cost as "unitCost",p.cost_unit as "costUnit" from public.products p left join public.suppliers s on s.id=p.last_supplier_id and s.owner_id=v where p.owner_id=v and (coalesce(search,'')='' or p.name ilike '%'||search||'%' or p.sku ilike '%'||search||'%') order by p.name limit 500) row;return result;end;$$;
create function public.shopify_add_product_mapping(integration_account_id uuid,seller_sku text,product_id uuid,consumption_factor numeric default 1) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare v uuid:=private.shopify_analytics_owner();begin
 if coalesce(trim(seller_sku),'')='' or consumption_factor is null or consumption_factor<=0 or consumption_factor::text in ('NaN','Infinity','-Infinity') then raise exception 'Indica un SKU y un factor de consumo válido.';end if;
 if not exists(select 1 from public.integration_accounts a where a.id=integration_account_id and a.owner_id=v and a.provider='shopify') or not exists(select 1 from public.products p where p.id=product_id and p.owner_id=v) then raise exception 'Producto o tienda no permitido.' using errcode='42501';end if;
 insert into public.shopify_product_mappings(owner_id,integration_account_id,seller_sku,product_id,consumption_factor) values(v,integration_account_id,trim(seller_sku),product_id,consumption_factor) on conflict (integration_account_id,seller_sku,product_id) do update set consumption_factor=excluded.consumption_factor;
 return jsonb_build_object('ok',true);end;$$;
create function public.shopify_delete_product_mapping_item(integration_account_id uuid,seller_sku text,product_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v uuid:=private.shopify_analytics_owner();begin delete from public.shopify_product_mappings m where m.owner_id=v and m.integration_account_id=shopify_delete_product_mapping_item.integration_account_id and m.seller_sku=trim(shopify_delete_product_mapping_item.seller_sku) and m.product_id=shopify_delete_product_mapping_item.product_id;return jsonb_build_object('ok',true);end;$$;
create function public.shopify_create_product_and_mapping(integration_account_id uuid,seller_sku text,product_name text,internal_sku text,base_unit text default 'ud',unit_cost numeric default null,cost_from date default null,consumption_factor numeric default 1) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v uuid:=private.shopify_analytics_owner();p uuid;today date:=(now() at time zone 'Europe/Madrid')::date;begin
 if not private.app_has_permission('products') then raise exception 'Necesitas permiso de Productos para crear un producto.' using errcode='42501';end if;
 if coalesce(trim(product_name),'')='' or coalesce(trim(internal_sku),'')='' then raise exception 'Indica el nombre y el SKU del producto.';end if;
 if unit_cost is not null and (unit_cost<0 or unit_cost::text in ('NaN','Infinity','-Infinity') or coalesce(cost_from,today)>today) then raise exception 'El coste y la fecha no son válidos.';end if;
 if exists(select 1 from public.products pr where pr.owner_id=v and pr.sku=trim(internal_sku)) then raise exception 'Ya existe un producto con ese SKU.' using errcode='23505';end if;
 insert into public.products(owner_id,name,sku,base_unit,last_cost,cost_unit) values(v,trim(product_name),trim(internal_sku),coalesce(nullif(trim(base_unit),''),'ud'),unit_cost,case when unit_cost is not null then coalesce(nullif(trim(base_unit),''),'ud') end) returning id into p;
 if unit_cost is not null then insert into public.product_price_history(owner_id,product_id,price_date,purchase_unit_price,normalized_unit_price,base_unit,currency) values(v,p,coalesce(cost_from,today),unit_cost,unit_cost,coalesce(nullif(trim(base_unit),''),'ud'),'EUR');end if;
 perform public.shopify_add_product_mapping(integration_account_id,seller_sku,p,consumption_factor);return jsonb_build_object('ok',true,'created',true,'productId',p);end;$$;
alter table public.app_users drop constraint if exists app_users_permissions_check;
alter table public.app_users add constraint app_users_permissions_check check(permissions<@array['dashboard','sales','orders','invoices','clients','products','suppliers','amazon','support','shopify']::text[]);

revoke all on function public.shopify_analytics_status() from public,anon;grant execute on function public.shopify_analytics_status() to authenticated;

revoke all on function public.shopify_analytics_summary(date,date,uuid[]) from public,anon;grant execute on function public.shopify_analytics_summary(date,date,uuid[]) to authenticated;

revoke all on function public.shopify_analytics_products(date,date,uuid[],text,integer,integer) from public,anon;grant execute on function public.shopify_analytics_products(date,date,uuid[],text,integer,integer) to authenticated;

revoke all on function public.shopify_get_product_mappings(uuid,text) from public,anon;grant execute on function public.shopify_get_product_mappings(uuid,text) to authenticated;

revoke all on function public.shopify_product_options(text) from public,anon;grant execute on function public.shopify_product_options(text) to authenticated;

revoke all on function public.shopify_add_product_mapping(uuid,text,uuid,numeric) from public,anon;grant execute on function public.shopify_add_product_mapping(uuid,text,uuid,numeric) to authenticated;

revoke all on function public.shopify_delete_product_mapping_item(uuid,text,uuid) from public,anon;grant execute on function public.shopify_delete_product_mapping_item(uuid,text,uuid) to authenticated;

revoke all on function public.shopify_create_product_and_mapping(uuid,text,text,text,text,numeric,date,numeric) from public,anon;grant execute on function public.shopify_create_product_and_mapping(uuid,text,text,text,text,numeric,date,numeric) to authenticated;
