begin;
do $$
declare owner uuid:=gen_random_uuid();source uuid:=gen_random_uuid();j public.import_jobs;i public.import_job_items;result jsonb;sid uuid:=gen_random_uuid();tariff uuid;candidate jsonb;client uuid;
begin
 insert into auth.users(id,email) values(owner,'business-'||owner||'@example.invalid');
 insert into public.workspaces(id,slug,name,status) values(owner,'business-'||owner,'Business rules fixture','active');
 insert into public.app_users(user_id,email,data_owner_id,workspace_id,role,active,permissions) values(owner,'test@example.invalid',owner,owner,'admin',true,'{}') on conflict(user_id) do update set data_owner_id=owner,workspace_id=owner,role='admin',active=true;
 perform set_config('request.jwt.claim.sub',owner::text,true);
 insert into public.source_documents(id,owner_id,created_by,storage_bucket,storage_path,original_name,mime_type,file_hash) values(source,owner,owner,'import-sources',owner||'/business.pdf','business.pdf','application/pdf',owner::text);
 insert into public.sales_invoice_series(id,owner_id,code,name,prefix,year,kind,next_number,padding,active) values(sid,owner,'FIX','Fixture','F-',2026,'standard',1,3,true);
 j:=public.import_enqueue(owner,owner,'sales_document','sales','Test','sale-'||owner,null,'{}',jsonb_build_array(jsonb_build_object('key','sales','label','sales','sourceDocumentId',source)));
 perform * from public.import_claim_items(1);select * into i from public.import_job_items where job_id=j.id;
 candidate:=jsonb_build_object('invoiceNumber','F-123','issueDate','2026-10-01','seriesId',sid,'currency','EUR','proposedClient',jsonb_build_object('name','Fixture Client SL'),'lines','[{"description":"Servicio","quantity":1,"unitPrice":100,"taxRate":21}]'::jsonb);
 result:=public.import_commit_document(i.id,i.lease_token,candidate,'{}');
 if (select next_number from public.sales_invoice_series where id=sid)<>124 then raise exception 'Sales imported number not reserved';end if;
 if not exists(select 1 from public.sales_invoices where id=(result->>'id')::uuid and status='draft' and total_amount=121) then raise exception 'Sales draft or line totals incorrect';end if;
 -- An explicitly selected client cannot silently fall back after deactivation.
 select client_id into client from public.sales_invoices where id=(result->>'id')::uuid;update public.clients set active=false where id=client;
 j:=public.import_enqueue(owner,owner,'sales_document','sales','Unavailable client','inactive-client-'||owner,null,'{}',jsonb_build_array(jsonb_build_object('key','sales','label','sales','sourceDocumentId',source)));
 perform * from public.import_claim_items(1);select * into i from public.import_job_items where job_id=j.id;
 begin
 perform public.import_commit_document(i.id,i.lease_token,candidate||jsonb_build_object('invoiceNumber','F-124','clientId',client,'proposedClient',jsonb_build_object('name','Unintended Client SL')),'{}');
 raise exception 'Unavailable selected client replaced';
 exception when others then if sqlerrm<>'Cliente no disponible' then raise;end if;end;
 if exists(select 1 from public.clients where owner_id=owner and name='Unintended Client SL') then raise exception 'Unexpected fallback client';end if;
 -- Tariffs remain drafts and reanalysis keeps the same document ID.
 candidate:='{"carrierCode":"mrw","carrierName":"MRW","currencyCode":"EUR","services":[{"serviceName":"24h","canonicalServiceKey":"24h","bands":[{"countryCode":"ES","zoneCode":"peninsular","zoneName":"España Peninsular","minWeightKg":0,"maxWeightKg":1,"basePrice":3.5}]}]}'::jsonb;
 j:=public.import_enqueue(owner,owner,'transport_tariff','settings','Test','tariff-'||owner,null,'{"shippingProvider":"envia"}',jsonb_build_array(jsonb_build_object('key','tariff','label','tariff','sourceDocumentId',source)));
 perform * from public.import_claim_items(1);select * into i from public.import_job_items where job_id=j.id;
 result:=public.import_commit_document(i.id,i.lease_token,candidate,'{}');tariff:=(result->>'id')::uuid;
 if (select status from public.transport_tariff_documents where id=tariff)<>'draft' then raise exception 'Tariff auto-activated';end if;
 j:=public.import_enqueue(owner,owner,'transport_tariff','settings','Test','reanalysis-'||owner,null,jsonb_build_object('shippingProvider','envia','tariffId',tariff),jsonb_build_array(jsonb_build_object('key','tariff','label','tariff','sourceDocumentId',source)));
 perform * from public.import_claim_items(1);select * into i from public.import_job_items where job_id=j.id;
 result:=public.import_commit_document(i.id,i.lease_token,candidate,'{}');
 if result->>'id'<>tariff::text then raise exception 'Reanalysis created a second tariff';end if;
 -- Supplier-wide settings also govern imports, not only expense-local flags.
 insert into public.app_settings(owner_id,config) values(owner,'{"suppliers":{"autoCreate":false}}') on conflict(owner_id) do update set config=excluded.config;
 j:=public.import_enqueue(owner,owner,'expense_document','invoices','Test','supplier-setting-'||owner,null,'{}',jsonb_build_array(jsonb_build_object('key','expense','label','expense','sourceDocumentId',source)));
 perform * from public.import_claim_items(1);select * into i from public.import_job_items where job_id=j.id;
 begin
 perform public.import_commit_document(i.id,i.lease_token,'{"supplierName":"Forbidden Supplier SL","invoiceNumber":"X-1","invoiceDate":"2026-10-01","currency":"EUR","subtotal":100,"vat":21,"total":121,"lines":[]}','{}');
 raise exception 'Disabled supplier creation ignored';
 exception when others then if sqlerrm='Disabled supplier creation ignored' then raise;end if;end;
end $$;
rollback;
