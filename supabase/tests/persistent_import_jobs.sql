begin;
-- Synthetic fixtures are rolled back; no production account or document changes.
do $$
declare actor uuid:=gen_random_uuid();owner uuid:=gen_random_uuid();other uuid:=gen_random_uuid();j public.import_jobs;i public.import_job_items; claimed integer; old_lease uuid; ok boolean;
begin
 insert into auth.users(id,email) values(actor,'import-test-'||actor||'@example.invalid');
 insert into public.workspaces(id,slug,name,status) values(owner,'import-test-'||owner,'Import test','active'),(other,'import-test-'||other,'Other test','active');
 insert into public.app_users(user_id,email,data_owner_id,workspace_id,role,active,permissions) values(actor,'test@example.invalid',owner,owner,'admin',true,'{}') on conflict(user_id) do update set data_owner_id=owner,workspace_id=owner,role='admin',active=true;
 j:=public.import_enqueue(owner,actor,'expense_document','invoices','Test','key-'||actor,null,'{}','[{"key":"one","label":"one"},{"key":"two","label":"two"}]');
 if (public.import_enqueue(owner,actor,'expense_document','invoices','Test','key-'||actor,null,'{}','[]')).id<>j.id then raise exception 'idempotency failed'; end if;
 select count(*) into claimed from public.import_claim_items(1) where job_id=j.id;
 if claimed<>1 then raise exception 'claim failed %',claimed; end if;
 select * into i from public.import_job_items where job_id=j.id and status='running';old_lease:=i.lease_token;
 ok:=public.import_finish_item(i.id,gen_random_uuid(),'{"status":"imported"}');
 if ok then raise exception 'stale token accepted';end if;
 update public.import_job_items set lease_until=now()-interval '1 second' where id=i.id;
 ok:=public.import_finish_item(i.id,old_lease,'{"status":"imported"}');
 if ok then raise exception 'expired lease accepted';end if;
 perform * from public.import_claim_items(2);
 select * into i from public.import_job_items where id=i.id;
 if i.lease_token=old_lease then raise exception 'lease not recovered';end if;
 ok:=public.import_finish_item(i.id,i.lease_token,'{"status":"waiting_review","result":{"candidate":{"total":121}}}');
 if not ok then raise exception 'finish failed';end if;
 if private.import_can_access(other,'invoices',actor) then raise exception 'cross tenant allowed';end if;
 perform public.import_job_action(j.id,actor,'cancel');
 if exists(select 1 from public.import_job_items where job_id=j.id and status in ('queued','running','waiting_review')) then raise exception 'cancel failed';end if;
 raise notice 'queue/idempotency/lease/recovery/isolation/cancellation: passed';
end $$;
rollback;
