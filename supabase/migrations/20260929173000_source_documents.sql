create table if not exists public.source_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default private.app_workspace_owner_id(),
  storage_bucket text not null default 'invoices',
  storage_path text not null,
  original_name text,
  mime_type text,
  file_hash text,
  document_kind text not null default 'expense_source',
  source_channel text not null default 'manual',
  received_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists source_documents_owner_path_uidx
  on public.source_documents(owner_id,storage_bucket,storage_path);

create unique index if not exists source_documents_owner_hash_uidx
  on public.source_documents(owner_id,file_hash)
  where file_hash is not null and length(file_hash)>0;

create index if not exists source_documents_owner_received_idx
  on public.source_documents(owner_id,received_at desc);

alter table public.source_documents enable row level security;

drop policy if exists source_documents_workspace_select on public.source_documents;
create policy source_documents_workspace_select
on public.source_documents
for select
to authenticated
using (
  owner_id=(select private.app_workspace_owner_id())
  and (
    (select private.app_has_permission('dashboard'))
    or (select private.app_has_permission('invoices'))
    or (select private.app_has_permission('gmail'))
  )
);

drop policy if exists source_documents_workspace_insert on public.source_documents;
create policy source_documents_workspace_insert
on public.source_documents
for insert
to authenticated
with check (
  owner_id=(select private.app_workspace_owner_id())
  and (
    (select private.app_has_permission('invoices'))
    or (select private.app_has_permission('gmail'))
  )
);

revoke update,delete on public.source_documents from authenticated;
grant select,insert on public.source_documents to authenticated;
grant all on public.source_documents to service_role;

alter table public.invoices
  add column if not exists source_document_id uuid references public.source_documents(id) on delete restrict;

alter table public.gmail_imports
  add column if not exists source_document_id uuid references public.source_documents(id) on delete restrict;

create index if not exists invoices_source_document_idx
  on public.invoices(owner_id,source_document_id)
  where source_document_id is not null;

create index if not exists gmail_imports_source_document_idx
  on public.gmail_imports(owner_id,source_document_id)
  where source_document_id is not null;

-- Un único documento fuente por contenido. Varias facturas/abonos derivados
-- pueden apuntar al mismo original sin duplicar ni borrar la evidencia.
insert into public.source_documents(
  owner_id,storage_bucket,storage_path,original_name,mime_type,file_hash,
  document_kind,source_channel,received_at,metadata,created_at
)
select distinct on (i.owner_id,i.file_hash)
  i.owner_id,
  'invoices',
  i.file_path,
  i.file_name,
  i.mime_type,
  i.file_hash,
  'expense_source',
  i.source,
  coalesce(i.created_at,now()),
  jsonb_build_object('backfilledFrom','invoices'),
  coalesce(i.created_at,now())
from public.invoices i
where i.file_path is not null
  and i.file_hash is not null
  and length(i.file_hash)>0
order by i.owner_id,i.file_hash,i.created_at asc
on conflict do nothing;

insert into public.source_documents(
  owner_id,storage_bucket,storage_path,original_name,mime_type,file_hash,
  document_kind,source_channel,received_at,metadata,created_at
)
select distinct on (i.owner_id,i.file_path)
  i.owner_id,
  'invoices',
  i.file_path,
  i.file_name,
  i.mime_type,
  null,
  'expense_source',
  i.source,
  coalesce(i.created_at,now()),
  jsonb_build_object('backfilledFrom','invoices_without_hash'),
  coalesce(i.created_at,now())
from public.invoices i
where i.file_path is not null
  and (i.file_hash is null or length(i.file_hash)=0)
order by i.owner_id,i.file_path,i.created_at asc
on conflict do nothing;

update public.invoices i
set source_document_id=d.id
from public.source_documents d
where i.source_document_id is null
  and i.owner_id=d.owner_id
  and i.file_hash is not null
  and d.file_hash=i.file_hash;

update public.invoices i
set source_document_id=d.id
from public.source_documents d
where i.source_document_id is null
  and i.owner_id=d.owner_id
  and i.file_path is not null
  and d.storage_bucket='invoices'
  and d.storage_path=i.file_path;

update public.gmail_imports g
set source_document_id=i.source_document_id
from public.invoices i
where g.source_document_id is null
  and g.invoice_id=i.id
  and g.owner_id=i.owner_id
  and i.source_document_id is not null;


-- Conserva también originales históricos que fueron descartados/corregidos
-- pero cuya ruta se dejó registrada en la trazabilidad de Gmail.
insert into public.source_documents(
  owner_id,storage_bucket,storage_path,original_name,mime_type,file_hash,
  document_kind,source_channel,received_at,metadata,created_at
)
select
  g.owner_id,
  'invoices',
  g.metadata->>'orphanedStoragePath',
  g.attachment_name,
  coalesce(g.attachment_mime_type,'application/pdf'),
  null,
  'expense_source',
  'gmail',
  coalesce(g.received_at,g.created_at,now()),
  jsonb_build_object(
    'backfilledFrom','gmail_imports_orphaned_source',
    'gmailImportId',g.id,
    'cleanupReason',g.metadata->>'cleanupReason'
  ),
  coalesce(g.created_at,now())
from public.gmail_imports g
where nullif(g.metadata->>'orphanedStoragePath','') is not null
on conflict do nothing;

update public.gmail_imports g
set source_document_id=d.id
from public.source_documents d
where g.source_document_id is null
  and g.owner_id=d.owner_id
  and nullif(g.metadata->>'orphanedStoragePath','') is not null
  and d.storage_bucket='invoices'
  and d.storage_path=g.metadata->>'orphanedStoragePath';

-- Storage deletion is allowed only for non-archived invoice objects. Once a
-- file is registered in source_documents it becomes immutable evidence.
drop policy if exists invoices_storage_delete on storage.objects;
create policy invoices_storage_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id='invoices'
  and (select private.app_storage_folder_in_workspace((storage.foldername(objects.name))[1]))
  and (select private.app_has_permission('invoices'))
  and not exists (
    select 1
    from public.source_documents d
    where d.owner_id=(select private.app_workspace_owner_id())
      and d.storage_bucket=objects.bucket_id
      and d.storage_path=objects.name
  )
);

comment on table public.source_documents is
'Immutable originals imported into ZENVIA. Business records such as invoices are derived interpretations and may be corrected or deleted without deleting the original document.';
comment on column public.invoices.source_document_id is
'Immutable source document from which this accounting record was derived.';
comment on column public.gmail_imports.source_document_id is
'Immutable Gmail attachment archived before classification/import.';