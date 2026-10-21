-- PROVISIONAL local filename: Supabase CLI is unavailable in this workspace.
-- Do not apply to production before SQL, affected-row counts and UI review.
-- No authentication helper, existing MFA policy, existing grant or numbering RPC is replaced.

create or replace function private.bank_normalize_iban(p_value text)
returns text language sql immutable set search_path='' as $$
 select upper(regexp_replace(coalesce(p_value,''),'[[:space:]]','','g'))
$$;

create or replace function private.bank_iban_valid(p_value text)
returns boolean language plpgsql immutable set search_path='' as $$
declare
 v text:=private.bank_normalize_iban(p_value); v_lengths jsonb:='{"AD":24,"AE":23,"AL":28,"AT":20,"AZ":28,"BA":20,"BE":16,"BG":22,"BH":22,"BI":27,"BR":29,"BY":28,"CH":21,"CR":22,"CY":28,"CZ":24,"DE":22,"DJ":27,"DK":18,"DO":28,"EE":20,"EG":29,"ES":24,"FI":18,"FK":18,"FO":18,"FR":27,"GB":22,"GE":22,"GI":23,"GL":18,"GR":27,"GT":28,"HN":28,"HR":21,"HU":28,"IE":22,"IL":23,"IQ":23,"IS":26,"IT":27,"JO":30,"KW":30,"KZ":20,"LB":28,"LC":32,"LI":21,"LT":20,"LU":20,"LV":21,"LY":25,"MC":27,"MD":24,"ME":22,"MK":19,"MN":20,"MR":27,"MT":31,"MU":30,"NI":28,"NL":18,"NO":15,"OM":23,"PK":24,"PL":28,"PS":29,"PT":25,"QA":29,"RO":24,"RS":22,"RU":33,"SA":24,"SC":31,"SD":18,"SE":24,"SI":19,"SK":24,"SM":27,"SO":23,"ST":25,"SV":28,"TL":23,"TN":24,"TR":26,"UA":29,"VA":22,"VG":24,"XK":20,"YE":30}';
 v_digits text:=''; v_char text; v_remainder integer:=0; v_pos integer;
begin
 if v !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]+$' or length(v) is distinct from (v_lengths->>left(v,2))::integer then return false; end if;
 v:=substring(v from 5)||left(v,4);
 for v_pos in 1..length(v) loop
  v_char:=substring(v from v_pos for 1);
  v_digits:=v_digits||case when v_char ~ '[A-Z]' then (ascii(v_char)-55)::text else v_char end;
 end loop;
 for v_pos in 1..length(v_digits) loop v_remainder:=(v_remainder*10+substring(v_digits from v_pos for 1)::integer)%97; end loop;
 return v_remainder=1;
end $$;

create table if not exists public.business_bank_accounts(
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default private.app_workspace_owner_id(),
 alias text not null check(length(btrim(alias)) between 1 and 100),
 iban text not null,
 bic text check(bic is null or bic ~ '^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$'),
 holder text check(holder is null or length(holder)<=200),
 is_default boolean not null default false,
 archived_at timestamptz,
 validation_status text not null default 'valid' check(validation_status in ('valid','needs_review')),
 legacy_source text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(owner_id,id),check(archived_at is null or not is_default)
);
create unique index if not exists business_bank_accounts_one_default on public.business_bank_accounts(owner_id) where is_default and archived_at is null;
create unique index if not exists business_bank_accounts_legacy_source on public.business_bank_accounts(owner_id,legacy_source) where legacy_source is not null;
create index if not exists business_bank_accounts_owner on public.business_bank_accounts(owner_id);

alter table public.sales_invoice_series add column if not exists default_bank_account_id uuid;
alter table public.sales_invoices add column if not exists bank_account_id uuid,
 add column if not exists bank_account_snapshot jsonb,add column if not exists bank_snapshot_source text,
 add column if not exists bank_snapshot_at timestamptz,add column if not exists payment_method_id text;
alter table public.sales_receipts add column if not exists bank_account_id uuid,
 add column if not exists bank_account_snapshot jsonb,add column if not exists bank_snapshot_source text,
 add column if not exists bank_snapshot_at timestamptz,add column if not exists payment_method_id text,
 add column if not exists payment_method text;
