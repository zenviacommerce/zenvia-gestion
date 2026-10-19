CREATE OR REPLACE FUNCTION private.mfa_impl_3790982(integration_account_id uuid, seller_sku text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v uuid:=private.shopify_analytics_owner();result jsonb;begin
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'productId',p.id,'productName',p.name,'productSku',p.sku,'unitCost',p.last_cost,'costUnit',p.cost_unit,'consumptionFactor',m.consumption_factor,'supplierName',s.name) order by p.name),'[]'::jsonb) into result from public.shopify_product_mappings m join public.products p on p.id=m.product_id and p.owner_id=v left join public.suppliers s on s.id=p.last_supplier_id and s.owner_id=v where m.owner_id=v and m.integration_account_id=shopify_get_product_mappings.integration_account_id and m.seller_sku=trim(shopify_get_product_mappings.seller_sku);return result;end;$function$

