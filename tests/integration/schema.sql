--
-- PostgreSQL database dump
--


-- Dumped from database version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA auth;


--
-- Name: extensions; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA extensions;


--
-- Name: private; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA private;


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: uid(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$ select nullif(current_setting('request.jwt.claims',true)::json->>'sub','')::uuid $$;


--
-- Name: app_has_permission(text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.app_has_permission(text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$ select true $$;


--
-- Name: app_is_active(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.app_is_active() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$ select true $$;


--
-- Name: app_is_admin(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.app_is_admin() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$ select true $$;


--
-- Name: app_workspace_id(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.app_workspace_id() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$ select '11111111-1111-4111-8111-111111111111'::uuid $$;


--
-- Name: app_workspace_owner_id(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.app_workspace_owner_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$ select private.app_workspace_id() $$;


--
-- Name: apply_default_product_sale_price(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.apply_default_product_sale_price() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if new.last_cost is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.sale_price is null then
      new.sale_price := round(new.last_cost * 1.25, 4);
    end if;
    return new;
  end if;

  if new.last_cost is distinct from old.last_cost
     and new.sale_price is not distinct from old.sale_price
     and (
       old.sale_price is null
       or old.last_cost is null
       or abs(old.sale_price - round(old.last_cost * 1.25, 4)) < 0.0001
     ) then
    new.sale_price := round(new.last_cost * 1.25, 4);
  end if;

  return new;
end;
$$;


--
-- Name: audit_app_change(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.audit_app_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  before_row jsonb;
  after_row jsonb;
  row_data jsonb;
  workspace_id uuid;
  actor_id uuid;
  actor_mail text;
  module_name text;
  action_name text;
  entity_kind text;
  entity_key text;
  entity_name text;
  message text;
  safe_details jsonb := '{}'::jsonb;
begin
  before_row := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else '{}'::jsonb end;
  after_row := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else '{}'::jsonb end;
  row_data := case when tg_op = 'DELETE' then before_row else after_row end;
  actor_id := auth.uid();
  entity_kind := tg_table_name;

  if tg_table_name = 'gmail_imports' then
    if tg_op = 'INSERT' then
      return new;
    end if;
    if tg_op = 'UPDATE' and old.status is not distinct from new.status then
      return new;
    end if;
  end if;

  workspace_id := nullif(row_data->>'owner_id','')::uuid;
  if workspace_id is null then workspace_id := private.app_workspace_owner_id(); end if;
  if workspace_id is null then if tg_op = 'DELETE' then return old; else return new; end if; end if;
  if actor_id is not null then select au.email into actor_mail from public.app_users au where au.user_id = actor_id limit 1; end if;
  entity_key := coalesce(row_data->>'id', row_data->>'user_id');

  if tg_table_name = 'invoices' then
    module_name := 'invoices'; entity_name := coalesce(row_data->>'invoice_number', row_data->>'file_name', 'Sin número');
    safe_details := jsonb_strip_nulls(jsonb_build_object('invoice_number',row_data->>'invoice_number','issue_date',row_data->>'issue_date','supplier_id',row_data->>'supplier_id','category_id',row_data->>'expense_category_id','total',row_data->>'total_amount','status',row_data->>'status','source',row_data->>'source','file_name',row_data->>'file_name'));
    if tg_op = 'INSERT' then action_name := case when row_data->>'source'='gmail' then 'import' else 'create' end; message := case when row_data->>'source'='gmail' then 'Importó la factura ' else 'Creó la factura ' end || entity_name;
    elsif tg_op = 'DELETE' then action_name := 'delete'; message := 'Eliminó la factura ' || entity_name;
    elsif old.status is distinct from new.status then action_name := 'status_change'; message := 'Cambió el estado de la factura ' || entity_name || ' de ' || coalesce(old.status,'—') || ' a ' || coalesce(new.status,'—'); safe_details := safe_details || jsonb_build_object('previous_status',old.status,'new_status',new.status);
    else action_name := 'update'; message := 'Modificó la factura ' || entity_name; end if;

  elsif tg_table_name = 'products' then
    module_name := 'products'; entity_name := coalesce(row_data->>'name','Producto');
    safe_details := jsonb_strip_nulls(jsonb_build_object('name',row_data->>'name','sku',row_data->>'sku','category',row_data->>'category','unit',row_data->>'base_unit','price',row_data->>'last_cost','previous_price',row_data->>'previous_cost'));
    if tg_op = 'INSERT' then action_name := 'create'; message := 'Creó el producto ' || entity_name;
    elsif tg_op = 'DELETE' then action_name := 'delete'; message := 'Eliminó el producto ' || entity_name;
    elsif old.last_cost is distinct from new.last_cost and old.name is not distinct from new.name and old.sku is not distinct from new.sku and old.category is not distinct from new.category and old.base_unit is not distinct from new.base_unit and old.active is not distinct from new.active then action_name := 'price_update'; message := 'Actualizó el precio de ' || entity_name || ' de ' || coalesce(old.last_cost::text,'—') || ' € a ' || coalesce(new.last_cost::text,'—') || ' €'; safe_details := safe_details || jsonb_build_object('previous_price',old.last_cost,'new_price',new.last_cost);
    else action_name := 'update'; message := 'Modificó el producto ' || entity_name; end if;

  elsif tg_table_name = 'suppliers' then
    module_name := 'suppliers'; entity_name := coalesce(row_data->>'name','Proveedor');
    safe_details := jsonb_strip_nulls(jsonb_build_object('name',row_data->>'name','tax_id',row_data->>'tax_id','email',row_data->>'email','supplier_type',row_data->>'supplier_type','active',row_data->>'active'));
    if tg_op = 'INSERT' then action_name := 'create'; message := 'Creó el proveedor ' || entity_name;
    elsif tg_op = 'DELETE' then action_name := 'delete'; message := 'Eliminó el proveedor ' || entity_name;
    else action_name := 'update'; message := 'Modificó el proveedor ' || entity_name; end if;

  elsif tg_table_name = 'gmail_imports' then
    module_name := 'gmail'; entity_name := coalesce(row_data->>'attachment_name',row_data->>'subject','Adjunto de Gmail');
    safe_details := jsonb_strip_nulls(jsonb_build_object('attachment_name',row_data->>'attachment_name','subject',row_data->>'subject','sender',row_data->>'sender','previous_status',before_row->>'status','new_status',after_row->>'status','invoice_id',row_data->>'invoice_id'));
    action_name := case after_row->>'status' when 'imported' then 'import' when 'ignored' then 'ignore' when 'found' then 'recover' when 'error' then 'error' else 'update' end;
    message := case after_row->>'status' when 'imported' then 'Marcó como importado '||entity_name when 'ignored' then 'Ignoró '||entity_name when 'found' then 'Recuperó '||entity_name||' para revisión' when 'error' then 'La importación de '||entity_name||' terminó con error' else 'Actualizó '||entity_name end;

  elsif tg_table_name = 'export_runs' then
    if tg_op <> 'INSERT' then if tg_op='DELETE' then return old; else return new; end if; end if;
    module_name := 'invoices'; action_name := 'export'; entity_name := (row_data->>'fiscal_quarter')||'T '||(row_data->>'fiscal_year'); message := 'Exportó '||coalesce(entity_name,'facturas');
    safe_details := jsonb_strip_nulls(jsonb_build_object('fiscal_year',row_data->>'fiscal_year','fiscal_quarter',row_data->>'fiscal_quarter','invoice_count',row_data->>'invoice_count','total_amount',row_data->>'total_amount'));
  else
    if tg_op='DELETE' then return old; else return new; end if;
  end if;

  insert into public.audit_logs(workspace_owner_id,actor_user_id,actor_email,module,action,entity_type,entity_id,entity_label,summary,details)
  values(workspace_id,actor_id,actor_mail,module_name,action_name,entity_kind,entity_key,entity_name,message,safe_details);
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;


--
-- Name: audit_configuration_change(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.audit_configuration_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_before jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else '{}'::jsonb end;
  v_after jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else '{}'::jsonb end;
  v_row jsonb := case when tg_op='DELETE' then v_before else v_after end;
  v_owner uuid := nullif(v_row->>'owner_id','')::uuid;
  v_actor uuid := auth.uid();
  v_mail text;
  v_action text := lower(tg_op);
  v_entity_id text := coalesce(v_row->>'id',v_row->>'owner_id');
  v_label text;
  v_summary text;
  v_details jsonb := '{}'::jsonb;
  v_changed_sections jsonb := '[]'::jsonb;
begin
  if v_owner is null then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;

  if v_actor is not null then
    select email into v_mail from public.app_users where user_id=v_actor limit 1;
  end if;

  if tg_table_name='app_settings' then
    v_label := 'Configuración global';
    if tg_op='UPDATE' then
      select coalesce(jsonb_agg(key order by key),'[]'::jsonb)
        into v_changed_sections
      from (
        select key from (
          select jsonb_object_keys(coalesce(v_before->'config','{}'::jsonb)) as key
          union
          select jsonb_object_keys(coalesce(v_after->'config','{}'::jsonb)) as key
        ) keys
        where (v_before->'config'->key) is distinct from (v_after->'config'->key)
      ) changed;
    elsif tg_op='INSERT' then
      select coalesce(jsonb_agg(key order by key),'[]'::jsonb)
        into v_changed_sections
      from jsonb_object_keys(coalesce(v_after->'config','{}'::jsonb)) as key;
    end if;
    v_details := jsonb_build_object('changed_sections',v_changed_sections,'schema_version',v_row->>'schema_version');
  elsif tg_table_name='entity_alias_rules' then
    v_label := coalesce(v_row->>'alias','Alias');
    v_details := jsonb_strip_nulls(jsonb_build_object(
      'entity_type',v_row->>'entity_type','alias',v_row->>'alias',
      'target_entity_id',v_row->>'target_entity_id','priority',v_row->>'priority','active',v_row->>'active'
    ));
  elsif tg_table_name='shipping_rules' then
    v_label := coalesce(v_row->>'name','Regla de envío');
    v_details := jsonb_strip_nulls(jsonb_build_object(
      'name',v_row->>'name','priority',v_row->>'priority','active',v_row->>'active'
    ));
  elsif tg_table_name='automation_rules' then
    v_label := coalesce(v_row->>'rule_key','Automatización');
    v_details := jsonb_strip_nulls(jsonb_build_object(
      'rule_key',v_row->>'rule_key','enabled',v_row->>'enabled'
    ));
  else
    if tg_op='DELETE' then return old; else return new; end if;
  end if;

  v_summary := case tg_op
    when 'INSERT' then 'Creó '
    when 'UPDATE' then 'Modificó '
    else 'Eliminó '
  end || lower(v_label);

  insert into public.audit_logs(
    workspace_owner_id,actor_user_id,actor_email,module,action,
    entity_type,entity_id,entity_label,summary,details
  ) values (
    v_owner,v_actor,v_mail,'settings',v_action,tg_table_name,
    v_entity_id,v_label,v_summary,v_details
  );

  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;


--
-- Name: mfa_allowed(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.mfa_allowed() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$ select true $$;


--
-- Name: sync_supplier_profile_from_invoice(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.sync_supplier_profile_from_invoice() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_category_name text;
  v_effective_category_id uuid := new.expense_category_id;
  v_inferred_type text;
  v_text text := coalesce(new.ocr_text, '');
begin
  if new.supplier_id is null or new.expense_category_id is null then
    return new;
  end if;

  if v_text ~* '(google[[:space:]]+(cloud|workspace)|shopify|software|subscription|suscripci[oó]n|hosting|saas)' then
    select id into v_effective_category_id
    from public.expense_categories
    where owner_id = (select owner_id from public.suppliers where id = new.supplier_id)
      and lower(name) = lower('Software y suscripciones')
    limit 1;
  elsif v_text ~* '(fedex|sendcloud|correos[[:space:]]+express|mrw|transporte|log[ií]stica|shipping|freight|courier|portes?|env[ií]o)' then
    select id into v_effective_category_id
    from public.expense_categories
    where owner_id = (select owner_id from public.suppliers where id = new.supplier_id)
      and lower(name) = lower('Transporte y logística')
    limit 1;
  elsif v_text ~* '(honorarios|asesor[ií]a|gestor[ií]a|consultor[ií]a|servicios?[[:space:]]+profesionales?|gesti[oó]n/asesor[ií]a)' then
    select id into v_effective_category_id
    from public.expense_categories
    where owner_id = (select owner_id from public.suppliers where id = new.supplier_id)
      and lower(name) = lower('Servicios profesionales')
    limit 1;
  elsif v_text ~* '(google[[:space:]]+ads|meta[[:space:]]+ads|publicidad|marketing|campa[nñ]a)' then
    select id into v_effective_category_id
    from public.expense_categories
    where owner_id = (select owner_id from public.suppliers where id = new.supplier_id)
      and lower(name) = lower('Publicidad y marketing')
    limit 1;
  end if;

  v_effective_category_id := coalesce(v_effective_category_id, new.expense_category_id);
  select name into v_category_name
  from public.expense_categories
  where id = v_effective_category_id;

  if v_category_name is null then
    return new;
  end if;

  v_inferred_type := case
    when lower(v_category_name) like '%mercanc%' then 'goods'
    else 'service'
  end;

  update public.suppliers s
  set
    default_category_id = coalesce(s.default_category_id, v_effective_category_id),
    supplier_type = case
      when s.default_category_id is null then v_inferred_type
      when s.supplier_type = 'both' then 'both'
      when s.supplier_type <> v_inferred_type then 'both'
      else s.supplier_type
    end,
    updated_at = now()
  where s.id = new.supplier_id;

  return new;
end;
$$;


--
-- Name: bootstrap_expense_categories(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bootstrap_expense_categories() RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare v_owner uuid := private.app_workspace_owner_id();
begin
  if v_owner is null then raise exception 'Access not configured'; end if;
  if exists(select 1 from public.expense_categories where owner_id=v_owner) then return; end if;
  if not private.app_is_admin() then return; end if;
  insert into public.expense_categories(owner_id,name,sort_order) values
    (v_owner,'Mercancía',10),(v_owner,'Transporte y logística',20),(v_owner,'Publicidad y marketing',30),(v_owner,'Software y suscripciones',40),(v_owner,'Embalaje y consumibles',50),(v_owner,'Servicios profesionales',60),(v_owner,'Suministros',70),(v_owner,'Viajes y dietas',80),(v_owner,'Comisiones marketplaces',90),(v_owner,'Otros',100)
  on conflict(owner_id,name) do nothing;
end; $$;


--
-- Name: capture_confirmed_product_price(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.capture_confirmed_product_price() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_supplier_id uuid;
  v_issue_date date;
  v_currency text;
  v_base_unit text;
  v_latest_cost numeric;
  v_previous_cost numeric;
  v_latest_supplier_id uuid;
  v_latest_date date;
  v_latest_base_unit text;
begin
  if new.product_id is not null
     and new.price_update_status = 'confirmed'
     and new.normalized_unit_price is not null
     and (
       tg_op = 'INSERT'
       or old.price_update_status is distinct from 'confirmed'
       or old.normalized_unit_price is distinct from new.normalized_unit_price
     ) then

    select i.supplier_id, coalesce(i.issue_date, i.received_date), i.currency
      into v_supplier_id, v_issue_date, v_currency
    from public.invoices i
    where i.id = new.invoice_id;

    select p.base_unit into v_base_unit
    from public.products p
    where p.id = new.product_id;

    insert into public.product_price_history (
      owner_id, product_id, supplier_id, invoice_id, invoice_line_id,
      price_date, purchase_unit_price, normalized_unit_price, base_unit, currency
    ) values (
      new.owner_id, new.product_id, v_supplier_id, new.invoice_id, new.id,
      coalesce(v_issue_date, current_date), new.unit_price, new.normalized_unit_price,
      coalesce(v_base_unit, new.unit, 'ud'), coalesce(v_currency, 'EUR')
    )
    on conflict (invoice_line_id) do update set
      supplier_id = excluded.supplier_id,
      price_date = excluded.price_date,
      purchase_unit_price = excluded.purchase_unit_price,
      normalized_unit_price = excluded.normalized_unit_price,
      base_unit = excluded.base_unit,
      currency = excluded.currency;

    select h.normalized_unit_price, h.supplier_id, h.price_date, h.base_unit
      into v_latest_cost, v_latest_supplier_id, v_latest_date, v_latest_base_unit
    from public.product_price_history h
    where h.product_id = new.product_id
      and h.owner_id = new.owner_id
      and h.normalized_unit_price is not null
    order by h.price_date desc, h.created_at desc, h.id desc
    limit 1;

    v_previous_cost := null;
    select h.normalized_unit_price
      into v_previous_cost
    from public.product_price_history h
    where h.product_id = new.product_id
      and h.owner_id = new.owner_id
      and h.normalized_unit_price is not null
    order by h.price_date desc, h.created_at desc, h.id desc
    offset 1
    limit 1;

    update public.products p
       set previous_cost = v_previous_cost,
           last_cost = v_latest_cost,
           cost_unit = coalesce(v_latest_base_unit, v_base_unit, new.unit, 'ud'),
           last_supplier_id = v_latest_supplier_id,
           last_purchase_date = v_latest_date,
           updated_at = now()
     where p.id = new.product_id
       and p.owner_id = new.owner_id;
  end if;

  return new;
end;
$$;


--
-- Name: set_invoice_period(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_invoice_period() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if new.issue_date is not null then
    new.fiscal_year := extract(year from new.issue_date)::integer;
    new.fiscal_quarter := extract(quarter from new.issue_date)::smallint;
  else
    new.fiscal_year := null;
    new.fiscal_quarter := null;
  end if;
  return new;
end;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: sync_invoice_supplier_to_products(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_invoice_supplier_to_products() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_issue_date date;
begin
  if new.supplier_id is null or new.supplier_id is not distinct from old.supplier_id then
    return new;
  end if;

  v_issue_date := coalesce(new.issue_date, new.received_date, current_date);

  update public.product_price_history h
     set supplier_id = new.supplier_id
   where h.invoice_id = new.id
     and h.supplier_id is distinct from new.supplier_id;

  update public.products p
     set last_supplier_id = new.supplier_id,
         last_purchase_date = case
           when p.last_purchase_date is null or v_issue_date >= p.last_purchase_date then v_issue_date
           else p.last_purchase_date
         end,
         updated_at = now()
   where exists (
     select 1
     from public.invoice_lines il
     where il.invoice_id = new.id
       and il.product_id = p.id
       and il.owner_id = p.owner_id
   )
     and (p.last_purchase_date is null or v_issue_date >= p.last_purchase_date);

  return new;
end;
$$;


--
-- Name: sync_product_supplier_from_invoice_line(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_product_supplier_from_invoice_line() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_supplier_id uuid;
  v_issue_date date;
begin
  if new.product_id is null then
    return new;
  end if;

  select i.supplier_id, coalesce(i.issue_date, i.received_date, current_date)
    into v_supplier_id, v_issue_date
  from public.invoices i
  where i.id = new.invoice_id;

  if v_supplier_id is null then
    return new;
  end if;

  update public.products p
     set last_supplier_id = v_supplier_id,
         last_purchase_date = case
           when p.last_purchase_date is null or v_issue_date >= p.last_purchase_date then v_issue_date
           else p.last_purchase_date
         end,
         updated_at = now()
   where p.id = new.product_id
     and p.owner_id = new.owner_id
     and (p.last_purchase_date is null or v_issue_date >= p.last_purchase_date);

  update public.product_price_history h
     set supplier_id = v_supplier_id
   where h.invoice_line_id = new.id
     and h.supplier_id is distinct from v_supplier_id;

  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    owner_id uuid DEFAULT private.app_workspace_owner_id() NOT NULL,
    schema_version integer DEFAULT 1 NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_settings_config_check CHECK ((jsonb_typeof(config) = 'object'::text)),
    CONSTRAINT app_settings_schema_version_check CHECK ((schema_version >= 1))
);


--
-- Name: app_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_users (
    user_id uuid NOT NULL,
    email text NOT NULL,
    full_name text,
    role text DEFAULT 'user'::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    data_owner_id uuid NOT NULL,
    permissions text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    workspace_id uuid NOT NULL,
    last_access_at timestamp with time zone
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id bigint NOT NULL,
    workspace_owner_id uuid NOT NULL,
    actor_user_id uuid,
    actor_email text,
    module text NOT NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    entity_label text,
    summary text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: automation_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT private.app_workspace_owner_id() NOT NULL,
    rule_key text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT automation_rules_config_check CHECK ((jsonb_typeof(config) = 'object'::text))
);


--
-- Name: entity_alias_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entity_alias_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT private.app_workspace_owner_id() NOT NULL,
    entity_type text NOT NULL,
    alias text NOT NULL,
    normalized_alias text NOT NULL,
    target_entity_id uuid NOT NULL,
    priority integer DEFAULT 100 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entity_alias_rules_entity_type_check CHECK ((entity_type = ANY (ARRAY['supplier'::text, 'client'::text]))),
    CONSTRAINT entity_alias_rules_priority_check CHECK (((priority >= 0) AND (priority <= 10000)))
);


--
-- Name: expense_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expense_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT private.app_workspace_owner_id() NOT NULL,
    name text NOT NULL,
    icon text,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: gmail_imports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gmail_imports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT private.app_workspace_owner_id() NOT NULL,
    gmail_message_id text NOT NULL,
    gmail_thread_id text,
    sender text,
    subject text,
    received_at timestamp with time zone,
    attachment_name text,
    status text DEFAULT 'found'::text NOT NULL,
    invoice_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    attachment_id text,
    attachment_mime_type text,
    attachment_size integer,
    integration_account_id uuid,
    source_document_id uuid,
    gmail_mailbox_key text,
    attachment_part_id text,
    CONSTRAINT gmail_imports_status_check CHECK ((status = ANY (ARRAY['found'::text, 'imported'::text, 'ignored'::text, 'error'::text])))
);


--
-- Name: invoice_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT private.app_workspace_owner_id() NOT NULL,
    invoice_id uuid NOT NULL,
    product_id uuid,
    supplier_product_id uuid,
    description text NOT NULL,
    supplier_sku text,
    quantity numeric(14,4) DEFAULT 1 NOT NULL,
    unit text,
    units_per_purchase numeric(14,4) DEFAULT 1 NOT NULL,
    unit_price numeric(14,6),
    normalized_unit_price numeric(14,6),
    discount_percent numeric(7,4),
    line_net numeric(14,2),
    tax_rate numeric(7,4),
    tax_amount numeric(14,2),
    line_total numeric(14,2),
    ai_confidence numeric(5,4),
    price_update_status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT invoice_lines_price_update_status_check CHECK ((price_update_status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'ignored'::text]))),
    CONSTRAINT invoice_lines_units_per_purchase_check CHECK ((units_per_purchase > (0)::numeric))
);


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT private.app_workspace_owner_id() NOT NULL,
    supplier_id uuid,
    invoice_number text,
    issue_date date,
    received_date date DEFAULT CURRENT_DATE NOT NULL,
    fiscal_year integer,
    fiscal_quarter smallint,
    currency text DEFAULT 'EUR'::text NOT NULL,
    net_amount numeric(14,2) DEFAULT 0 NOT NULL,
    tax_amount numeric(14,2) DEFAULT 0 NOT NULL,
    withholding_amount numeric(14,2) DEFAULT 0 NOT NULL,
    total_amount numeric(14,2) DEFAULT 0 NOT NULL,
    expense_category_id uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    file_path text,
    file_name text,
    mime_type text,
    file_hash text,
    ocr_text text,
    extraction jsonb DEFAULT '{}'::jsonb NOT NULL,
    extraction_confidence numeric(5,4),
    duplicate_of uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    equivalence_surcharge_amount numeric(14,2) DEFAULT 0 NOT NULL,
    source_document_id uuid,
    payment_status text DEFAULT 'unpaid'::text NOT NULL,
    paid_at date,
    CONSTRAINT invoices_fiscal_quarter_check CHECK (((fiscal_quarter >= 1) AND (fiscal_quarter <= 4))),
    CONSTRAINT invoices_payment_state_date_check CHECK ((((payment_status = 'unpaid'::text) AND (paid_at IS NULL)) OR ((payment_status = 'paid'::text) AND (paid_at IS NOT NULL)))),
    CONSTRAINT invoices_payment_status_check CHECK ((payment_status = ANY (ARRAY['unpaid'::text, 'paid'::text]))),
    CONSTRAINT invoices_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'camera'::text, 'gmail'::text]))),
    CONSTRAINT invoices_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'reviewed'::text, 'accounted'::text])))
);


--
-- Name: product_price_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_price_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT private.app_workspace_owner_id() NOT NULL,
    product_id uuid NOT NULL,
    supplier_id uuid,
    invoice_id uuid,
    invoice_line_id uuid,
    price_date date NOT NULL,
    purchase_unit_price numeric(14,6),
    normalized_unit_price numeric(14,6) NOT NULL,
    base_unit text NOT NULL,
    currency text DEFAULT 'EUR'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT private.app_workspace_owner_id() NOT NULL,
    name text NOT NULL,
    sku text,
    category text,
    base_unit text DEFAULT 'ud'::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    last_cost numeric(14,6),
    previous_cost numeric(14,6),
    cost_unit text,
    last_supplier_id uuid,
    last_purchase_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sale_price numeric(14,4),
    sales_tax_rate numeric(7,4) DEFAULT 21 NOT NULL,
    invoice_description text,
    ean text,
    CONSTRAINT products_sales_tax_rate_check CHECK (((sales_tax_rate >= (0)::numeric) AND (sales_tax_rate <= (100)::numeric)))
);


--
-- Name: source_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.source_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT private.app_workspace_owner_id() NOT NULL,
    storage_bucket text DEFAULT 'invoices'::text NOT NULL,
    storage_path text NOT NULL,
    original_name text,
    mime_type text,
    file_hash text,
    document_kind text DEFAULT 'expense_source'::text NOT NULL,
    source_channel text DEFAULT 'manual'::text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid DEFAULT auth.uid(),
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: supplier_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT private.app_workspace_owner_id() NOT NULL,
    supplier_id uuid NOT NULL,
    product_id uuid NOT NULL,
    supplier_sku text,
    supplier_description text NOT NULL,
    purchase_unit text,
    units_per_purchase numeric(14,4) DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT supplier_products_units_per_purchase_check CHECK ((units_per_purchase > (0)::numeric))
);


