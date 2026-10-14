-- Rollback-only regression against the actual RPCs and workspace calendar.
begin;
insert into public.shopify_analytics_orders(owner_id,integration_account_id,order_id,event_at,updated_at,currency,gross_sales,sales_vat,discounts,shipping_charged,cancelled,test,financial_status,requires_shipping)
select '7461b2b7-f383-460d-b1c7-6ccbb52e42b2','5ae60ea5-e45c-435a-ae72-96a9043cd0c0',id,'2099-10-14T12:00:00Z',now(),'EUR',gross,vat,0,0,cancelled,test,'PAID',true
from (values('__analytics_reg_sale',121,21,false,false),('__analytics_reg_test',121,21,false,true),('__analytics_reg_cancelled',242,42,true,false)) f(id,gross,vat,cancelled,test);
insert into public.shopify_analytics_items(owner_id,integration_account_id,order_id,line_id,currency,seller_sku,name,quantity,gross_sales,net_sales,sales_vat)
select owner_id,integration_account_id,order_id,order_id||':line','EUR','__analytics_reg_unknown','Fixture',1,gross_sales,gross_sales-sales_vat,sales_vat from public.shopify_analytics_orders where order_id like '__analytics_reg_%';
insert into public.shopify_analytics_refunds(owner_id,integration_account_id,order_id,refund_id,currency,event_at,gross_amount,tax_amount,net_amount)
select owner_id,integration_account_id,order_id,order_id||':refund','EUR',event_at,121,21,100 from public.shopify_analytics_orders where order_id in ('__analytics_reg_test','__analytics_reg_cancelled');
select set_config('request.jwt.claim.sub','7461b2b7-f383-460d-b1c7-6ccbb52e42b2',true);
select set_config('request.jwt.claims','{"sub":"7461b2b7-f383-460d-b1c7-6ccbb52e42b2","role":"authenticated"}',true);
set local role authenticated;
do $$
declare s jsonb;p jsonb; begin
 s:=public.shopify_analytics_summary('2099-10-14','2099-10-14',array['5ae60ea5-e45c-435a-ae72-96a9043cd0c0'::uuid]);
 if (s->>'orders')::int<>2 or (s->>'grossSales')::numeric<>363 then raise exception 'Paid cancelled sales must be retained, test sales excluded: %',s;end if;
 if (s->>'refundCount')::int<>1 or (s->>'refundGross')::numeric<>121 then raise exception 'Test refunds must be excluded: %',s;end if;
 if s->'productCost'<>'null'::jsonb or s->'shippingCost'<>'null'::jsonb or s->'netProfit'<>'null'::jsonb then raise exception 'Unknown costs must be null: %',s;end if;
 if public.shopify_analytics_summary('2099-10-14','2099-10-14','{}'::uuid[])<>public.shopify_analytics_summary('2099-10-14','2099-10-14',null) then raise exception 'Empty store selection must mean all stores';end if;
end $$;
do $$declare created jsonb;begin
 created:=public.shopify_create_product_and_mapping('83804406-d991-44dd-87d0-9c5bbb48f516','__reg_create_sku','Regression product','__reg_create_internal','ud',2,'2026-10-01',1);
 if not (created->>'ok')::boolean or not exists(select 1 from public.shopify_product_mappings where product_id=(created->>'productId')::uuid and seller_sku='__reg_create_sku') then raise exception 'Create and link was not atomic';end if;
 begin perform public.shopify_create_product_and_mapping('83804406-d991-44dd-87d0-9c5bbb48f516','__reg_create_other','Duplicate','__reg_create_internal','ud',2,'2026-10-01',1);raise exception 'Duplicate internal SKU accepted';exception when unique_violation then null;end;
 begin insert into public.shopify_product_mappings(owner_id,integration_account_id,seller_sku,product_id) values('7461b2b7-f383-460d-b1c7-6ccbb52e42b2','83804406-d991-44dd-87d0-9c5bbb48f516','__reg_invalid_product',gen_random_uuid());raise exception 'Direct mapping accepted unowned product';exception when insufficient_privilege then null;end;
end $$;
reset role;
update public.app_users set role='user',permissions=array['shopify']::text[] where user_id='7461b2b7-f383-460d-b1c7-6ccbb52e42b2';
set local role authenticated;
do $$begin
 perform public.shopify_product_options('__reg_create_internal');
 begin perform public.shopify_create_product_and_mapping('83804406-d991-44dd-87d0-9c5bbb48f516','__reg_denied','Denied','__reg_denied');raise exception 'Shopify-only user created a product';exception when insufficient_privilege then null;end;
end $$;
reset role;
insert into public.shopify_analytics_orders(owner_id,integration_account_id,order_id,event_at,updated_at,currency,gross_sales,sales_vat,discounts,shipping_charged,financial_status,requires_shipping)
values('7461b2b7-f383-460d-b1c7-6ccbb52e42b2','5ae60ea5-e45c-435a-ae72-96a9043cd0c0','__analytics_reg_fx','2099-10-14T12:00:00Z',now(),'ZZZ',100,0,0,0,'PAID',false);
insert into public.shopify_analytics_catalog(owner_id,integration_account_id,variant_id,seller_sku,name,inventory_quantity)
values('7461b2b7-f383-460d-b1c7-6ccbb52e42b2','5ae60ea5-e45c-435a-ae72-96a9043cd0c0','__reg_inventory_known','__reg_inventory','Inventory',5),('7461b2b7-f383-460d-b1c7-6ccbb52e42b2','5ae60ea5-e45c-435a-ae72-96a9043cd0c0','__reg_inventory_unknown','__reg_inventory','Inventory',null);
set local role authenticated;
do $$
declare s jsonb;p jsonb;begin
 s:=public.shopify_analytics_summary('2099-10-14','2099-10-14',null);
 if s->'grossSales'<>'null'::jsonb or (s->>'missingFxCount')::int<>1 then raise exception 'Unknown FX must make sales unavailable: %',s;end if;
 p:=public.shopify_analytics_products('2099-10-14','2099-10-14',null,'__reg_inventory',1,50,'inventory_quantity','desc',true);
 if (p->'items'->0->'inventoryQuantity')<>'null'::jsonb then raise exception 'Partial known inventory must be unavailable: %',p;end if;
end $$;
rollback;
