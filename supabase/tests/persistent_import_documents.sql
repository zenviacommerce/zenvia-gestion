begin;
do $$
declare actor uuid:=gen_random_uuid();owner uuid:=gen_random_uuid();source uuid:=gen_random_uuid();j public.import_jobs;i public.import_job_items;result jsonb;old_result jsonb;n integer;
begin
 insert into auth.users(id,email) values(actor,'worker-'||actor||'@example.invalid'),(owner,'owner-'||owner||'@example.invalid');
 insert into public.workspaces(id,slug,name,status) values(owner,'document-test-'||owner,'Document test','active');
 insert into public.app_users(user_id,email,data_owner_id,workspace_id,role,active,permissions) values(actor,'test@example.invalid',owner,owner,'admin',true,'{}') on conflict(user_id) do update set data_owner_id=owner,workspace_id=owner,role='admin',active=true;
 insert into public.source_documents(id,owner_id,storage_bucket,storage_path,original_name,mime_type,file_hash,created_by) values(source,owner,'invoices',owner||'/fixture.pdf','fixture.pdf','application/pdf',owner::text,actor);
 j:=public.import_enqueue(owner,actor,'expense_document','invoices','Test','doc-key-'||actor,null,'{}',jsonb_build_array(jsonb_build_object('key','one','label','one','sourceDocumentId',source)));
 perform * from public.import_claim_items(1);
 select * into i from public.import_job_items where job_id=j.id;
 result:=public.import_commit_document(i.id,i.lease_token,'{"supplierName":"Fixture Supplier SL","invoiceNumber":"F-123","invoiceDate":"2026-10-01","subtotal":100,"vat":21,"total":121,"currency":"EUR","confidence":0.99,"lines":[]}','{}');
 if result->>'id' is null then raise exception 'no invoice created';end if;
 select count(*) into n from public.invoices where owner_id=owner and import_item_id=i.id;
 if n<>1 then raise exception 'invoice idempotency failed';end if;
 begin
 perform public.import_commit_document(i.id,i.lease_token,'{}','{}');
 raise exception 'stale commit accepted';
 exception when others then if sqlerrm='stale commit accepted' then raise;end if;end;
 if (select imported from public.import_jobs where id=j.id)<>1 then raise exception 'acknowledgement not atomic';end if;
 -- Duplicate supplier+number resolves to the same invoice instead of another high-level record.
 j:=public.import_enqueue(owner,actor,'expense_document','invoices','Test','doc-duplicate-'||actor,null,'{}',jsonb_build_array(jsonb_build_object('key','one','label','one','sourceDocumentId',source)));
 perform * from public.import_claim_items(1);
 select * into i from public.import_job_items where job_id=j.id;
 old_result:=public.import_commit_document(i.id,i.lease_token,'{"supplierName":"Fixture Supplier SL","invoiceNumber":"F-123","invoiceDate":"2026-10-01","subtotal":100,"vat":21,"total":121,"currency":"EUR","confidence":0.99,"lines":[]}','{}');
 if old_result->>'id'<>result->>'id' then raise exception 'duplicate invoice created';end if;
end $$;
rollback;
