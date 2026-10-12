-- One durable source identity per workspace, Shopify account and remote order.
alter table public.sales_invoices add column if not exists source_order_key text;
alter table public.sales_invoices add column if not exists source_fulfillment_order_id uuid references public.fulfillment_orders(id) on delete set null;
create unique index if not exists sales_invoices_source_order_key_idx on public.sales_invoices(owner_id,source_order_key) where source_order_key is not null;
create or replace function public.save_shopify_order_invoice(p_order_id uuid,p_client jsonb,p_series_id uuid,p_issue_date date,p_lines jsonb,p_issue boolean default false)
returns uuid language plpgsql security invoker set search_path='' as $$
declare
  v_owner uuid:=private.app_workspace_owner_id();
  v_order public.fulfillment_orders%rowtype;
  v_invoice public.sales_invoices%rowtype;
  v_key text; v_client_id uuid; v_line jsonb; v_position integer:=0;
begin
  if auth.uid() is null or not private.app_has_permission('sales') or not private.app_has_permission('orders') then raise exception 'Sin permiso para facturar pedidos.'; end if;
  select * into v_order from public.fulfillment_orders where id=p_order_id and owner_id=v_owner;
  if v_order.id is null or v_order.source_channel<>'shopify' or v_order.source_integration_account_id is null or v_order.order_id is null then raise exception 'Pedido directo de Shopify no encontrado.'; end if;
  v_key:='shopify:'||v_order.source_integration_account_id::text||':'||v_order.order_id;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text||v_key,0));
  select * into v_invoice from public.sales_invoices where owner_id=v_owner and source_order_key=v_key for update;
  if v_invoice.id is not null and v_invoice.status<>'draft' then return v_invoice.id; end if;
  if coalesce(v_order.raw_payload->>'cancelledAt','')<>'' or coalesce(v_order.raw_payload->>'displayFinancialStatus','') ~ 'REFUNDED|VOIDED' then raise exception 'Revisa cancelaciones o reembolsos antes de facturar.'; end if;
  if jsonb_typeof(v_order.raw_payload->'taxesIncluded') is distinct from 'boolean' then raise exception 'Actualizar pedidos: faltan datos fiscales de Shopify.'; end if;
  if coalesce((v_order.raw_payload#>>'{lineItems,pageInfo,hasNextPage}')::boolean,false) or coalesce((v_order.raw_payload#>>'{shippingLines,pageInfo,hasNextPage}')::boolean,false) then raise exception 'El desglose de líneas de Shopify está incompleto.'; end if;
  if coalesce(trim(p_client->>'name'),'')='' or coalesce(trim(p_client->>'addressLine1'),'')='' or coalesce(trim(p_client->>'postalCode'),'')='' or coalesce(trim(p_client->>'city'),'')='' or coalesce(p_client->>'countryCode','') !~ '^[A-Z]{2}$' then raise exception 'Completa los datos de facturación del cliente.'; end if;
  if p_issue_date is null or not exists(select 1 from public.sales_invoice_series where id=p_series_id and owner_id=v_owner and active and kind='standard' and year=extract(year from p_issue_date)::int) then raise exception 'La serie no corresponde a la fecha de la factura.'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)=0 then raise exception 'La factura no tiene líneas.'; end if;
  select id into v_client_id from public.clients where owner_id=v_owner and active
    and name=trim(p_client->>'name') and coalesce(tax_id,'')=coalesce(trim(p_client->>'taxId'),'')
    and coalesce(email,'')=coalesce(trim(p_client->>'email'),'')
    and coalesce(address_line1,'')=coalesce(p_client->>'addressLine1','')
    and coalesce(address_line2,'')=coalesce(p_client->>'addressLine2','')
    and coalesce(postal_code,'')=coalesce(p_client->>'postalCode','')
    and coalesce(city,'')=coalesce(p_client->>'city','')
    and coalesce(province,'')=coalesce(p_client->>'province','')
    and country_code=p_client->>'countryCode' limit 1;
  if v_client_id is null then
    insert into public.clients(owner_id,name,tax_id,email,phone,address_line1,address_line2,postal_code,city,province,country_code,notes)
    values(v_owner,trim(p_client->>'name'),nullif(trim(p_client->>'taxId'),''),nullif(trim(p_client->>'email'),''),nullif(p_client->>'phone',''),p_client->>'addressLine1',p_client->>'addressLine2',p_client->>'postalCode',p_client->>'city',p_client->>'province',p_client->>'countryCode','Cliente del pedido '||v_order.order_number) returning id into v_client_id;
  end if;
  if v_invoice.id is null then
    insert into public.sales_invoices(owner_id,client_id,series_id,issue_date,operation_date,currency,notes,source_order_key,source_fulfillment_order_id)
    values(v_owner,v_client_id,p_series_id,p_issue_date,v_order.order_created_at::date,coalesce(v_order.currency,'EUR'),'Pedido Shopify '||coalesce(v_order.order_number,v_order.order_id),v_key,p_order_id) returning * into v_invoice;
  else
    update public.sales_invoices set client_id=v_client_id,series_id=p_series_id,issue_date=p_issue_date where id=v_invoice.id;
    delete from public.sales_invoice_lines where invoice_id=v_invoice.id;
  end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_position:=v_position+1;
    insert into public.sales_invoice_lines(owner_id,invoice_id,position,description,quantity,unit,unit_price,discount_percent,tax_rate)
    values(v_owner,v_invoice.id,v_position,v_line->>'description',(v_line->>'quantity')::numeric,coalesce(v_line->>'unit','ud'),(v_line->>'unitPrice')::numeric,coalesce((v_line->>'discountPercent')::numeric,0),(v_line->>'taxRate')::numeric);
  end loop;
  select * into v_invoice from public.sales_invoices where id=v_invoice.id;
  if v_order.total_amount is null or v_invoice.total_amount<>round(v_order.total_amount,2) then raise exception 'El total de la factura no cuadra con Shopify.'; end if;
  if p_issue then perform public.issue_sales_invoice(v_invoice.id); end if;
  return v_invoice.id;
end;
$$;
revoke all on function public.save_shopify_order_invoice(uuid,jsonb,uuid,date,jsonb,boolean) from public,anon;
grant execute on function public.save_shopify_order_invoice(uuid,jsonb,uuid,date,jsonb,boolean) to authenticated;
notify pgrst,'reload schema';