do $$begin
 if not exists(select 1 from pg_constraint where conname='sales_series_bank_same_owner' and conrelid='public.sales_invoice_series'::regclass) then
  alter table public.sales_invoice_series add constraint sales_series_bank_same_owner foreign key(owner_id,default_bank_account_id) references public.business_bank_accounts(owner_id,id);
 end if;
 if not exists(select 1 from pg_constraint where conname='sales_invoice_bank_same_owner' and conrelid='public.sales_invoices'::regclass) then
  alter table public.sales_invoices add constraint sales_invoice_bank_same_owner foreign key(owner_id,bank_account_id) references public.business_bank_accounts(owner_id,id);
 end if;
 if not exists(select 1 from pg_constraint where conname='sales_receipt_bank_same_owner' and conrelid='public.sales_receipts'::regclass) then
  alter table public.sales_receipts add constraint sales_receipt_bank_same_owner foreign key(owner_id,bank_account_id) references public.business_bank_accounts(owner_id,id);
 end if;
end $$;

-- Keep the original setting untouched, including invalid legacy strings.
insert into public.business_bank_accounts(owner_id,alias,iban,is_default,validation_status,legacy_source)
select b.owner_id,'Cuenta principal',case when private.bank_iban_valid(b.iban) then private.bank_normalize_iban(b.iban) else b.iban end,
 not exists(select 1 from public.business_bank_accounts a where a.owner_id=b.owner_id and a.is_default and a.archived_at is null),
 case when private.bank_iban_valid(b.iban) then 'valid' else 'needs_review' end,'business_settings.iban'
from public.business_settings b
where b.iban is not null and btrim(b.iban)<>''
 and not exists(select 1 from public.business_bank_accounts a where a.owner_id=b.owner_id and a.legacy_source='business_settings.iban')
on conflict do nothing;

-- Preserve exactly what today's invoice PDF would render, not an unknown original IBAN.
update public.sales_invoices as i
set bank_account_snapshot=jsonb_build_object('version',1,'accountId',null,'alias','Cuenta bancaria de configuración anterior','iban',b.iban,'bic',null,'holder',null),
 bank_snapshot_source='legacy_current_render',bank_snapshot_at=transaction_timestamp()
from public.business_settings as b
where b.owner_id=i.owner_id and (i.status<>'draft' or i.reserved_number is not null) and i.bank_account_snapshot is null and i.bank_snapshot_source is null
 and b.iban is not null and b.iban<>'';
update public.sales_invoices as i set bank_snapshot_source='legacy_missing',bank_snapshot_at=transaction_timestamp()
where (i.status<>'draft' or i.reserved_number is not null) and i.bank_account_snapshot is null and i.bank_snapshot_source is null;
update public.sales_receipts as r set bank_snapshot_source='legacy_missing',bank_snapshot_at=transaction_timestamp()
where r.bank_account_snapshot is null and r.bank_snapshot_source is null;

alter table public.business_bank_accounts enable row level security;
grant select,insert,update on public.business_bank_accounts to authenticated;
revoke all on public.business_bank_accounts from anon;
drop policy if exists business_bank_accounts_read on public.business_bank_accounts;
create policy business_bank_accounts_read on public.business_bank_accounts for select to authenticated
 using(owner_id=(select private.app_workspace_owner_id()) and ((select private.app_is_admin()) or (select private.app_has_permission('sales')) or (select private.app_has_permission('clients'))));
drop policy if exists business_bank_accounts_insert on public.business_bank_accounts;
create policy business_bank_accounts_insert on public.business_bank_accounts for insert to authenticated
 with check(owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_admin()));
drop policy if exists business_bank_accounts_update on public.business_bank_accounts;
create policy business_bank_accounts_update on public.business_bank_accounts for update to authenticated
 using(owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_admin()))
 with check(owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_admin()));