--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT private.app_workspace_owner_id() NOT NULL,
    name text NOT NULL,
    tax_id text,
    email text,
    phone text,
    supplier_type text DEFAULT 'unclassified'::text NOT NULL,
    default_category_id uuid,
    notes text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    address text,
    website text,
    CONSTRAINT suppliers_supplier_type_check CHECK ((supplier_type = ANY (ARRAY['unclassified'::text, 'goods'::text, 'service'::text, 'both'::text])))
);


--
-- Name: user_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_preferences (
    user_id uuid NOT NULL,
    owner_id uuid DEFAULT private.app_workspace_owner_id() NOT NULL,
    schema_version integer DEFAULT 1 NOT NULL,
    preferences jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_preferences_preferences_check CHECK ((jsonb_typeof(preferences) = 'object'::text)),
    CONSTRAINT user_preferences_schema_version_check CHECK ((schema_version >= 1))
);


--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    legal_name text,
    status text DEFAULT 'active'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    allow_environment_credentials boolean DEFAULT false NOT NULL
);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (owner_id);


--
-- Name: app_users app_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_users
    ADD CONSTRAINT app_users_pkey PRIMARY KEY (user_id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: automation_rules automation_rules_owner_id_rule_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_rules
    ADD CONSTRAINT automation_rules_owner_id_rule_key_key UNIQUE (owner_id, rule_key);


--
-- Name: automation_rules automation_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_rules
    ADD CONSTRAINT automation_rules_pkey PRIMARY KEY (id);


--
-- Name: entity_alias_rules entity_alias_rules_owner_id_entity_type_normalized_alias_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_alias_rules
    ADD CONSTRAINT entity_alias_rules_owner_id_entity_type_normalized_alias_key UNIQUE (owner_id, entity_type, normalized_alias);


--
-- Name: entity_alias_rules entity_alias_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_alias_rules
    ADD CONSTRAINT entity_alias_rules_pkey PRIMARY KEY (id);


--
-- Name: expense_categories expense_categories_owner_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_categories
    ADD CONSTRAINT expense_categories_owner_id_name_key UNIQUE (owner_id, name);


--
-- Name: expense_categories expense_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_categories
    ADD CONSTRAINT expense_categories_pkey PRIMARY KEY (id);


--
-- Name: gmail_imports gmail_imports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gmail_imports
    ADD CONSTRAINT gmail_imports_pkey PRIMARY KEY (id);


--
-- Name: invoice_lines invoice_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lines
    ADD CONSTRAINT invoice_lines_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: product_price_history product_price_history_invoice_line_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_price_history
    ADD CONSTRAINT product_price_history_invoice_line_id_key UNIQUE (invoice_line_id);


--
-- Name: product_price_history product_price_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_price_history
    ADD CONSTRAINT product_price_history_pkey PRIMARY KEY (id);


--
-- Name: products products_owner_id_sku_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_owner_id_sku_key UNIQUE (owner_id, sku);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: source_documents source_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_documents
    ADD CONSTRAINT source_documents_pkey PRIMARY KEY (id);


--
-- Name: supplier_products supplier_products_owner_id_supplier_id_supplier_description_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_products
    ADD CONSTRAINT supplier_products_owner_id_supplier_id_supplier_description_key UNIQUE (owner_id, supplier_id, supplier_description);


--
-- Name: supplier_products supplier_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_products
    ADD CONSTRAINT supplier_products_pkey PRIMARY KEY (id);


--
-- Name: suppliers suppliers_owner_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_owner_id_name_key UNIQUE (owner_id, name);


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);


