-- Gmail identifies attachments by attachment_id, not by their filename.
-- Keep the existing identity constraint before removing the obsolete filename rule.
create unique index if not exists gmail_imports_owner_message_attachment_uidx
  on public.gmail_imports (owner_id, gmail_message_id, attachment_id);

alter table public.gmail_imports
  drop constraint if exists gmail_imports_owner_id_gmail_message_id_attachment_name_key;
