grant usage on schema public, private, auth to anon, authenticated;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;
grant execute on all functions in schema public, private, auth to authenticated;
insert into public.workspaces(id,slug,name) values('11111111-1111-4111-8111-111111111111','synthetic-workspace','Synthetic Workspace') on conflict do nothing;
insert into public.app_users(user_id,email,role,data_owner_id,workspace_id,permissions) values('22222222-2222-4222-8222-222222222222','invoice@example.test','admin','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','{invoices,products,suppliers,dashboard}') on conflict do nothing;
