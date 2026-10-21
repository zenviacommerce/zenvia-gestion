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
  new.tax_amount := round(new.line_net * new.tax_rate / 100,2);
  new.line_total := new.line_net + new.tax_amount;
  return new;
end;
$function$;
