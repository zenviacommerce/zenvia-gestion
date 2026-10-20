drop policy if exists company_stamp_insert_gate on storage.objects;
drop policy if exists company_stamp_update_gate on storage.objects;
drop policy if exists company_stamp_delete_gate on storage.objects;
-- Uploaded stamp objects are intentionally retained; take an object backup before manual cleanup.
drop policy if exists company_stamp_delete on storage.objects;
drop policy if exists company_stamp_insert on storage.objects;
drop policy if exists company_stamp_select on storage.objects;
drop policy if exists company_branding_orders_select on public.company_branding;
alter table public.company_branding drop column if exists stamp_path;
notify pgrst,'reload schema';
