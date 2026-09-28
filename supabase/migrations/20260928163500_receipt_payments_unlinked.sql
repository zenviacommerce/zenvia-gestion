-- Receipts have their own collection lifecycle and are intentionally not
-- linked to invoices. A receipt can be paid before or after invoicing, and
-- several receipts may later be used to prepare one invoice without changing
-- the receipt itself.

drop index if exists public.sales_receipts_invoice_idx;
alter table public.sales_receipts drop column if exists invoice_id;

create table if not exists public.sales_receipt_payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default private.app_workspace_owner_id(),
  receipt_id uuid not null references public.sales_receipts(id) on delete cascade,
  payment_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  method text,
  reference text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists sales_receipt_payments_receipt_idx
  on public.sales_receipt_payments(receipt_id,payment_date);



create or replace function private.guard_sales_receipt_payment()
returns trigger
language plpgsql
set search_path=''
as $function$
declare
  v_total numeric;
  v_paid numeric;
begin
  select total_amount into v_total from public.sales_receipts where id=new.receipt_id;
  if v_total is null then raise exception 'Recibo no encontrado.'; end if;

  select coalesce(sum(amount),0) into v_paid
  from public.sales_receipt_payments
  where receipt_id=new.receipt_id
    and (tg_op='INSERT' or id<>new.id);

  if v_paid+new.amount > v_total+0.005 then
    raise exception 'El cobro no puede superar el importe pendiente del recibo.';
  end if;
  return new;
end;
$function$;

drop trigger if exists sales_receipt_payments_guard on public.sales_receipt_payments;
create trigger sales_receipt_payments_guard
before insert or update on public.sales_receipt_payments
for each row execute function private.guard_sales_receipt_payment();

alter table public.sales_receipt_payments enable row level security;
revoke all on public.sales_receipt_payments from anon;
grant select,insert,update,delete on public.sales_receipt_payments to authenticated;

drop policy if exists sales_receipt_payments_workspace_all on public.sales_receipt_payments;
create policy sales_receipt_payments_workspace_all on public.sales_receipt_payments for all to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')))
with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')));

revoke all on function private.guard_sales_receipt_payment() from public,anon,authenticated;

notify pgrst,'reload schema';
