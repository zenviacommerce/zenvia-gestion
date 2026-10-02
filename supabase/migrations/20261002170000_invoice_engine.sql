-- InvoiceEngine: metadata, field confidence and correction learning.
-- Additive only: no existing data is deleted or rewritten.

alter table public.suppliers
  add column if not exists iban text;

alter table public.invoices
  add column if not exists invoice_type text,
  add column if not exists invoice_series text,
  add column if not exists due_date date,
  add column if not exists payment_method text,
  add column if not exists order_reference text,
  add column if not exists delivery_note_reference text,
  add column if not exists vat_breakdown jsonb not null default '[]'::jsonb,
  add column if not exists qr_payload text,
  add column if not exists intracommunity boolean not null default false,
  add column if not exists reverse_charge boolean not null default false,
  add column if not exists field_confidence jsonb not null default '{}'::jsonb,
  add column if not exists invoice_engine_run_id uuid;

create table if not exists public.invoice_engine_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default private.app_workspace_owner_id(),
  source_document_id uuid references public.source_documents(id) on delete set null,
  source_channel text not null default 'manual',
  source_name text,
  source_mime_type text,
  page_count integer not null default 1,
  model_provider text,
  model_name text,
  engine_version text not null default 'invoice-engine-v1',
  status text not null default 'completed',
  extraction jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists invoice_engine_runs_owner_created_idx
  on public.invoice_engine_runs(owner_id,created_at desc);

alter table public.invoice_engine_runs enable row level security;

drop policy if exists invoice_engine_runs_workspace_select on public.invoice_engine_runs;
create policy invoice_engine_runs_workspace_select
on public.invoice_engine_runs
for select to authenticated
using (
  owner_id=(select private.app_workspace_owner_id())
  and ((select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail')))
);

drop policy if exists invoice_engine_runs_workspace_insert on public.invoice_engine_runs;
create policy invoice_engine_runs_workspace_insert
on public.invoice_engine_runs
for insert to authenticated
with check (
  owner_id=(select private.app_workspace_owner_id())
  and ((select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail')))
);

revoke update,delete on public.invoice_engine_runs from authenticated;
grant select,insert on public.invoice_engine_runs to authenticated;
grant all on public.invoice_engine_runs to service_role;

create table if not exists public.invoice_engine_examples (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default private.app_workspace_owner_id(),
  supplier_id uuid references public.suppliers(id) on delete cascade,
  supplier_tax_id text,
  supplier_name_key text,
  engine_run_id uuid references public.invoice_engine_runs(id) on delete set null,
  field_name text not null,
  extracted_value jsonb,
  corrected_value jsonb,
  context jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists invoice_engine_examples_owner_supplier_idx
  on public.invoice_engine_examples(owner_id,supplier_id,created_at desc);
create index if not exists invoice_engine_examples_owner_tax_idx
  on public.invoice_engine_examples(owner_id,supplier_tax_id,created_at desc)
  where supplier_tax_id is not null;

alter table public.invoice_engine_examples enable row level security;

drop policy if exists invoice_engine_examples_workspace_select on public.invoice_engine_examples;
create policy invoice_engine_examples_workspace_select
on public.invoice_engine_examples
for select to authenticated
using (
  owner_id=(select private.app_workspace_owner_id())
  and ((select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail')))
);

drop policy if exists invoice_engine_examples_workspace_insert on public.invoice_engine_examples;
create policy invoice_engine_examples_workspace_insert
on public.invoice_engine_examples
for insert to authenticated
with check (
  owner_id=(select private.app_workspace_owner_id())
  and ((select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail')))
);

revoke update,delete on public.invoice_engine_examples from authenticated;
grant select,insert on public.invoice_engine_examples to authenticated;
grant all on public.invoice_engine_examples to service_role;

alter table public.invoices
  drop constraint if exists invoices_invoice_engine_run_id_fkey;
alter table public.invoices
  add constraint invoices_invoice_engine_run_id_fkey
  foreign key(invoice_engine_run_id) references public.invoice_engine_runs(id) on delete set null;

create index if not exists invoices_invoice_engine_run_idx
  on public.invoices(owner_id,invoice_engine_run_id)
  where invoice_engine_run_id is not null;

comment on table public.invoice_engine_runs is
'Immutable execution trace for the unified local/self-hosted InvoiceEngine.';
comment on table public.invoice_engine_examples is
'Corrections accepted by users, scoped by workspace/supplier, used as few-shot hints for future InvoiceEngine runs.';