--
-- Name: user_preferences user_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (user_id, owner_id);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- Name: workspaces workspaces_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_slug_key UNIQUE (slug);


--
-- Name: automation_rules_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_rules_key_idx ON public.automation_rules USING btree (owner_id, rule_key);


--
-- Name: invoice_lines_invoice_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoice_lines_invoice_idx ON public.invoice_lines USING btree (invoice_id);


--
-- Name: invoice_lines_product_fk_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoice_lines_product_fk_idx ON public.invoice_lines USING btree (product_id);


--
-- Name: invoice_lines_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoice_lines_product_idx ON public.invoice_lines USING btree (owner_id, product_id);


--
-- Name: invoice_lines_supplier_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoice_lines_supplier_product_idx ON public.invoice_lines USING btree (supplier_product_id);


--
-- Name: invoices_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_category_idx ON public.invoices USING btree (expense_category_id);


--
-- Name: invoices_duplicate_of_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_duplicate_of_idx ON public.invoices USING btree (duplicate_of);


--
-- Name: invoices_file_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_file_hash_idx ON public.invoices USING btree (owner_id, file_hash) WHERE (file_hash IS NOT NULL);


--
-- Name: invoices_owner_issue_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_owner_issue_date_idx ON public.invoices USING btree (owner_id, issue_date DESC);


