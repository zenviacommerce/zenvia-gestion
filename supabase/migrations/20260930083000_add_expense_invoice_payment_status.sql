alter table public.invoices
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists paid_at date;

alter table public.invoices
  drop constraint if exists invoices_payment_status_check,
  add constraint invoices_payment_status_check
    check (payment_status = any (array['unpaid'::text,'paid'::text]));

alter table public.invoices
  drop constraint if exists invoices_payment_state_date_check,
  add constraint invoices_payment_state_date_check
    check (
      (payment_status='unpaid' and paid_at is null)
      or
      (payment_status='paid' and paid_at is not null)
    );

create index if not exists invoices_owner_payment_status_idx
  on public.invoices(owner_id,payment_status,paid_at);

comment on column public.invoices.payment_status is
  'Payment lifecycle for supplier expense invoices. Independent from accounting review/status.';
comment on column public.invoices.paid_at is
  'Date on which the supplier expense invoice was paid. Null while unpaid.';
