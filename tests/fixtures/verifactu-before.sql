-- Roles are cluster-scoped; two disposable database gates can share one server.
DO $roles$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS;END IF;
END $roles$;
CREATE SCHEMA auth;CREATE SCHEMA private;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;
CREATE FUNCTION private.app_workspace_owner_id() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.owner',true),'')::uuid$$;
CREATE FUNCTION private.app_has_permission(text) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT coalesce(current_setting('test.sales',true),'yes')='yes'$$;
CREATE FUNCTION private.mfa_allowed() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT coalesce(current_setting('test.mfa',true),'yes')='yes'$$;
CREATE FUNCTION public.security_mfa_assert(boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF NOT private.mfa_allowed() THEN RAISE EXCEPTION 'MFA_REQUIRED';END IF;END$$;
CREATE TABLE public.workspaces(id uuid PRIMARY KEY);
CREATE TABLE private.mfa_function_manifest(signature text PRIMARY KEY,function_oid oid,implementation regprocedure,original_definition text,wrapper_hash text);
CREATE TABLE public.fulfillment_orders(id uuid PRIMARY KEY,owner_id uuid,source_channel text,raw_payload jsonb);
CREATE TABLE public.app_settings(owner_id uuid,config jsonb);
CREATE TABLE public.products(id uuid PRIMARY KEY,owner_id uuid);
CREATE TABLE public.clients("id" uuid DEFAULT gen_random_uuid() NOT NULL,"owner_id" uuid NOT NULL,"name" text NOT NULL,"tax_id" text,"email" text,"phone" text,"address_line1" text,"address_line2" text,"postal_code" text,"city" text,"province" text,"country_code" text DEFAULT 'ES'::text NOT NULL,"payment_terms_days" integer DEFAULT 0 NOT NULL,"notes" text,"active" boolean DEFAULT true NOT NULL,"created_at" timestamptz DEFAULT now() NOT NULL,"updated_at" timestamptz DEFAULT now() NOT NULL,"default_vat_rate" numeric,"default_payment_method" text);
ALTER TABLE public.clients ADD PRIMARY KEY(id);
CREATE TABLE public.business_settings("owner_id" uuid NOT NULL,"legal_name" text DEFAULT 'ZENVIA COMMERCE SL'::text NOT NULL,"trade_name" text,"tax_id" text,"address_line1" text,"address_line2" text,"postal_code" text,"city" text,"province" text,"country_code" text DEFAULT 'ES'::text NOT NULL,"email" text,"phone" text,"iban" text,"invoice_footer" text,"created_at" timestamptz DEFAULT now() NOT NULL,"updated_at" timestamptz DEFAULT now() NOT NULL,"website" text);
CREATE TABLE public.business_tax_registrations("id" uuid DEFAULT gen_random_uuid() NOT NULL,"owner_id" uuid NOT NULL,"label" text NOT NULL,"country_code" text DEFAULT 'ES'::text NOT NULL,"vat_number" text NOT NULL,"fiscal_name" text,"address_text" text,"is_default" boolean DEFAULT false NOT NULL,"active" boolean DEFAULT true NOT NULL,"notes" text,"created_at" timestamptz DEFAULT now() NOT NULL,"updated_at" timestamptz DEFAULT now() NOT NULL);
ALTER TABLE public.business_tax_registrations ADD PRIMARY KEY(id);
CREATE TABLE public.sales_invoice_series("id" uuid DEFAULT gen_random_uuid() NOT NULL,"owner_id" uuid NOT NULL,"code" text NOT NULL,"name" text NOT NULL,"kind" text DEFAULT 'standard'::text NOT NULL,"year" integer NOT NULL,"prefix" text NOT NULL,"next_number" integer DEFAULT 1 NOT NULL,"padding" smallint DEFAULT 4 NOT NULL,"active" boolean DEFAULT true NOT NULL,"created_at" timestamptz DEFAULT now() NOT NULL,"updated_at" timestamptz DEFAULT now() NOT NULL,"default_bank_account_id" uuid);
ALTER TABLE public.sales_invoice_series ADD PRIMARY KEY(id);
CREATE TABLE public.sales_invoices("id" uuid DEFAULT gen_random_uuid() NOT NULL,"owner_id" uuid NOT NULL,"client_id" uuid NOT NULL,"series_id" uuid NOT NULL,"invoice_type" text DEFAULT 'standard'::text NOT NULL,"rectifies_invoice_id" uuid,"invoice_number" text,"status" text DEFAULT 'draft'::text NOT NULL,"issue_date" date DEFAULT CURRENT_DATE NOT NULL,"operation_date" date,"due_date" date,"currency" text DEFAULT 'EUR'::text NOT NULL,"subtotal" numeric DEFAULT 0 NOT NULL,"discount_amount" numeric DEFAULT 0 NOT NULL,"tax_amount" numeric DEFAULT 0 NOT NULL,"total_amount" numeric DEFAULT 0 NOT NULL,"payment_method" text,"notes" text,"client_name" text,"client_tax_id" text,"client_email" text,"client_address" text,"issuer_name" text,"issuer_tax_id" text,"issuer_email" text,"issuer_address" text,"issued_at" timestamptz,"sent_at" timestamptz,"paid_at" timestamptz,"created_at" timestamptz DEFAULT now() NOT NULL,"updated_at" timestamptz DEFAULT now() NOT NULL,"reserved_number" integer,"tax_registration_id" uuid,"client_phone" text,"issuer_phone" text,"issuer_tax_country_code" text,"issuer_tax_registration_label" text,"document_kind" text DEFAULT 'invoice'::text NOT NULL,"fiscal_treatment" text DEFAULT 'taxable'::text NOT NULL,"fiscal_reason" text,"source_order_key" text,"source_fulfillment_order_id" uuid,"bank_account_id" uuid,"bank_account_snapshot" jsonb,"bank_snapshot_source" text,"bank_snapshot_at" timestamptz,"payment_method_id" text);
ALTER TABLE public.sales_invoices ADD PRIMARY KEY(id);
CREATE TABLE public.sales_invoice_lines("id" uuid DEFAULT gen_random_uuid() NOT NULL,"owner_id" uuid NOT NULL,"invoice_id" uuid NOT NULL,"product_id" uuid,"position" integer DEFAULT 1 NOT NULL,"description" text NOT NULL,"quantity" numeric DEFAULT 1 NOT NULL,"unit" text DEFAULT 'ud'::text NOT NULL,"unit_price" numeric DEFAULT 0 NOT NULL,"discount_percent" numeric DEFAULT 0 NOT NULL,"tax_rate" numeric DEFAULT 21 NOT NULL,"line_net" numeric DEFAULT 0 NOT NULL,"tax_amount" numeric DEFAULT 0 NOT NULL,"line_total" numeric DEFAULT 0 NOT NULL,"created_at" timestamptz DEFAULT now() NOT NULL,"updated_at" timestamptz DEFAULT now() NOT NULL);
ALTER TABLE public.sales_invoice_lines ADD PRIMARY KEY(id);
CREATE TABLE public.sales_invoice_released_numbers("owner_id" uuid NOT NULL,"series_id" uuid NOT NULL,"number" integer NOT NULL,"created_at" timestamptz DEFAULT now() NOT NULL);
CREATE TABLE public.sales_payments("id" uuid DEFAULT gen_random_uuid() NOT NULL,"owner_id" uuid NOT NULL,"invoice_id" uuid NOT NULL,"payment_date" date DEFAULT CURRENT_DATE NOT NULL,"amount" numeric NOT NULL,"method" text,"reference" text,"notes" text,"created_at" timestamptz DEFAULT now() NOT NULL);
ALTER TABLE public.sales_payments ADD PRIMARY KEY(id);
CREATE TABLE public.sales_receipts("id" uuid DEFAULT gen_random_uuid() NOT NULL,"owner_id" uuid NOT NULL,"client_id" uuid NOT NULL,"receipt_number" text NOT NULL,"receipt_date" date DEFAULT CURRENT_DATE NOT NULL,"currency" text DEFAULT 'EUR'::text NOT NULL,"notes" text,"total_amount" numeric DEFAULT 0 NOT NULL,"created_at" timestamptz DEFAULT now() NOT NULL,"updated_at" timestamptz DEFAULT now() NOT NULL,"bank_account_id" uuid,"bank_account_snapshot" jsonb,"bank_snapshot_source" text,"bank_snapshot_at" timestamptz,"payment_method_id" text,"payment_method" text);
ALTER TABLE public.sales_receipts ADD PRIMARY KEY(id);
CREATE TABLE public.sales_receipt_lines("id" uuid DEFAULT gen_random_uuid() NOT NULL,"owner_id" uuid NOT NULL,"receipt_id" uuid NOT NULL,"product_id" uuid,"position" integer DEFAULT 1 NOT NULL,"description" text NOT NULL,"quantity" numeric DEFAULT 1 NOT NULL,"unit" text DEFAULT 'ud'::text NOT NULL,"unit_price" numeric DEFAULT 0 NOT NULL,"discount_percent" numeric DEFAULT 0 NOT NULL,"invoice_tax_rate" numeric DEFAULT 21 NOT NULL,"line_total" numeric DEFAULT 0 NOT NULL,"created_at" timestamptz DEFAULT now() NOT NULL,"updated_at" timestamptz DEFAULT now() NOT NULL);
ALTER TABLE public.sales_receipt_lines ADD PRIMARY KEY(id);
CREATE TABLE public.sales_receipt_counters("owner_id" uuid NOT NULL,"year" integer NOT NULL,"next_number" integer DEFAULT 1 NOT NULL);
ALTER TABLE sales_invoice_series ADD UNIQUE(owner_id,code,year);
ALTER TABLE sales_invoices ADD UNIQUE(owner_id,invoice_number);
ALTER TABLE sales_invoice_lines ADD FOREIGN KEY(invoice_id) REFERENCES sales_invoices(id) ON DELETE CASCADE;
ALTER TABLE sales_receipts ADD UNIQUE(owner_id,receipt_number);
ALTER TABLE sales_receipt_lines ADD FOREIGN KEY(receipt_id) REFERENCES sales_receipts(id) ON DELETE CASCADE;
ALTER TABLE sales_receipt_counters ADD PRIMARY KEY(owner_id,year);
ALTER TABLE sales_invoice_released_numbers ADD PRIMARY KEY(owner_id,series_id,number);
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
$function$
;
CREATE OR REPLACE FUNCTION private.recalculate_sales_invoice_totals()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_invoice_id uuid;
begin
  v_invoice_id := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  update public.sales_invoices i
  set subtotal = coalesce(x.net,0),
      discount_amount = coalesce(x.discount,0),
      tax_amount = coalesce(x.tax,0),
      total_amount = coalesce(x.total,0)
  from (
    select
      invoice_id,
      round(sum(quantity * unit_price),2) - round(sum(line_net),2) as discount,
      round(sum(line_net),2) as net,
      round(sum(tax_amount),2) as tax,
      round(sum(line_total),2) as total
    from public.sales_invoice_lines
    where invoice_id = v_invoice_id
    group by invoice_id
  ) x
  where i.id = v_invoice_id and i.id = x.invoice_id;

  if not found then
    update public.sales_invoices set subtotal=0, discount_amount=0, tax_amount=0, total_amount=0 where id=v_invoice_id;
  end if;
  return coalesce(new, old);
end;
$function$
;
CREATE OR REPLACE FUNCTION private.guard_sales_invoice_line_edit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_invoice_id uuid;
  v_status text;
begin
  v_invoice_id := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  select status into v_status from public.sales_invoices where id = v_invoice_id;

  -- During ON DELETE CASCADE the parent draft may already be invisible to this lookup.
  -- Deleting an issued invoice is still blocked by private.guard_sales_invoice_immutable()
  -- on public.sales_invoices before the cascade can run.
  if tg_op = 'DELETE' and v_status is null then
    return old;
  end if;

  if v_status is distinct from 'draft' then
    raise exception 'Las líneas de una factura emitida no se pueden modificar.';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_sales_invoice(p_invoice_id uuid)
 RETURNS sales_invoices
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_invoice public.sales_invoices%rowtype; v_series public.sales_invoice_series%rowtype; v_client public.clients%rowtype; v_business public.business_settings%rowtype; v_tax public.business_tax_registrations%rowtype;
  v_number text; v_number_value integer; v_released_number integer; v_line_count integer; v_client_address text; v_issuer_address text; v_issuer_name text; v_issuer_tax_id text; v_issuer_tax_country text; v_issuer_tax_label text; v_suffix text;
begin
  select * into v_invoice from public.sales_invoices where id=p_invoice_id for update;
  if v_invoice.id is null then raise exception 'Factura no encontrada.'; end if;
  if v_invoice.status <> 'draft' then raise exception 'Solo se puede emitir una factura en borrador.'; end if;
  if v_invoice.invoice_type='standard' and v_invoice.total_amount <= 0 then raise exception 'La factura debe tener un importe total positivo.'; end if;
  if v_invoice.invoice_type='rectifying' and v_invoice.total_amount = 0 then raise exception 'La rectificativa debe tener un importe distinto de cero.'; end if;
  if v_invoice.invoice_type='rectifying' and v_invoice.rectifies_invoice_id is null then raise exception 'La rectificativa debe indicar la factura original.'; end if;
  select count(*) into v_line_count from public.sales_invoice_lines where invoice_id=p_invoice_id; if v_line_count=0 then raise exception 'La factura no tiene líneas.'; end if;
  select * into v_client from public.clients where id=v_invoice.client_id; if v_client.id is null then raise exception 'Cliente no encontrado.'; end if; 
  select * into v_business from public.business_settings where owner_id=v_invoice.owner_id; if v_business.owner_id is null or coalesce(trim(v_business.legal_name),'')='' or coalesce(trim(v_business.address_line1),'')='' or coalesce(trim(v_business.postal_code),'')='' or coalesce(trim(v_business.city),'')='' then raise exception 'Completa los datos fiscales de ZENVIA antes de emitir la primera factura.'; end if;
  if v_invoice.tax_registration_id is not null then select * into v_tax from public.business_tax_registrations where id=v_invoice.tax_registration_id and owner_id=v_invoice.owner_id; if v_tax.id is null or not v_tax.active then raise exception 'El registro IVA seleccionado no está disponible.'; end if; else select * into v_tax from public.business_tax_registrations where owner_id=v_invoice.owner_id and active and is_default limit 1; end if;
  if v_tax.id is null and coalesce(trim(v_business.tax_id),'')='' then raise exception 'Añade al menos un registro IVA antes de emitir.'; end if;
  select * into v_series from public.sales_invoice_series where id=v_invoice.series_id for update; if v_series.id is null or not v_series.active then raise exception 'La serie de facturación no está disponible.'; end if;
  if v_series.year<>extract(year from v_invoice.issue_date)::integer then raise exception 'La serie no corresponde al año de la factura.'; end if;
  if (v_invoice.invoice_type='standard' and v_series.kind<>'standard') or (v_invoice.invoice_type='rectifying' and v_series.kind<>'rectifying') then raise exception 'La serie no corresponde al tipo de factura.'; end if;
  if coalesce(trim(v_invoice.invoice_number),'')<>'' then
    v_number:=trim(v_invoice.invoice_number); if left(v_number,length(v_series.prefix))<>v_series.prefix then raise exception 'El número manual no corresponde a la serie.'; end if;
    v_suffix:=substring(v_number from length(v_series.prefix)+1); if v_suffix !~ '^[0-9]+$' then raise exception 'El número manual no es válido.'; end if; v_number_value:=v_suffix::integer;
    delete from public.sales_invoice_released_numbers where owner_id=v_invoice.owner_id and series_id=v_series.id and number=v_number_value;
    if v_number_value>=v_series.next_number then update public.sales_invoice_series set next_number=v_number_value+1,updated_at=now() where id=v_series.id; end if;
  elsif v_invoice.reserved_number is not null and exists(select 1 from public.sales_invoice_released_numbers r where r.owner_id=v_invoice.owner_id and r.series_id=v_series.id and r.number=v_invoice.reserved_number) then
    v_number_value:=v_invoice.reserved_number; delete from public.sales_invoice_released_numbers where owner_id=v_invoice.owner_id and series_id=v_series.id and number=v_number_value; v_number:=v_series.prefix||lpad(v_number_value::text,greatest(v_series.padding,length(v_number_value::text)),'0');
  else
    select r.number into v_released_number from public.sales_invoice_released_numbers r where r.owner_id=v_invoice.owner_id and r.series_id=v_series.id order by r.number limit 1 for update;
    if v_released_number is not null then v_number_value:=v_released_number; delete from public.sales_invoice_released_numbers where owner_id=v_invoice.owner_id and series_id=v_series.id and number=v_released_number; else v_number_value:=v_series.next_number; update public.sales_invoice_series set next_number=next_number+1,updated_at=now() where id=v_series.id; end if;
    v_number:=v_series.prefix||lpad(v_number_value::text,greatest(v_series.padding,length(v_number_value::text)),'0');
  end if;
  v_client_address:=concat_ws(', ',nullif(v_client.address_line1,''),nullif(v_client.address_line2,''),nullif(concat_ws(' ',nullif(v_client.postal_code,''),nullif(v_client.city,'')),''),nullif(v_client.province,''),nullif(v_client.country_code,''));
  v_issuer_address:=coalesce(nullif(v_tax.address_text,''),concat_ws(', ',nullif(v_business.address_line1,''),nullif(v_business.address_line2,''),nullif(concat_ws(' ',nullif(v_business.postal_code,''),nullif(v_business.city,'')),''),nullif(v_business.province,''),nullif(v_business.country_code,'')));
  v_issuer_name:=coalesce(nullif(v_tax.fiscal_name,''),v_business.legal_name); v_issuer_tax_id:=coalesce(nullif(v_tax.vat_number,''),v_business.tax_id); v_issuer_tax_country:=coalesce(v_tax.country_code,v_business.country_code); v_issuer_tax_label:=v_tax.label;
  update public.sales_invoices set invoice_number=v_number,reserved_number=null,status='issued',issued_at=now(),tax_registration_id=coalesce(v_tax.id,tax_registration_id),client_name=v_client.name,client_tax_id=v_client.tax_id,client_email=v_client.email,client_phone=v_client.phone,client_address=v_client_address,issuer_name=v_issuer_name,issuer_tax_id=v_issuer_tax_id,issuer_email=v_business.email,issuer_phone=v_business.phone,issuer_address=v_issuer_address,issuer_tax_country_code=v_issuer_tax_country,issuer_tax_registration_label=v_issuer_tax_label where id=p_invoice_id returning * into v_invoice;
  if v_invoice.invoice_type='rectifying' then update public.sales_invoices set status='rectified' where id=v_invoice.rectifies_invoice_id and status<>'draft'; end if;
  return v_invoice;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.delete_reversible_sales_invoice(p_invoice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_invoice public.sales_invoices%rowtype;
  v_series public.sales_invoice_series%rowtype;
  v_number integer;
begin
  select * into v_invoice from public.sales_invoices where id=p_invoice_id for update;
  if v_invoice.id is null then raise exception 'Factura no encontrada.'; end if;

  if v_invoice.status='draft' then
    delete from public.sales_invoices where id=v_invoice.id;
    return;
  end if;

  if v_invoice.status <> 'issued' then
    raise exception 'Solo se puede eliminar completamente una factura en borrador o una factura que esté únicamente emitida.';
  end if;
  if v_invoice.sent_at is not null or v_invoice.paid_at is not null or exists(select 1 from public.sales_payments p where p.invoice_id=v_invoice.id) then
    raise exception 'La factura ya se ha enviado o tiene cobros y no se puede eliminar completamente.';
  end if;

  select * into v_series from public.sales_invoice_series where id=v_invoice.series_id for update;
  if v_series.id is null then raise exception 'Serie no encontrada.'; end if;
  if v_invoice.invoice_number is null or left(v_invoice.invoice_number, char_length(v_series.prefix)) <> v_series.prefix then
    raise exception 'No se pudo recuperar el número de factura.';
  end if;

  v_number := substring(v_invoice.invoice_number from char_length(v_series.prefix)+1)::integer;
  insert into public.sales_invoice_released_numbers(owner_id,series_id,number)
  values(v_invoice.owner_id,v_invoice.series_id,v_number)
  on conflict do nothing;

  delete from public.sales_invoices where id=v_invoice.id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.reopen_sales_invoice(p_invoice_id uuid)
 RETURNS sales_invoices
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_invoice public.sales_invoices%rowtype;
  v_series public.sales_invoice_series%rowtype;
  v_number integer;
begin
  select * into v_invoice from public.sales_invoices where id=p_invoice_id for update;
  if v_invoice.id is null then raise exception 'Factura no encontrada.'; end if;
  if v_invoice.status <> 'issued' then raise exception 'Solo se puede reabrir una factura que esté únicamente emitida.'; end if;
  if v_invoice.sent_at is not null or v_invoice.paid_at is not null or exists(select 1 from public.sales_payments p where p.invoice_id=v_invoice.id) then
    raise exception 'La factura ya se ha enviado o tiene cobros y no se puede reabrir.';
  end if;

  select * into v_series from public.sales_invoice_series where id=v_invoice.series_id for update;
  if v_series.id is null then raise exception 'Serie no encontrada.'; end if;
  if v_invoice.invoice_number is null or left(v_invoice.invoice_number, char_length(v_series.prefix)) <> v_series.prefix then
    raise exception 'No se pudo recuperar el número de factura.';
  end if;

  v_number := substring(v_invoice.invoice_number from char_length(v_series.prefix)+1)::integer;
  insert into public.sales_invoice_released_numbers(owner_id,series_id,number)
  values(v_invoice.owner_id,v_invoice.series_id,v_number)
  on conflict do nothing;

  update public.sales_invoices
  set status='draft', invoice_number=null, reserved_number=v_number, issued_at=null,
      client_name=null, client_tax_id=null, client_email=null, client_address=null,
      issuer_name=null, issuer_tax_id=null, issuer_email=null, issuer_address=null
  where id=v_invoice.id
  returning * into v_invoice;

  return v_invoice;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.guard_sales_invoice_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op='DELETE' then
    if old.status='draft' then return old; end if;
    if old.status='issued'
       and old.sent_at is null
       and old.paid_at is null
       and not exists(select 1 from public.sales_payments p where p.invoice_id=old.id)
    then
      return old;
    end if;
    raise exception 'Solo se puede eliminar un documento en borrador o emitido que todavía no se haya enviado ni cobrado.';
  end if;

  if old.status='issued' and new.status='draft' then
    if not private.sales_setting_boolean(old.owner_id,'allowEditIssuedInvoices',true) then
      raise exception 'La edición de documentos emitidos está desactivada en Configuración.';
    end if;
    if old.sent_at is not null
       or old.paid_at is not null
       or exists(select 1 from public.sales_payments p where p.invoice_id=old.id)
    then
      raise exception 'El documento ya tiene envío o cobros y no se puede reabrir.';
    end if;
    return new;
  end if;

  if old.status <> 'draft' then
    if new.client_id is distinct from old.client_id
      or new.series_id is distinct from old.series_id
      or new.invoice_type is distinct from old.invoice_type
      or new.document_kind is distinct from old.document_kind
      or new.fiscal_treatment is distinct from old.fiscal_treatment
      or new.fiscal_reason is distinct from old.fiscal_reason
      or new.rectifies_invoice_id is distinct from old.rectifies_invoice_id
      or new.invoice_number is distinct from old.invoice_number
      or new.issue_date is distinct from old.issue_date
      or new.operation_date is distinct from old.operation_date
      or (
        new.due_date is distinct from old.due_date
        and not (
          old.due_date is null
          and new.due_date = old.issue_date + private.sales_default_due_days(old.owner_id)
        )
      )
      or new.currency is distinct from old.currency
      or new.subtotal is distinct from old.subtotal
      or new.discount_amount is distinct from old.discount_amount
      or new.tax_amount is distinct from old.tax_amount
      or new.total_amount is distinct from old.total_amount
      or new.payment_method is distinct from old.payment_method
      or new.notes is distinct from old.notes
      or new.client_name is distinct from old.client_name
      or new.client_tax_id is distinct from old.client_tax_id
      or new.client_email is distinct from old.client_email
      or new.client_address is distinct from old.client_address
      or new.issuer_name is distinct from old.issuer_name
      or new.issuer_tax_id is distinct from old.issuer_tax_id
      or new.issuer_email is distinct from old.issuer_email
      or new.issuer_address is distinct from old.issuer_address
    then
      raise exception 'Los datos fiscales de un documento cerrado no se pueden modificar directamente.';
    end if;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.update_sales_invoice_number(p_invoice_id uuid, p_invoice_number text)
 RETURNS sales_invoices
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_invoice public.sales_invoices%rowtype;
  v_series public.sales_invoice_series%rowtype;
  v_new text:=trim(coalesce(p_invoice_number,''));
  v_old text;
  v_suffix text;
  v_old_suffix text;
  v_value integer;
  v_old_value integer;
begin
  if auth.uid() is null then raise exception 'Sesión no válida.'; end if;
  select * into v_invoice from public.sales_invoices where id=p_invoice_id for update;
  if v_invoice.id is null then raise exception 'Factura no encontrada.'; end if;
  if v_invoice.owner_id <> private.app_workspace_owner_id() or not private.app_has_permission('sales') then raise exception 'Sin permiso para modificar la factura.'; end if;
  if v_new='' then raise exception 'Indica un número de factura.'; end if;
  select * into v_series from public.sales_invoice_series where id=v_invoice.series_id for update;
  if v_series.id is null then raise exception 'Serie no encontrada.'; end if;
  if left(v_new,length(v_series.prefix))<>v_series.prefix then raise exception 'El número debe comenzar por el prefijo de la serie: %',v_series.prefix; end if;
  v_suffix:=substring(v_new from length(v_series.prefix)+1);
  if v_suffix !~ '^[0-9]+$' then raise exception 'El número debe terminar en una parte numérica.'; end if;
  v_value:=v_suffix::integer;
  if v_value<1 then raise exception 'El número debe ser mayor que cero.'; end if;
  if exists(select 1 from public.sales_invoices where owner_id=v_invoice.owner_id and invoice_number=v_new and id<>v_invoice.id) then raise exception 'Ya existe una factura con el número %.',v_new; end if;
  v_old:=v_invoice.invoice_number;
  if v_old is not distinct from v_new then return v_invoice; end if;
  update public.sales_invoices set invoice_number=v_new,updated_at=now() where id=v_invoice.id returning * into v_invoice;
  delete from public.sales_invoice_released_numbers where owner_id=v_invoice.owner_id and series_id=v_series.id and number=v_value;
  if v_value>=v_series.next_number then update public.sales_invoice_series set next_number=v_value+1,updated_at=now() where id=v_series.id; end if;
  if v_old is not null and left(v_old,length(v_series.prefix))=v_series.prefix then
    v_old_suffix:=substring(v_old from length(v_series.prefix)+1);
    if v_old_suffix ~ '^[0-9]+$' then
      v_old_value:=v_old_suffix::integer;
      if not exists(select 1 from public.sales_invoices where owner_id=v_invoice.owner_id and invoice_number=v_old) then
        insert into public.sales_invoice_released_numbers(owner_id,series_id,number) values(v_invoice.owner_id,v_series.id,v_old_value) on conflict do nothing;
      end if;
    end if;
  end if;
  return v_invoice;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.sales_default_due_days(p_owner uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_raw text;
  v_days integer := 30;
begin
  select coalesce((
    select s.config #>> '{sales,defaultDueDays}'
    from public.app_settings s
    where s.owner_id=p_owner
  ),'30')
  into v_raw;

  if v_raw is not null and v_raw ~ '^[0-9]{1,3}$' then
    v_days := v_raw::integer;
    if v_days < 0 or v_days > 365 then
      v_days := 30;
    end if;
  end if;

  return v_days;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.sales_setting_boolean(p_owner uuid, p_key text, p_default boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_raw text;
begin
  select lower(s.config->'sales'->>p_key)
    into v_raw
  from public.app_settings s
  where s.owner_id=p_owner;

  if v_raw='true' then return true; end if;
  if v_raw='false' then return false; end if;
  return p_default;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.set_default_sales_invoice_due_date()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.issue_date is not null and new.due_date is null then
    new.due_date := new.issue_date + private.sales_default_due_days(new.owner_id);
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.mark_sales_invoice_paid(p_invoice_id uuid)
 RETURNS sales_invoices
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_invoice public.sales_invoices%rowtype;
  v_paid numeric;
begin
  select * into v_invoice
  from public.sales_invoices
  where id=p_invoice_id
  for update;

  if v_invoice.id is null then
    raise exception 'Factura no encontrada.';
  end if;
  if v_invoice.status in ('draft','rectified') then
    raise exception 'Esta factura no se puede marcar como cobrada.';
  end if;

  select coalesce(sum(amount),0)
    into v_paid
  from public.sales_payments
  where invoice_id=p_invoice_id;

  if v_invoice.total_amount<=0 or v_paid < v_invoice.total_amount-0.005 then
    raise exception 'Los cobros registrados no cubren el total de la factura.';
  end if;

  update public.sales_invoices
  set status='paid',paid_at=coalesce(paid_at,now())
  where id=p_invoice_id
  returning * into v_invoice;

  return v_invoice;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.assign_sales_receipt_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_year integer;
  v_number integer;
begin
  if coalesce(trim(new.receipt_number),'')<>'' then return new; end if;
  v_year:=extract(year from new.receipt_date)::integer;
  insert into public.sales_receipt_counters(owner_id,year,next_number)
  values(new.owner_id,v_year,2)
  on conflict(owner_id,year)
  do update set next_number=public.sales_receipt_counters.next_number+1
  returning next_number-1 into v_number;
  new.receipt_number:=format('REC-%s-%s',v_year,lpad(v_number::text,4,'0'));
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.sales_receipt_line_calculate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.line_total:=round(new.quantity*new.unit_price*(1-new.discount_percent/100),2);
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.recalculate_sales_receipt_total()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_receipt_id uuid;
begin
  v_receipt_id:=case when tg_op='DELETE' then old.receipt_id else new.receipt_id end;
  update public.sales_receipts
  set total_amount=coalesce((select round(sum(line_total),2) from public.sales_receipt_lines where receipt_id=v_receipt_id),0)
  where id=v_receipt_id;
  return coalesce(new,old);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_sales_receipt(p_invoice_id uuid)
 RETURNS sales_invoices
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_invoice public.sales_invoices%rowtype;
  v_series public.sales_invoice_series%rowtype;
  v_client public.clients%rowtype;
  v_business public.business_settings%rowtype;
  v_tax public.business_tax_registrations%rowtype;
  v_number text;
  v_number_value integer;
  v_released_number integer;
  v_line_count integer;
  v_client_address text;
  v_issuer_address text;
  v_issuer_name text;
  v_issuer_tax_id text;
  v_issuer_tax_country text;
  v_issuer_tax_label text;
begin
  select * into v_invoice from public.sales_invoices where id=p_invoice_id for update;
  if v_invoice.id is null then raise exception 'Recibo no encontrado.'; end if;
  if v_invoice.document_kind<>'receipt' then raise exception 'El documento no es un recibo.'; end if;
  if v_invoice.status<>'draft' then raise exception 'Solo se puede emitir un recibo en borrador.'; end if;
  if v_invoice.total_amount<=0 then raise exception 'El recibo debe tener un importe total positivo.'; end if;
  if v_invoice.fiscal_treatment<>'taxable' and coalesce(trim(v_invoice.fiscal_reason),'')='' then
    raise exception 'Indica el motivo fiscal de la exención o no sujeción.';
  end if;

  select count(*) into v_line_count from public.sales_invoice_lines where invoice_id=p_invoice_id;
  if v_line_count=0 then raise exception 'El recibo no tiene líneas.'; end if;
  if v_invoice.fiscal_treatment<>'taxable'
     and exists(select 1 from public.sales_invoice_lines where invoice_id=p_invoice_id and coalesce(tax_rate,0)<>0)
  then
    raise exception 'Los recibos exentos o no sujetos deben tener IVA 0 %%.';
  end if;

  select * into v_client from public.clients where id=v_invoice.client_id;
  if v_client.id is null then raise exception 'Cliente no encontrado.'; end if;

  select * into v_business from public.business_settings where owner_id=v_invoice.owner_id;
  if v_business.owner_id is null or coalesce(trim(v_business.legal_name),'')='' then
    raise exception 'Completa los datos de empresa antes de emitir el primer recibo.';
  end if;

  if v_invoice.tax_registration_id is not null then
    select * into v_tax from public.business_tax_registrations
    where id=v_invoice.tax_registration_id and owner_id=v_invoice.owner_id;
  else
    select * into v_tax from public.business_tax_registrations
    where owner_id=v_invoice.owner_id and active and is_default limit 1;
  end if;

  select * into v_series from public.sales_invoice_series where id=v_invoice.series_id for update;
  if v_series.id is null or not v_series.active or v_series.kind<>'receipt' then
    raise exception 'La serie de recibos no está disponible.';
  end if;
  if v_series.year<>extract(year from v_invoice.issue_date)::integer then
    raise exception 'La serie no corresponde al año del recibo.';
  end if;

  select r.number into v_released_number
  from public.sales_invoice_released_numbers r
  where r.owner_id=v_invoice.owner_id and r.series_id=v_series.id
  order by r.number limit 1 for update;

  if v_released_number is not null then
    v_number_value:=v_released_number;
    delete from public.sales_invoice_released_numbers
    where owner_id=v_invoice.owner_id and series_id=v_series.id and number=v_released_number;
  else
    v_number_value:=v_series.next_number;
    update public.sales_invoice_series set next_number=next_number+1,updated_at=now() where id=v_series.id;
  end if;
  v_number:=v_series.prefix||lpad(v_number_value::text,greatest(v_series.padding,length(v_number_value::text)),'0');

  v_client_address:=concat_ws(', ',nullif(v_client.address_line1,''),nullif(v_client.address_line2,''),nullif(concat_ws(' ',nullif(v_client.postal_code,''),nullif(v_client.city,'')),''),nullif(v_client.province,''),nullif(v_client.country_code,''));
  v_issuer_address:=coalesce(nullif(v_tax.address_text,''),concat_ws(', ',nullif(v_business.address_line1,''),nullif(v_business.address_line2,''),nullif(concat_ws(' ',nullif(v_business.postal_code,''),nullif(v_business.city,'')),''),nullif(v_business.province,''),nullif(v_business.country_code,'')));
  v_issuer_name:=coalesce(nullif(v_tax.fiscal_name,''),v_business.legal_name);
  v_issuer_tax_id:=coalesce(nullif(v_tax.vat_number,''),v_business.tax_id);
  v_issuer_tax_country:=coalesce(v_tax.country_code,v_business.country_code);
  v_issuer_tax_label:=v_tax.label;

  update public.sales_invoices
  set invoice_number=v_number,reserved_number=null,status='issued',issued_at=now(),
      tax_registration_id=coalesce(v_tax.id,tax_registration_id),
      client_name=v_client.name,client_tax_id=v_client.tax_id,client_email=v_client.email,client_phone=v_client.phone,client_address=v_client_address,
      issuer_name=v_issuer_name,issuer_tax_id=v_issuer_tax_id,issuer_email=v_business.email,issuer_phone=v_business.phone,issuer_address=v_issuer_address,
      issuer_tax_country_code=v_issuer_tax_country,issuer_tax_registration_label=v_issuer_tax_label
  where id=p_invoice_id
  returning * into v_invoice;

  return v_invoice;
end;
$function$
;
CREATE TRIGGER sales_invoice_immutable BEFORE UPDATE OR DELETE ON sales_invoices FOR EACH ROW EXECUTE FUNCTION private.guard_sales_invoice_immutable();
CREATE TRIGGER sales_invoice_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_invoice_lines FOR EACH ROW EXECUTE FUNCTION private.guard_sales_invoice_line_edit();
CREATE TRIGGER sales_invoice_lines_calculate BEFORE INSERT OR UPDATE ON sales_invoice_lines FOR EACH ROW EXECUTE FUNCTION private.sales_invoice_line_calculate();
CREATE TRIGGER sales_invoice_lines_recalc AFTER INSERT OR UPDATE OR DELETE ON sales_invoice_lines FOR EACH ROW EXECUTE FUNCTION private.recalculate_sales_invoice_totals();
CREATE TRIGGER sales_receipt_number BEFORE INSERT ON sales_receipts FOR EACH ROW EXECUTE FUNCTION private.assign_sales_receipt_number();
CREATE TRIGGER sales_receipt_lines_calculate BEFORE INSERT OR UPDATE ON sales_receipt_lines FOR EACH ROW EXECUTE FUNCTION private.sales_receipt_line_calculate();
CREATE TRIGGER sales_receipt_lines_recalc AFTER INSERT OR UPDATE OR DELETE ON sales_receipt_lines FOR EACH ROW EXECUTE FUNCTION private.recalculate_sales_receipt_total();
GRANT USAGE ON SCHEMA public,private,auth TO authenticated;GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
ALTER TABLE public.sales_invoice_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mfa_delete_gate" ON public.sales_invoice_lines AS RESTRICTIVE FOR DELETE TO authenticated USING(( SELECT private.mfa_allowed() AS mfa_allowed));
ALTER TABLE public.sales_invoice_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mfa_insert_gate" ON public.sales_invoice_lines AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(( SELECT private.mfa_allowed() AS mfa_allowed));
ALTER TABLE public.sales_invoice_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mfa_select_gate" ON public.sales_invoice_lines AS RESTRICTIVE FOR SELECT TO authenticated USING(( SELECT private.mfa_allowed() AS mfa_allowed));
ALTER TABLE public.sales_invoice_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mfa_update_gate" ON public.sales_invoice_lines AS RESTRICTIVE FOR UPDATE TO authenticated USING(( SELECT private.mfa_allowed() AS mfa_allowed)) WITH CHECK(( SELECT private.mfa_allowed() AS mfa_allowed));
ALTER TABLE public.sales_invoice_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sales_lines_workspace_all" ON public.sales_invoice_lines AS PERMISSIVE FOR ALL TO authenticated USING(((owner_id = ( SELECT private.app_workspace_owner_id() AS app_workspace_owner_id)) AND ( SELECT private.app_has_permission('sales'::text) AS app_has_permission))) WITH CHECK(((owner_id = ( SELECT private.app_workspace_owner_id() AS app_workspace_owner_id)) AND ( SELECT private.app_has_permission('sales'::text) AS app_has_permission)));
ALTER TABLE public.sales_invoice_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sales_lines_workspace_select" ON public.sales_invoice_lines AS PERMISSIVE FOR SELECT TO authenticated USING(((owner_id = ( SELECT private.app_workspace_owner_id() AS app_workspace_owner_id)) AND (( SELECT private.app_has_permission('sales'::text) AS app_has_permission) OR ( SELECT private.app_has_permission('dashboard'::text) AS app_has_permission))));
ALTER TABLE public.sales_invoice_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mfa_delete_gate" ON public.sales_invoice_series AS RESTRICTIVE FOR DELETE TO authenticated USING(( SELECT private.mfa_allowed() AS mfa_allowed));
ALTER TABLE public.sales_invoice_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mfa_insert_gate" ON public.sales_invoice_series AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(( SELECT private.mfa_allowed() AS mfa_allowed));
ALTER TABLE public.sales_invoice_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mfa_select_gate" ON public.sales_invoice_series AS RESTRICTIVE FOR SELECT TO authenticated USING(( SELECT private.mfa_allowed() AS mfa_allowed));
ALTER TABLE public.sales_invoice_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mfa_update_gate" ON public.sales_invoice_series AS RESTRICTIVE FOR UPDATE TO authenticated USING(( SELECT private.mfa_allowed() AS mfa_allowed)) WITH CHECK(( SELECT private.mfa_allowed() AS mfa_allowed));
ALTER TABLE public.sales_invoice_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sales_series_workspace_all" ON public.sales_invoice_series AS PERMISSIVE FOR ALL TO authenticated USING(((owner_id = ( SELECT private.app_workspace_owner_id() AS app_workspace_owner_id)) AND ( SELECT private.app_has_permission('sales'::text) AS app_has_permission))) WITH CHECK(((owner_id = ( SELECT private.app_workspace_owner_id() AS app_workspace_owner_id)) AND ( SELECT private.app_has_permission('sales'::text) AS app_has_permission)));
ALTER TABLE public.sales_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mfa_delete_gate" ON public.sales_invoices AS RESTRICTIVE FOR DELETE TO authenticated USING(( SELECT private.mfa_allowed() AS mfa_allowed));
ALTER TABLE public.sales_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mfa_insert_gate" ON public.sales_invoices AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(( SELECT private.mfa_allowed() AS mfa_allowed));
ALTER TABLE public.sales_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mfa_select_gate" ON public.sales_invoices AS RESTRICTIVE FOR SELECT TO authenticated USING(( SELECT private.mfa_allowed() AS mfa_allowed));
ALTER TABLE public.sales_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mfa_update_gate" ON public.sales_invoices AS RESTRICTIVE FOR UPDATE TO authenticated USING(( SELECT private.mfa_allowed() AS mfa_allowed)) WITH CHECK(( SELECT private.mfa_allowed() AS mfa_allowed));
ALTER TABLE public.sales_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sales_invoices_workspace_all" ON public.sales_invoices AS PERMISSIVE FOR ALL TO authenticated USING(((owner_id = ( SELECT private.app_workspace_owner_id() AS app_workspace_owner_id)) AND ( SELECT private.app_has_permission('sales'::text) AS app_has_permission))) WITH CHECK(((owner_id = ( SELECT private.app_workspace_owner_id() AS app_workspace_owner_id)) AND ( SELECT private.app_has_permission('sales'::text) AS app_has_permission)));
ALTER TABLE public.sales_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sales_invoices_workspace_select" ON public.sales_invoices AS PERMISSIVE FOR SELECT TO authenticated USING(((owner_id = ( SELECT private.app_workspace_owner_id() AS app_workspace_owner_id)) AND (( SELECT private.app_has_permission('sales'::text) AS app_has_permission) OR ( SELECT private.app_has_permission('dashboard'::text) AS app_has_permission))));
ALTER TABLE public.sales_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mfa_delete_gate" ON public.sales_receipts AS RESTRICTIVE FOR DELETE TO authenticated USING(( SELECT private.mfa_allowed() AS mfa_allowed));
ALTER TABLE public.sales_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mfa_insert_gate" ON public.sales_receipts AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(( SELECT private.mfa_allowed() AS mfa_allowed));
ALTER TABLE public.sales_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mfa_select_gate" ON public.sales_receipts AS RESTRICTIVE FOR SELECT TO authenticated USING(( SELECT private.mfa_allowed() AS mfa_allowed));
ALTER TABLE public.sales_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mfa_update_gate" ON public.sales_receipts AS RESTRICTIVE FOR UPDATE TO authenticated USING(( SELECT private.mfa_allowed() AS mfa_allowed)) WITH CHECK(( SELECT private.mfa_allowed() AS mfa_allowed));
ALTER TABLE public.sales_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sales_receipts_workspace_all" ON public.sales_receipts AS PERMISSIVE FOR ALL TO authenticated USING(((owner_id = ( SELECT private.app_workspace_owner_id() AS app_workspace_owner_id)) AND ( SELECT private.app_has_permission('sales'::text) AS app_has_permission))) WITH CHECK(((owner_id = ( SELECT private.app_workspace_owner_id() AS app_workspace_owner_id)) AND ( SELECT private.app_has_permission('sales'::text) AS app_has_permission)));
SET test.uid='00000000-0000-4000-8000-000000000001';SET test.owner='00000000-0000-4000-8000-000000000001';
INSERT INTO workspaces VALUES('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
INSERT INTO clients(id,owner_id,name,tax_id,address_line1,postal_code,city,country_code) VALUES('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','Synthetic customer','89890001K','Test road','28001','Madrid','ES');
INSERT INTO business_settings(owner_id,legal_name,tax_id,address_line1,postal_code,city,country_code) VALUES('00000000-0000-4000-8000-000000000001','Synthetic issuer','89890001K','Test road','28001','Madrid','ES');
INSERT INTO sales_invoice_series(id,owner_id,code,name,kind,year,prefix,next_number,padding,active) VALUES('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001','F','Synthetic invoices','standard',2026,'F-2026-',1,4,true),('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000001','R','Synthetic rectifications','rectifying',2026,'R-2026-',1,4,true);

CREATE OR REPLACE FUNCTION private.sync_sales_payment_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_invoice_id uuid;
  v_owner uuid;
  v_paid numeric;
  v_total numeric;
  v_status text;
  v_allow_partial boolean;
  v_auto_paid boolean;
begin
  v_invoice_id := case when tg_op='DELETE' then old.invoice_id else new.invoice_id end;

  select owner_id,total_amount,status
    into v_owner,v_total,v_status
  from public.sales_invoices
  where id=v_invoice_id;

  if v_status='draft' then
    raise exception 'No se pueden registrar cobros sobre una factura en borrador.';
  end if;

  select coalesce(sum(amount),0)
    into v_paid
  from public.sales_payments
  where invoice_id=v_invoice_id;

  v_allow_partial := private.sales_setting_boolean(v_owner,'allowPartialPayments',true);
  v_auto_paid := private.sales_setting_boolean(v_owner,'autoMarkPaid',true);

  if not v_allow_partial
     and v_paid > 0.005
     and v_total > 0
     and v_paid < v_total - 0.005
  then
    raise exception 'Los cobros parciales están desactivados para este espacio de trabajo.';
  end if;

  update public.sales_invoices
  set status=case
      when v_paid>=v_total-0.005 and v_total>0 and v_auto_paid then 'paid'
      when v_paid>0.005 then 'partially_paid'
      when v_status in ('paid','partially_paid') then 'issued'
      else v_status
    end,
    paid_at=case
      when v_paid>=v_total-0.005 and v_total>0 and v_auto_paid then coalesce(paid_at,now())
      else null
    end
  where id=v_invoice_id;

  return coalesce(new,old);
end;
$function$
;
CREATE TRIGGER sales_payments_status AFTER INSERT OR UPDATE OR DELETE ON sales_payments FOR EACH ROW EXECUTE FUNCTION private.sync_sales_payment_status();

ALTER TABLE sales_receipt_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY sales_receipt_lines_workspace_all ON sales_receipt_lines FOR ALL TO authenticated USING(owner_id=private.app_workspace_owner_id() AND private.app_has_permission('sales')) WITH CHECK(owner_id=private.app_workspace_owner_id() AND private.app_has_permission('sales'));