--
-- Name: invoices_owner_payment_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_owner_payment_status_idx ON public.invoices USING btree (owner_id, payment_status, paid_at);


--
-- Name: invoices_owner_quarter_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_owner_quarter_idx ON public.invoices USING btree (owner_id, fiscal_year, fiscal_quarter);


--
-- Name: invoices_source_document_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_source_document_idx ON public.invoices USING btree (owner_id, source_document_id) WHERE (source_document_id IS NOT NULL);


--
-- Name: invoices_supplier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_supplier_idx ON public.invoices USING btree (supplier_id);


--
-- Name: invoices_supplier_number_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX invoices_supplier_number_uidx ON public.invoices USING btree (owner_id, supplier_id, invoice_number) WHERE ((supplier_id IS NOT NULL) AND (invoice_number IS NOT NULL) AND (length(TRIM(BOTH FROM invoice_number)) > 0));


--
-- Name: price_history_invoice_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX price_history_invoice_idx ON public.product_price_history USING btree (invoice_id);


--
-- Name: price_history_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX price_history_product_idx ON public.product_price_history USING btree (product_id);


--
-- Name: price_history_supplier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX price_history_supplier_idx ON public.product_price_history USING btree (supplier_id);


--
-- Name: product_price_history_product_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_price_history_product_date_idx ON public.product_price_history USING btree (owner_id, product_id, price_date DESC, created_at DESC);


