-- Create the internal product, optional cost history and Amazon mapping atomically.
create or replace function public.amazon_create_product_and_mapping(
  seller_sku text, product_name text, internal_sku text,
  base_unit text default 'ud', unit_cost numeric default null,
  cost_from date default null, consumption_factor numeric default 1
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_owner uuid:=private.app_workspace_owner_id();
  v_product uuid;
  v_today date:=(now() at time zone private.amazon_analytics_timezone())::date;
  v_result jsonb;
begin
  if auth.uid() is null or v_owner is null or not private.app_has_permission('amazon') or not private.app_has_permission('products') then
    raise exception 'Necesitas permisos de Amazon y Productos para crear un producto.' using errcode='42501';
  end if;
  if coalesce(trim(seller_sku),'')='' or coalesce(trim(product_name),'')='' or coalesce(trim(internal_sku),'')='' then
    raise exception 'Indica el nombre y el SKU del producto.';
  end if;
  if consumption_factor is null or consumption_factor<=0 or consumption_factor::text in ('NaN','Infinity','-Infinity') then
    raise exception 'El factor de consumo debe ser mayor que cero.';
  end if;
  if unit_cost is not null and (unit_cost<0 or unit_cost::text in ('NaN','Infinity','-Infinity')) then
    raise exception 'El coste debe ser un número igual o superior a cero.';
  end if;
  if unit_cost is not null and coalesce(cost_from,v_today)>v_today then
    raise exception 'La fecha del coste no puede ser futura.';
  end if;
  if exists(select 1 from public.products p where p.owner_id=v_owner and p.sku=trim(internal_sku)) then
    raise exception 'Ya existe un producto con ese SKU. Selecciónalo en Vincular existente.' using errcode='23505';
  end if;
  insert into public.products(owner_id,name,sku,base_unit,last_cost,cost_unit)
  values(v_owner,trim(product_name),trim(internal_sku),coalesce(nullif(trim(base_unit),''),'ud'),unit_cost,
    case when unit_cost is not null then coalesce(nullif(trim(base_unit),''),'ud') end)
  returning id into v_product;
  if unit_cost is not null then
    insert into public.product_price_history(owner_id,product_id,price_date,purchase_unit_price,normalized_unit_price,base_unit,currency)
    values(v_owner,v_product,coalesce(cost_from,v_today),unit_cost,unit_cost,coalesce(nullif(trim(base_unit),''),'ud'),'EUR');
  end if;
  v_result:=public.amazon_add_product_mapping(trim(seller_sku),v_product,consumption_factor);
  return v_result||jsonb_build_object('created',true,'productId',v_product);
end;
$$;
revoke all on function public.amazon_create_product_and_mapping(text,text,text,text,numeric,date,numeric) from public,anon;
grant execute on function public.amazon_create_product_and_mapping(text,text,text,text,numeric,date,numeric) to authenticated;