drop policy if exists mfa_select_gate on public.business_bank_accounts;
create policy mfa_select_gate on public.business_bank_accounts as restrictive for select to authenticated using((select private.mfa_allowed()));
drop policy if exists mfa_insert_gate on public.business_bank_accounts;
create policy mfa_insert_gate on public.business_bank_accounts as restrictive for insert to authenticated with check((select private.mfa_allowed()));
drop policy if exists mfa_update_gate on public.business_bank_accounts;
create policy mfa_update_gate on public.business_bank_accounts as restrictive for update to authenticated using((select private.mfa_allowed())) with check((select private.mfa_allowed()));
drop policy if exists mfa_delete_gate on public.business_bank_accounts;
create policy mfa_delete_gate on public.business_bank_accounts as restrictive for delete to authenticated using((select private.mfa_allowed()));

create or replace function private.bank_account_guard()
returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Archiva la cuenta bancaria para conservar los documentos.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.owner_id::text||':business-bank-accounts',0));
 if tg_op='UPDATE' and (new.owner_id is distinct from old.owner_id or new.id is distinct from old.id or new.legacy_source is distinct from old.legacy_source) then raise exception 'La empresa y el origen de la cuenta no se pueden modificar.'; end if;
 if tg_op='INSERT' and new.legacy_source is not null then raise exception 'El origen de migración de la cuenta no es editable.'; end if;
 new.alias:=btrim(new.alias);new.bic:=nullif(upper(btrim(new.bic)),'');new.holder:=nullif(btrim(new.holder),'');
 if tg_op='INSERT' or new.iban is distinct from old.iban or new.validation_status is distinct from old.validation_status then
  if not private.bank_iban_valid(new.iban) then raise exception 'El IBAN no es válido.'; end if;
  new.iban:=private.bank_normalize_iban(new.iban);new.validation_status:='valid';
 end if;
 if new.validation_status='valid' and not private.bank_iban_valid(new.iban) then raise exception 'El IBAN no es válido.'; end if;
 new.updated_at:=now();return new;
end $$;
drop trigger if exists business_bank_accounts_guard on public.business_bank_accounts;
create trigger business_bank_accounts_guard before insert or update or delete on public.business_bank_accounts for each row execute function private.bank_account_guard();

create or replace function private.bank_account_default_check()
returns trigger language plpgsql set search_path='' as $$
declare v_owner uuid:=coalesce(new.owner_id,old.owner_id);
begin
 if exists(select 1 from public.business_bank_accounts where owner_id=v_owner and archived_at is null)
 and not exists(select 1 from public.business_bank_accounts where owner_id=v_owner and archived_at is null and is_default) then
  raise exception 'Debe haber una cuenta bancaria predeterminada.';
 end if;return null;
end $$;
drop trigger if exists business_bank_accounts_default_check on public.business_bank_accounts;
create constraint trigger business_bank_accounts_default_check after insert or update or delete on public.business_bank_accounts deferrable initially deferred for each row execute function private.bank_account_default_check();

create or replace function public.save_business_bank_account(p_id uuid,p_alias text,p_iban text,p_bic text,p_holder text,p_is_default boolean)
returns public.business_bank_accounts language plpgsql security invoker set search_path='' as $$
declare v_owner uuid:=private.app_workspace_owner_id();v_account public.business_bank_accounts%rowtype;v_default boolean;
begin
 if auth.uid() is null or not private.app_is_admin() or not private.mfa_allowed() then raise exception 'Sin permiso para gestionar cuentas bancarias.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text||':business-bank-accounts',0));
 if p_id is not null then
  select * into v_account from public.business_bank_accounts where id=p_id and owner_id=v_owner and archived_at is null for update;
  if v_account.id is null then raise exception 'Cuenta bancaria no disponible.'; end if;
 end if;
 v_default:=coalesce(p_is_default,false) or coalesce(v_account.is_default,false) or not exists(select 1 from public.business_bank_accounts where owner_id=v_owner and archived_at is null and is_default and validation_status='valid');
 if v_default then update public.business_bank_accounts set is_default=false where owner_id=v_owner and is_default and id is distinct from p_id; end if;
 if p_id is null then
  insert into public.business_bank_accounts(owner_id,alias,iban,bic,holder,is_default) values(v_owner,p_alias,p_iban,p_bic,p_holder,v_default) returning * into v_account;
 else
  update public.business_bank_accounts set alias=p_alias,iban=p_iban,bic=p_bic,holder=p_holder,is_default=v_default where id=p_id and owner_id=v_owner returning * into v_account;
 end if;return v_account;