--
-- Name: products_last_supplier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_last_supplier_idx ON public.products USING btree (last_supplier_id);


--
-- Name: products_owner_normalized_name_unspecified_sku_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX products_owner_normalized_name_unspecified_sku_uq ON public.products USING btree (owner_id, lower(regexp_replace(name, '[^[:alnum:]]'::text, ''::text, 'g'::text))) WHERE ((sku IS NULL) AND (active = true) AND (name IS NOT NULL));


--
-- Name: source_documents_owner_hash_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX source_documents_owner_hash_uidx ON public.source_documents USING btree (owner_id, file_hash) WHERE ((file_hash IS NOT NULL) AND (length(file_hash) > 0));


--
-- Name: source_documents_owner_path_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX source_documents_owner_path_uidx ON public.source_documents USING btree (owner_id, storage_bucket, storage_path);


--
-- Name: source_documents_owner_received_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX source_documents_owner_received_idx ON public.source_documents USING btree (owner_id, received_at DESC);


--
-- Name: supplier_products_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX supplier_products_product_idx ON public.supplier_products USING btree (product_id);


--
-- Name: supplier_products_supplier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX supplier_products_supplier_idx ON public.supplier_products USING btree (supplier_id);


--
-- Name: suppliers_default_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX suppliers_default_category_idx ON public.suppliers USING btree (default_category_id);


