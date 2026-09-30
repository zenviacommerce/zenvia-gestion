-- Multi-product Amazon mappings allow several products for the same SKU.
-- Keep the automatic single-match helper compatible with the four-column uniqueness rule.

create or replace function private.amazon_auto_map_order_item()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare v_product uuid; v_matches integer;
begin
  if nullif(trim(new.seller_sku),'') is null then return new; end if;

  select min(p.id::text)::uuid,count(*)::integer into v_product,v_matches
  from public.products p
  where p.owner_id=new.owner_id
    and p.sku=new.seller_sku
    and coalesce(p.active,true);

  if v_matches=1 then
    insert into public.amazon_product_mappings(
      owner_id,amazon_account_id,seller_sku,product_id,consumption_factor,mapping_source,created_at,updated_at
    )
    values(new.owner_id,new.amazon_account_id,new.seller_sku,v_product,1,'automatic',now(),now())
    on conflict(owner_id,amazon_account_id,seller_sku,product_id) do nothing;
  end if;

  return new;
end;
$$;