end $$;

create or replace function public.set_default_business_bank_account(p_account_id uuid)
returns public.business_bank_accounts language plpgsql security invoker set search_path='' as $$
declare v_owner uuid:=private.app_workspace_owner_id();v_account public.business_bank_accounts%rowtype;
begin
 if auth.uid() is null or not private.app_is_admin() or not private.mfa_allowed() then raise exception 'Sin permiso para gestionar cuentas bancarias.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text||':business-bank-accounts',0));
 select * into v_account from public.business_bank_accounts where id=p_account_id and owner_id=v_owner and archived_at is null and validation_status='valid' for update;
 if v_account.id is null then raise exception 'Cuenta bancaria no disponible.'; end if;
 update public.business_bank_accounts set is_default=false where owner_id=v_owner and is_default and id<>p_account_id;
 update public.business_bank_accounts set is_default=true where owner_id=v_owner and id=p_account_id returning * into v_account;return v_account;
end $$;

create or replace function public.archive_business_bank_account(p_account_id uuid,p_replacement_default_id uuid default null)
returns void language plpgsql security invoker set search_path='' as $$
declare v_owner uuid:=private.app_workspace_owner_id();v_account public.business_bank_accounts%rowtype;v_replacement uuid;
begin
 if auth.uid() is null or not private.app_is_admin() or not private.mfa_allowed() then raise exception 'Sin permiso para gestionar cuentas bancarias.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text||':business-bank-accounts',0));
 select * into v_account from public.business_bank_accounts where owner_id=v_owner and id=p_account_id and archived_at is null for update;
 if v_account.id is null then raise exception 'Cuenta bancaria no disponible.'; end if;
 if p_replacement_default_id is not null then
  select id into v_replacement from public.business_bank_accounts where owner_id=v_owner and id=p_replacement_default_id and id<>p_account_id and archived_at is null and validation_status='valid';
  if v_replacement is null then raise exception 'La cuenta bancaria de sustitución no está disponible.'; end if;
 elsif v_account.is_default then
  select id into v_replacement from public.business_bank_accounts where owner_id=v_owner and id<>p_account_id and archived_at is null order by (validation_status='valid') desc,created_at,id limit 1;
 end if;
 update public.business_bank_accounts set is_default=false,archived_at=now() where owner_id=v_owner and id=p_account_id;
 if v_replacement is not null then
  update public.business_bank_accounts set is_default=false where owner_id=v_owner and is_default;
  update public.business_bank_accounts set is_default=true where owner_id=v_owner and id=v_replacement;
 end if;
end $$;

