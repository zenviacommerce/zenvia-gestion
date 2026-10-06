begin;
do $$
declare actor uuid:=gen_random_uuid();owner uuid:=gen_random_uuid();j public.import_jobs;k public.import_jobs;i public.import_job_items;
begin
 insert into auth.users(id,email) values(actor,'hardening-'||actor||'@example.invalid');
 insert into public.workspaces(id,slug,name,status) values(owner,'hardening-'||owner,'Hardening test','active');
 insert into public.app_users(user_id,email,data_owner_id,workspace_id,role,active,permissions) values(actor,'test@example.invalid',owner,owner,'admin',true,'{}') on conflict(user_id) do update set data_owner_id=owner,workspace_id=owner,role='admin',active=true;
 j:=public.import_enqueue(owner,actor,'shopify_orders','orders','Test','first-'||actor,null,'{}','[{"key":"one","label":"one"}]');
 k:=public.import_enqueue(owner,actor,'shopify_orders','orders','Test','second-'||actor,null,'{}','[{"key":"one","label":"one"}]');
 if j.id<>k.id then raise exception 'Overlapping identical syncs created two jobs';end if;
 begin
  perform public.import_enqueue(owner,actor,'expense_document','invoices','Test','first-'||actor,null,'{}','[]');
  raise exception 'Request key collision exposed another module';
 exception when others then if sqlerrm='Request key collision exposed another module' then raise;end if;end;
 perform * from public.import_claim_items(1);select * into i from public.import_job_items where job_id=j.id;
 update public.app_users set active=false where user_id=actor;
 begin
  perform public.import_finish_item(i.id,i.lease_token,'{"status":"imported"}');raise exception 'Revoked actor finished work';
 exception when others then if sqlerrm='Revoked actor finished work' then raise;end if;end;
 if (select status from public.import_job_items where id=i.id)<>'running' then raise exception 'Revoked write mutated item';end if;
end $$;
rollback;