--
-- Name: app_settings app_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER app_settings_updated_at BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: app_settings audit_app_settings; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_app_settings AFTER INSERT OR DELETE OR UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION private.audit_configuration_change();


--
-- Name: automation_rules audit_automation_rules; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_automation_rules AFTER INSERT OR DELETE OR UPDATE ON public.automation_rules FOR EACH ROW EXECUTE FUNCTION private.audit_configuration_change();


--
-- Name: invoices audit_invoices; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_invoices AFTER INSERT OR DELETE OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION private.audit_app_change();


--
-- Name: products audit_products; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_products AFTER INSERT OR DELETE OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION private.audit_app_change();


--
-- Name: suppliers audit_suppliers; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_suppliers AFTER INSERT OR DELETE OR UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION private.audit_app_change();


--
-- Name: automation_rules automation_rules_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER automation_rules_updated_at BEFORE UPDATE ON public.automation_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: expense_categories expense_categories_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER expense_categories_updated_at BEFORE UPDATE ON public.expense_categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: invoice_lines invoice_lines_capture_price; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invoice_lines_capture_price AFTER INSERT OR UPDATE OF price_update_status, normalized_unit_price, unit_price, product_id ON public.invoice_lines FOR EACH ROW EXECUTE FUNCTION public.capture_confirmed_product_price();


