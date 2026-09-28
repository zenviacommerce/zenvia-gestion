-- Branding assets are part of every ZENVIA Gestión tenant, including
-- newly provisioned dedicated Supabase projects.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'company-assets','company-assets',false,5*1024*1024,
  array['image/png','image/jpeg','image/webp']::text[]
)
on conflict(id) do update
set file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists company_assets_select on storage.objects;
drop policy if exists company_assets_insert on storage.objects;
drop policy if exists company_assets_update on storage.objects;
drop policy if exists company_assets_delete on storage.objects;

create policy company_assets_select on storage.objects for select to authenticated
using (
  bucket_id='company-assets'
  and (select private.app_storage_folder_in_workspace((storage.foldername(name))[1]))
  and (
    (select private.app_has_permission('sales'))
    or (select private.app_has_permission('clients'))
    or (select private.app_has_permission('dashboard'))
  )
);

create policy company_assets_insert on storage.objects for insert to authenticated
with check (
  bucket_id='company-assets'
  and (storage.foldername(name))[1]=(select private.app_workspace_owner_id())::text
  and (select private.app_has_permission('sales'))
);

create policy company_assets_update on storage.objects for update to authenticated
using (
  bucket_id='company-assets'
  and (select private.app_storage_folder_in_workspace((storage.foldername(name))[1]))
  and (select private.app_has_permission('sales'))
)
with check (
  bucket_id='company-assets'
  and (storage.foldername(name))[1]=(select private.app_workspace_owner_id())::text
  and (select private.app_has_permission('sales'))
);

create policy company_assets_delete on storage.objects for delete to authenticated
using (
  bucket_id='company-assets'
  and (select private.app_storage_folder_in_workspace((storage.foldername(name))[1]))
  and (select private.app_has_permission('sales'))
);

notify pgrst,'reload schema';
