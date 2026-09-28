-- Internal sales receipts / pending charges.
-- These documents are operational records, not VAT invoices. They retain the
-- tax rate to use later when converting the pending receipt into a sales invoice.

create table if not exists public.sales_receipt_counters (
  owner_id uuid not null references auth.users(id) on delete cascade default private.app_workspace_owner_id(),
  year integer not null,
  next_number integer not null default 1 check (next_number > 0),
  primary key(owner_id,year)
);

create table if not exists public.sales_receipts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default private.app_workspace_owner_id(),
  client_id uuid not null references public.clients(id) on delete restrict,
  receipt_number text not null,
  receipt_date date not null default current_date,
  currency text not null default 'EUR',
  notes text,
  total_amount numeric(14,2) not null default 0,
  invoice_id uuid references public.sales_invoices(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,receipt_number)
);

create index if not exists sales_receipts_owner_date_idx on public.sales_receipts(owner_id,receipt_date desc);
create index if not exists sales_receipts_client_idx on public.sales_receipts(client_id,receipt_date desc);
create index if not exists sales_receipts_invoice_idx on public.sales_receipts(invoice_id) where invoice_id is not null;

create table if not exists public.sales_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default private.app_workspace_owner_id(),
  receipt_id uuid not null references public.sales_receipts(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  position integer not null default 1,
  description text not null,
  quantity numeric(14,3) not null default 1 check (quantity > 0),
  unit text not null default 'ud',
  unit_price numeric(14,4) not null default 0,
  discount_percent numeric(7,4) not null default 0 check (discount_percent between 0 and 100),
  invoice_tax_rate numeric(7,4) not null default 21 check (invoice_tax_rate between 0 and 100),
  line_total numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sales_receipt_lines_receipt_idx on public.sales_receipt_lines(receipt_id,position);

create or replace function private.assign_sales_receipt_number()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
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
$$;

create or replace function private.sales_receipt_line_calculate()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  new.line_total:=round(new.quantity*new.unit_price*(1-new.discount_percent/100),2);
  return new;
end;
$$;

create or replace function private.recalculate_sales_receipt_total()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_receipt_id uuid;
begin
  v_receipt_id:=case when tg_op='DELETE' then old.receipt_id else new.receipt_id end;
  update public.sales_receipts
  set total_amount=coalesce((select round(sum(line_total),2) from public.sales_receipt_lines where receipt_id=v_receipt_id),0)
  where id=v_receipt_id;
  return coalesce(new,old);
end;
$$;

drop trigger if exists sales_receipts_assign_number on public.sales_receipts;
create trigger sales_receipts_assign_number before insert on public.sales_receipts
for each row execute function private.assign_sales_receipt_number();

drop trigger if exists sales_receipts_updated_at on public.sales_receipts;
create trigger sales_receipts_updated_at before update on public.sales_receipts
for each row execute function public.set_updated_at();

drop trigger if exists sales_receipt_lines_updated_at on public.sales_receipt_lines;
create trigger sales_receipt_lines_updated_at before update on public.sales_receipt_lines
for each row execute function public.set_updated_at();

drop trigger if exists sales_receipt_lines_calculate on public.sales_receipt_lines;
create trigger sales_receipt_lines_calculate before insert or update on public.sales_receipt_lines
for each row execute function private.sales_receipt_line_calculate();

drop trigger if exists sales_receipt_lines_recalc on public.sales_receipt_lines;
create trigger sales_receipt_lines_recalc after insert or update or delete on public.sales_receipt_lines
for each row execute function private.recalculate_sales_receipt_total();

alter table public.sales_receipt_counters enable row level security;
alter table public.sales_receipts enable row level security;
alter table public.sales_receipt_lines enable row level security;

revoke all on public.sales_receipt_counters,public.sales_receipts,public.sales_receipt_lines from anon;
grant select,insert,update,delete on public.sales_receipt_counters,public.sales_receipts,public.sales_receipt_lines to authenticated;

drop policy if exists sales_receipt_counters_workspace_all on public.sales_receipt_counters;
create policy sales_receipt_counters_workspace_all on public.sales_receipt_counters for all to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')))
with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')));

drop policy if exists sales_receipts_workspace_all on public.sales_receipts;
create policy sales_receipts_workspace_all on public.sales_receipts for all to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')))
with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')));

drop policy if exists sales_receipt_lines_workspace_all on public.sales_receipt_lines;
create policy sales_receipt_lines_workspace_all on public.sales_receipt_lines for all to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')))
with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')));

revoke all on function private.assign_sales_receipt_number() from public,anon,authenticated;
revoke all on function private.sales_receipt_line_calculate() from public,anon,authenticated;
revoke all on function private.recalculate_sales_receipt_total() from public,anon,authenticated;

notify pgrst,'reload schema';