--
-- Name: invoice_lines invoice_lines_sync_product_supplier; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invoice_lines_sync_product_supplier AFTER INSERT OR UPDATE OF product_id, invoice_id ON public.invoice_lines FOR EACH ROW EXECUTE FUNCTION public.sync_product_supplier_from_invoice_line();


--
-- Name: invoice_lines invoice_lines_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invoice_lines_updated_at BEFORE UPDATE ON public.invoice_lines FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: invoices invoices_set_period; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invoices_set_period BEFORE INSERT OR UPDATE OF issue_date ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.set_invoice_period();


--
-- Name: invoices invoices_sync_product_supplier; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invoices_sync_product_supplier AFTER UPDATE OF supplier_id ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.sync_invoice_supplier_to_products();


--
-- Name: invoices invoices_sync_supplier_profile; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invoices_sync_supplier_profile AFTER INSERT ON public.invoices FOR EACH ROW EXECUTE FUNCTION private.sync_supplier_profile_from_invoice();


--
-- Name: invoices invoices_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invoices_updated_at BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: products products_default_sale_price; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER products_default_sale_price BEFORE INSERT OR UPDATE OF last_cost, sale_price ON public.products FOR EACH ROW EXECUTE FUNCTION private.apply_default_product_sale_price();


--
-- Name: products products_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: supplier_products supplier_products_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER supplier_products_updated_at BEFORE UPDATE ON public.supplier_products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: suppliers suppliers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER suppliers_updated_at BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: app_settings app_settings_owner_workspace_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_owner_workspace_fkey FOREIGN KEY (owner_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: automation_rules automation_rules_owner_workspace_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_rules
    ADD CONSTRAINT automation_rules_owner_workspace_fkey FOREIGN KEY (owner_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: expense_categories expense_categories_owner_workspace_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_categories
    ADD CONSTRAINT expense_categories_owner_workspace_fkey FOREIGN KEY (owner_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: gmail_imports gmail_imports_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gmail_imports
    ADD CONSTRAINT gmail_imports_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;


--
-- Name: gmail_imports gmail_imports_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gmail_imports
    ADD CONSTRAINT gmail_imports_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: gmail_imports gmail_imports_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gmail_imports
    ADD CONSTRAINT gmail_imports_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.source_documents(id) ON DELETE RESTRICT;


--
-- Name: invoice_lines invoice_lines_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lines
    ADD CONSTRAINT invoice_lines_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: invoice_lines invoice_lines_owner_workspace_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lines
    ADD CONSTRAINT invoice_lines_owner_workspace_fkey FOREIGN KEY (owner_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: invoice_lines invoice_lines_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lines
    ADD CONSTRAINT invoice_lines_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: invoice_lines invoice_lines_supplier_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lines
    ADD CONSTRAINT invoice_lines_supplier_product_id_fkey FOREIGN KEY (supplier_product_id) REFERENCES public.supplier_products(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_duplicate_of_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_duplicate_of_fkey FOREIGN KEY (duplicate_of) REFERENCES public.invoices(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_expense_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_expense_category_id_fkey FOREIGN KEY (expense_category_id) REFERENCES public.expense_categories(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_owner_workspace_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_owner_workspace_fkey FOREIGN KEY (owner_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: invoices invoices_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.source_documents(id) ON DELETE RESTRICT;


--
-- Name: invoices invoices_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;


--
-- Name: product_price_history product_price_history_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_price_history
    ADD CONSTRAINT product_price_history_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;


--
-- Name: product_price_history product_price_history_invoice_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_price_history
    ADD CONSTRAINT product_price_history_invoice_line_id_fkey FOREIGN KEY (invoice_line_id) REFERENCES public.invoice_lines(id) ON DELETE SET NULL;


--
-- Name: product_price_history product_price_history_owner_workspace_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_price_history
    ADD CONSTRAINT product_price_history_owner_workspace_fkey FOREIGN KEY (owner_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: product_price_history product_price_history_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_price_history
    ADD CONSTRAINT product_price_history_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_price_history product_price_history_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_price_history
    ADD CONSTRAINT product_price_history_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;


--
-- Name: products products_last_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_last_supplier_id_fkey FOREIGN KEY (last_supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;


--
-- Name: products products_owner_workspace_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_owner_workspace_fkey FOREIGN KEY (owner_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: supplier_products supplier_products_owner_workspace_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_products
    ADD CONSTRAINT supplier_products_owner_workspace_fkey FOREIGN KEY (owner_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: supplier_products supplier_products_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_products
    ADD CONSTRAINT supplier_products_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: supplier_products supplier_products_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_products
    ADD CONSTRAINT supplier_products_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE CASCADE;


--
-- Name: suppliers suppliers_default_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_default_category_id_fkey FOREIGN KEY (default_category_id) REFERENCES public.expense_categories(id) ON DELETE SET NULL;


--
-- Name: suppliers suppliers_owner_workspace_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_owner_workspace_fkey FOREIGN KEY (owner_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--



-- Triggers de gmail_imports (producción, 19/10/2026)
CREATE OR REPLACE FUNCTION private.preserve_gmail_message_part()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  canonical public.gmail_imports%rowtype;
  peer_mailbox text;
begin
  new.gmail_mailbox_key := nullif(lower(trim(new.metadata->>'gmailAccountEmail')), '');
  if new.gmail_mailbox_key is null and new.integration_account_id is not null then
    select min(g.gmail_mailbox_key) into peer_mailbox
    from public.gmail_imports g where g.owner_id=new.owner_id
      and g.integration_account_id=new.integration_account_id and g.gmail_mailbox_key<>'legacy'
    having count(distinct g.gmail_mailbox_key)=1;
    new.gmail_mailbox_key := coalesce(peer_mailbox, 'integration:' || new.integration_account_id::text);
  end if;
  new.attachment_part_id := nullif(new.metadata->>'partId','');
  if new.gmail_mailbox_key is null and new.attachment_part_id is not null then
    select min(g.gmail_mailbox_key) into peer_mailbox
    from public.gmail_imports g where g.owner_id=new.owner_id and g.gmail_message_id=new.gmail_message_id
      and g.attachment_part_id=new.attachment_part_id and g.gmail_mailbox_key<>'legacy'
    having count(distinct g.gmail_mailbox_key)=1;
    new.gmail_mailbox_key := peer_mailbox;
  end if;
  new.gmail_mailbox_key := coalesce(new.gmail_mailbox_key,'legacy');
  if new.attachment_part_id is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    jsonb_build_array(new.owner_id,new.gmail_mailbox_key,new.gmail_message_id,new.attachment_part_id)::text,0));
  select * into canonical from public.gmail_imports g
  where g.owner_id=new.owner_id and g.gmail_mailbox_key=new.gmail_mailbox_key
    and g.gmail_message_id=new.gmail_message_id and g.attachment_part_id=new.attachment_part_id
  for update;
  if found then
    update public.gmail_imports
    set metadata=coalesce(canonical.metadata,'{}'::jsonb)||coalesce(new.metadata,'{}'::jsonb)
      ||jsonb_build_object('latestAttachmentId',new.attachment_id),
      integration_account_id=coalesce(canonical.integration_account_id,new.integration_account_id)
    where id=canonical.id;
    return null;
  end if;
  return new;
end;
$function$;
CREATE TRIGGER audit_gmail_imports AFTER INSERT OR DELETE OR UPDATE ON public.gmail_imports FOR EACH ROW EXECUTE FUNCTION private.audit_app_change();
CREATE TRIGGER gmail_imports_stable_message_part BEFORE INSERT ON public.gmail_imports FOR EACH ROW EXECUTE FUNCTION private.preserve_gmail_message_part();
CREATE TRIGGER gmail_imports_updated_at BEFORE UPDATE ON public.gmail_imports FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
