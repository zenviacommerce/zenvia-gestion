-- Separate optional signature stamp; existing logo metadata is untouched.
alter table public.company_branding add column if not exists stamp_path text;

-- Orders users need to print branding, but cannot manage it without admin rights.
create policy company_branding_orders_select on public.company_branding for select to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('orders')) or (select private.app_is_admin())));

-- Scope the additional permissions strictly to stamp assets; existing logo policies remain.
create policy company_stamp_select on storage.objects for select to authenticated
using (bucket_id='company-assets' and name like '%/branding/stamp-%.png'
 and (select private.app_storage_folder_in_workspace((storage.foldername(name))[1]))
 and ((select private.app_has_permission('orders')) or (select private.app_is_admin())));
create policy company_stamp_insert on storage.objects for insert to authenticated
with check (bucket_id='company-assets' and name like '%/branding/stamp-%.png'
 and (storage.foldername(name))[1]=(select private.app_workspace_owner_id())::text
 and (select private.app_is_admin()));
create policy company_stamp_delete on storage.objects for delete to authenticated
using (bucket_id='company-assets' and name like '%/branding/stamp-%.png'
 and (select private.app_storage_folder_in_workspace((storage.foldername(name))[1]))
 and (select private.app_is_admin()));
-- Existing permissive sales policies must not allow changing a company signature.
-- Non-stamp objects retain their existing authorization behavior.
create policy company_stamp_insert_gate on storage.objects as restrictive for insert to authenticated
with check (bucket_id<>'company-assets' or name not like '%/branding/stamp-%' or
 ((storage.foldername(name))[1]=(select private.app_workspace_owner_id())::text and (select private.app_is_admin())));
create policy company_stamp_update_gate on storage.objects as restrictive for update to authenticated
using (bucket_id<>'company-assets' or name not like '%/branding/stamp-%' or
 ((storage.foldername(name))[1]=(select private.app_workspace_owner_id())::text and (select private.app_is_admin())))
with check (bucket_id<>'company-assets' or name not like '%/branding/stamp-%' or
 ((storage.foldername(name))[1]=(select private.app_workspace_owner_id())::text and (select private.app_is_admin())));
create policy company_stamp_delete_gate on storage.objects as restrictive for delete to authenticated
using (bucket_id<>'company-assets' or name not like '%/branding/stamp-%' or
 ((storage.foldername(name))[1]=(select private.app_workspace_owner_id())::text and (select private.app_is_admin())));
notify pgrst,'reload schema';
