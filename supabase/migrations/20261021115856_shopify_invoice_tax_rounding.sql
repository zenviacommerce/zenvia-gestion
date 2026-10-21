-- Return a fiscal flag only. Sales users must not need access to buyer/order data.
create function private.sales_shopify_tax_included(p_invoice_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.sales_invoices i
  join public.fulfillment_orders o on o.id=i.source_fulfillment_order_id and o.owner_id=i.owner_id
  where i.id=p_invoice_id and i.owner_id=private.app_workspace_owner_id()
    and private.app_has_permission('sales') and i.document_kind='invoice'
    and o.source_channel='shopify' and o.raw_payload->'taxesIncluded'='true'::jsonb
 );
$$;
revoke all on function private.sales_shopify_tax_included(uuid) from public,anon;
grant execute on function private.sales_shopify_tax_included(uuid) to authenticated,service_role;
CREATE OR REPLACE FUNCTION private.sales_invoice_line_calculate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_gross numeric;
  v_net numeric;
  v_type text;
  v_document_kind text;
  v_fiscal_treatment text;
  v_shopify_tax_included boolean := false;
begin
  select invoice_type,document_kind,fiscal_treatment
    into v_type,v_document_kind,v_fiscal_treatment
  from public.sales_invoices where id=new.invoice_id;

  if v_type is null then raise exception 'Documento de venta no encontrado.'; end if;
  if v_type='standard' and new.unit_price < 0 then
    raise exception 'Un documento de venta ordinario no puede tener precios negativos.';
  end if;
  if v_document_kind='receipt'
     and v_fiscal_treatment in ('exempt','non_taxable','out_of_scope')
     and coalesce(new.tax_rate,0)<>0
  then
    raise exception 'Los recibos exentos o no sujetos deben tener IVA 0 %%.';
  end if;

  v_gross := new.quantity * new.unit_price;
  v_net := v_gross * (1 - new.discount_percent / 100);
  new.line_net := round(v_net,2);
  -- Shopify tax-inclusive prices calculate VAT before rounding the net base.
  -- Scope by source row AND owner; manual invoices, Amazon and receipts retain their rules.
  v_shopify_tax_included := private.sales_shopify_tax_included(new.invoice_id);
  new.tax_amount := round((case when v_shopify_tax_included then v_net else new.line_net end) * new.tax_rate / 100,2);
  new.line_total := new.line_net + new.tax_amount;
  return new;
end;
$function$;
