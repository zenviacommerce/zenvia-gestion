begin;
-- Exercise actual authenticated privileges/RLS, not only private helper predicates.
do $$
declare owner uuid:=gen_random_uuid();other uuid:=gen_random_uuid();j public.import_jobs;n integer;
begin
 insert into auth.users(id,email) values(owner,'rls-'||owner||'@example.invalid');
 insert into public.workspaces(id,slug,name,status) values(owner,'rls-'||owner,'RLS fixture','active'),(other,'rls-'||other,'Other RLS fixture','active');
 insert into public.app_users(user_id,email,data_owner_id,workspace_id,role,active,permissions) values(owner,'test@example.invalid',owner,owner,'admin',true,'{}') on conflict(user_id) do update set data_owner_id=owner,workspace_id=owner,role='admin',active=true;
 j:=public.import_enqueue(owner,owner,'expense_document','invoices','Test','rls-'||owner,null,'{}','[{"key":"one","label":"one"}]');
 insert into public.import_jobs(owner_id,created_by,kind,module,label,request_key) values(other,owner,'expense_document','invoices','Other','foreign-'||other);
 perform set_config('request.jwt.claim.sub',owner::text,true);
 execute 'set local role authenticated';
 select count(*) into n from public.import_jobs where id=j.id;if n<>1 then raise exception 'Own task hidden';end if;
 select count(*) into n from public.import_jobs where owner_id=other;if n<>0 then raise exception 'Foreign task exposed';end if;
 begin update public.import_jobs set label='Browser mutation' where id=j.id;raise exception 'Browser queue write allowed';exception when insufficient_privilege then null;end;
 begin perform public.import_claim_items(1);raise exception 'Browser worker execution allowed';exception when insufficient_privilege then null;end;
 begin select count(*) into n from public.import_document_cache;raise exception 'Cache readable';exception when insufficient_privilege then null;end;
 execute 'reset role';
 update public.workspaces set status='suspended' where id=owner;
 execute 'set local role authenticated';
 select count(*) into n from public.import_jobs where id=j.id;if n<>0 then raise exception 'Suspended workspace task exposed';end if;
 execute 'reset role';
end $$;
rollback;