create or replace function private.bank_document_snapshot()
returns trigger language plpgsql set search_path='' as $$
declare v_account public.business_bank_accounts%rowtype;v_selected uuid;v_transfer boolean;v_capture boolean;v_series uuid;
begin
 if tg_op='UPDATE' and new.owner_id is distinct from old.owner_id then raise exception 'La empresa del documento no se puede modificar.'; end if;
 if tg_op='UPDATE' and old.bank_snapshot_source is not null then
  if new.bank_account_id is distinct from old.bank_account_id or new.bank_account_snapshot is distinct from old.bank_account_snapshot
   or new.bank_snapshot_source is distinct from old.bank_snapshot_source or new.bank_snapshot_at is distinct from old.bank_snapshot_at then raise exception 'La cuenta bancaria guardada en el documento no se puede modificar.'; end if;
  return new;
 end if;
 if new.bank_account_snapshot is not null or new.bank_snapshot_source is not null or new.bank_snapshot_at is not null then raise exception 'La cuenta bancaria del documento la guarda el servidor.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.owner_id::text||':business-bank-accounts',0));
 v_selected:=new.bank_account_id;
 if v_selected is not null and not exists(select 1 from public.business_bank_accounts where owner_id=new.owner_id and id=v_selected and archived_at is null and validation_status='valid') then raise exception 'La cuenta bancaria seleccionada no está disponible.'; end if;
 if tg_table_name='sales_invoices' then v_capture:=new.status<>'draft';v_series:=new.series_id;else v_capture:=true;end if;
 if not v_capture then return new; end if;
 if v_selected is null and v_series is not null then
  select a.id into v_selected from public.sales_invoice_series s join public.business_bank_accounts a on a.owner_id=s.owner_id and a.id=s.default_bank_account_id
   where s.id=v_series and s.owner_id=new.owner_id and a.archived_at is null and a.validation_status='valid';
 end if;
 if v_selected is null then select id into v_selected from public.business_bank_accounts where owner_id=new.owner_id and is_default and archived_at is null and validation_status='valid';end if;
 -- Existing documents stored display labels. New documents carry stable method IDs.
 v_transfer:=new.payment_method_id='bank_transfer' or (new.payment_method_id is null and lower(btrim(coalesce(new.payment_method,''))) in ('transferencia bancaria','transferencia','bank transfer'));
 if v_selected is null and coalesce(v_transfer,false) then raise exception 'Falta una cuenta bancaria en Configuración → General';end if;
 if v_selected is not null then
  select * into v_account from public.business_bank_accounts where owner_id=new.owner_id and id=v_selected and archived_at is null and validation_status='valid';
  new.bank_account_id:=v_account.id;
  new.bank_account_snapshot:=jsonb_build_object('version',1,'accountId',v_account.id,'alias',v_account.alias,'iban',v_account.iban,'bic',v_account.bic,'holder',v_account.holder);
 end if;
 new.bank_snapshot_source:=case when tg_table_name='sales_receipts' then 'receipt_created' else 'issued' end;
 new.bank_snapshot_at:=transaction_timestamp();return new;
end $$;
drop trigger if exists sales_invoice_bank_snapshot on public.sales_invoices;
create trigger sales_invoice_bank_snapshot before insert or update on public.sales_invoices for each row execute function private.bank_document_snapshot();
drop trigger if exists sales_receipt_bank_snapshot on public.sales_receipts;
create trigger sales_receipt_bank_snapshot before insert or update on public.sales_receipts for each row execute function private.bank_document_snapshot();

-- Preserve the six-argument Shopify RPC and its exact fiscal/numbering behavior.
-- Insert the bank selection BEFORE its existing issue call, in the same transaction.
do $patch$
declare v_oid regprocedure:=to_regprocedure('public.save_shopify_order_invoice(uuid,jsonb,uuid,date,jsonb,boolean)');v_sql text;v_anchor text:='if p_issue then perform public.issue_sales_invoice(v_invoice.id); end if;';
begin
 if v_oid is not null then
  select pg_get_functiondef(v_oid) into v_sql;
  if position('bank_account_id' in v_sql)=0 then
   if position(v_anchor in v_sql)=0 then raise exception 'Shopify invoice function changed: inspect bank patch before applying.'; end if;
   v_sql:=replace(v_sql,v_anchor,$body$update public.sales_invoices set bank_account_id=case when p_client ? 'bankAccountId' then nullif(p_client->>'bankAccountId','')::uuid else bank_account_id end,payment_method_id=nullif(p_client->>'paymentMethodId',''),payment_method=nullif(p_client->>'paymentMethod','') where id=v_invoice.id and status='draft';
  if p_issue then perform public.issue_sales_invoice(v_invoice.id); end if;$body$);
   execute v_sql;
  end if;
 end if;
end $patch$;

revoke all on function public.save_business_bank_account(uuid,text,text,text,text,boolean),public.set_default_business_bank_account(uuid),public.archive_business_bank_account(uuid,uuid) from public,anon;
grant execute on function public.save_business_bank_account(uuid,text,text,text,text,boolean),public.set_default_business_bank_account(uuid),public.archive_business_bank_account(uuid,uuid) to authenticated;
revoke all on function private.bank_normalize_iban(text),private.bank_iban_valid(text),private.bank_account_guard(),private.bank_account_default_check(),private.bank_document_snapshot() from public,anon;
grant execute on function private.bank_normalize_iban(text),private.bank_iban_valid(text) to authenticated;
