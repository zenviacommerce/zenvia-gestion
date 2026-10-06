-- Current frontend supports unclassified suppliers; older development instances must too.
alter table public.suppliers drop constraint if exists suppliers_supplier_type_check;
alter table public.suppliers add constraint suppliers_supplier_type_check check(supplier_type in ('unclassified','goods','service','both'));
alter table public.invoices add column import_item_id uuid unique references public.import_job_items(id);
alter table public.sales_invoices add column import_item_id uuid unique references public.import_job_items(id);
alter table public.transport_tariff_documents add column import_item_id uuid unique references public.import_job_items(id);

-- Business writes and acknowledgement share a transaction and a live lease.
create function public.import_commit_document(p_item uuid,p_lease uuid,p_candidate jsonb,p_policy jsonb default '{}') returns jsonb
language plpgsql set search_path='' as $$
declare i public.import_job_items;j public.import_jobs;d public.source_documents;c jsonb:=p_candidate;sid uuid;cid uuid;rid uuid;pid uuid;spid uuid;line jsonb;svc jsonb;band jsonb;svc_id uuid;row_position integer:=0;created boolean:=false;duplicate boolean:=false;saved_result jsonb;category uuid;cfg jsonb;series public.sales_invoice_series;merchandise boolean;manage_products boolean;normalized_price numeric;line_id uuid;existing_cost numeric;
begin
 select * into i from public.import_job_items where id=p_item for update;
 select * into j from public.import_jobs where id=i.job_id for update;
 if i.status<>'running' or i.lease_token is distinct from p_lease or i.lease_until<=now() or j.cancel_requested then raise exception 'Lease caducado o importación cancelada';end if;
 if not private.import_can_access(j.owner_id,j.module,j.created_by) then raise exception 'Permisos revocados';end if;
 perform set_config('request.jwt.claim.sub',j.created_by::text,true);
 select * into d from public.source_documents where id=i.source_document_id and owner_id=j.owner_id;
 if d.id is null then raise exception 'Documento no disponible';end if;
 -- Serializes identity resolution and invoice-number uniqueness within a tenant.
 perform pg_advisory_xact_lock(hashtextextended(j.owner_id::text,319));
 select config into cfg from public.app_settings where owner_id=j.owner_id;cfg:=coalesce(cfg,'{}');
 if j.kind='expense_document' then
  select id into rid from public.invoices where owner_id=j.owner_id and import_item_id=i.id;
  if rid is not null then duplicate:=true;
  else
   if nullif(c->>'supplierId','') is not null then select id into sid from public.suppliers where id=(c->>'supplierId')::uuid and owner_id=j.owner_id;end if;
   if sid is null then select id into sid from public.suppliers where owner_id=j.owner_id and ((nullif(c->>'supplierTaxId','') is not null and upper(regexp_replace(tax_id,'[^a-zA-Z0-9]','','g'))=upper(regexp_replace(c->>'supplierTaxId','[^a-zA-Z0-9]','','g'))) or lower(trim(name))=lower(trim(c->>'supplierName'))) order by created_at limit 1;end if;
   if sid is null then
    if coalesce((p_policy->>'autoCreateSuppliers')::boolean,true)=false then raise exception 'La creación automática de proveedores está desactivada. Selecciona uno existente';end if;
    insert into public.suppliers(owner_id,name,tax_id,email,phone,address,website,supplier_type) values(j.owner_id,c->>'supplierName',nullif(c->>'supplierTaxId',''),nullif(c->>'supplierEmail',''),nullif(c->>'supplierPhone',''),nullif(c->>'supplierAddress',''),nullif(c->>'supplierWebsite',''),coalesce(nullif(p_policy->>'defaultSupplierType',''),'unclassified')) returning id into sid;created:=true;
   elsif coalesce((p_policy->>'fillMissingSupplierData')::boolean,true) then
    update public.suppliers set tax_id=coalesce(nullif(tax_id,''),nullif(c->>'supplierTaxId','')),email=coalesce(nullif(email,''),nullif(c->>'supplierEmail','')),phone=coalesce(nullif(phone,''),nullif(c->>'supplierPhone','')),address=coalesce(nullif(address,''),nullif(c->>'supplierAddress','')),website=coalesce(nullif(website,''),nullif(c->>'supplierWebsite','')) where id=sid and owner_id=j.owner_id;
   end if;
   select id into rid from public.invoices where owner_id=j.owner_id and supplier_id=sid and invoice_number=c->>'invoiceNumber' limit 1;
   if rid is null and not coalesce((i.input->>'multiInvoiceSource')::boolean,false) then select id into rid from public.invoices where owner_id=j.owner_id and file_hash=d.file_hash limit 1;end if;
   if rid is not null then duplicate:=true;
   else
    category:=coalesce(nullif(c->>'categoryId',''),nullif(p_policy->>'defaultCategoryId',''))::uuid;
    if category is not null and not exists(select 1 from public.expense_categories where id=category and owner_id=j.owner_id) then raise exception 'Categoría no disponible';end if;
    insert into public.invoices(owner_id,import_item_id,supplier_id,invoice_number,issue_date,expense_category_id,net_amount,tax_amount,equivalence_surcharge_amount,withholding_amount,total_amount,currency,source,status,source_document_id,file_path,file_name,mime_type,file_hash,ocr_text,extraction,extraction_confidence)
    values(j.owner_id,i.id,sid,c->>'invoiceNumber',(c->>'invoiceDate')::date,category,(c->>'subtotal')::numeric,(c->>'vat')::numeric,coalesce((c->>'equivalenceSurcharge')::numeric,0),coalesce((c->>'withholding')::numeric,0),(c->>'total')::numeric,c->>'currency',case when i.input?'gmailId' then 'gmail' when j.options->>'source'='camera' then 'camera' else 'manual' end,coalesce(p_policy->>'initialStatus','pending'),d.id,d.storage_path,d.original_name,d.mime_type,d.file_hash,c->>'text',jsonb_build_object('persistentImport',true,'sourceIds',i.input->'sourceIds','candidate',c),coalesce((c->>'confidence')::numeric,0)) returning id into rid;
    select coalesce(lower(name) like '%mercanc%' or lower(name) like '%goods%',false) into merchandise from public.expense_categories where id=category;
    manage_products:=coalesce(merchandise,false) and (coalesce((p_policy->>'autoCreateProducts')::boolean,true) or coalesce((p_policy->>'createSupplierProductRelation')::boolean,true));
    for line in select value from jsonb_array_elements(coalesce(c->'lines','[]')) loop
     pid:=null;spid:=null;normalized_price:=coalesce((line->>'normalizedUnitPrice')::numeric,(line->>'unitPrice')::numeric);
     if manage_products then
      select product_id,id into pid,spid from public.supplier_products where owner_id=j.owner_id and supplier_id=sid and lower(trim(supplier_description))=lower(trim(line->>'description')) limit 1;
      if pid is null then select id into pid from public.products where owner_id=j.owner_id and active and lower(trim(name))=lower(trim(line->>'description')) limit 1;end if;
      if pid is null and coalesce((p_policy->>'autoCreateProducts')::boolean,true) and coalesce((cfg#>>'{products,autoCreateFromInvoice}')::boolean,true) then
       insert into public.products(owner_id,name,base_unit,category,last_supplier_id,sales_tax_rate) values(j.owner_id,line->>'description',coalesce(nullif(line->>'unit',''),'ud'),coalesce(cfg#>>'{products,defaultCategoryId}','Mercancía'),sid,coalesce((cfg#>>'{products,defaultVatRate}')::numeric,21)) returning id into pid;
      end if;
      if pid is not null and spid is null and coalesce((p_policy->>'createSupplierProductRelation')::boolean,true) then
       insert into public.supplier_products(owner_id,supplier_id,product_id,supplier_sku,supplier_description,purchase_unit) values(j.owner_id,sid,pid,line->>'supplierSku',line->>'description',coalesce(nullif(line->>'unit',''),'ud')) on conflict(owner_id,supplier_id,supplier_description) do update set product_id=excluded.product_id returning id into spid;
      end if;
     end if;
     insert into public.invoice_lines(owner_id,invoice_id,product_id,supplier_product_id,description,supplier_sku,quantity,unit,unit_price,normalized_unit_price,line_net,tax_rate,tax_amount,line_total,price_update_status)
     values(j.owner_id,rid,pid,spid,line->>'description',line->>'supplierSku',(line->>'quantity')::numeric,coalesce(nullif(line->>'unit',''),'ud'),(line->>'unitPrice')::numeric,normalized_price,(line->>'lineNet')::numeric,(line->>'taxRate')::numeric,(line->>'taxAmount')::numeric,(line->>'lineTotal')::numeric,'pending') returning id into line_id;
     if pid is not null and normalized_price is not null then
      if coalesce((p_policy->>'updatePriceHistory')::boolean,true) then insert into public.product_price_history(owner_id,product_id,supplier_id,invoice_id,invoice_line_id,price_date,purchase_unit_price,normalized_unit_price,base_unit,currency) values(j.owner_id,pid,sid,rid,line_id,(c->>'invoiceDate')::date,(line->>'unitPrice')::numeric,normalized_price,coalesce(nullif(line->>'unit',''),'ud'),c->>'currency') on conflict(invoice_line_id) do nothing;end if;
      if coalesce((p_policy->>'updateProductCosts')::boolean,true) and coalesce((cfg#>>'{products,updateCostFromImports}')::boolean,true) and coalesce(cfg#>>'{products,costMethod}','last_purchase')<>'manual' and c->>'currency'=coalesce(cfg#>>'{general,currencyCode}','EUR') then
       if cfg#>>'{products,costMethod}'='average' then select avg(normalized_unit_price) into normalized_price from public.product_price_history where product_id=pid and owner_id=j.owner_id;end if;
       update public.products set previous_cost=last_cost,last_cost=round(normalized_price,coalesce((cfg#>>'{products,costDecimals}')::integer,6)),last_supplier_id=sid,last_purchase_date=(c->>'invoiceDate')::date where id=pid and owner_id=j.owner_id and (last_purchase_date is null or last_purchase_date<=(c->>'invoiceDate')::date);
      end if;
     end if;
    end loop;
   end if;
  end if;
  if duplicate and created then delete from public.suppliers where id=sid and owner_id=j.owner_id and not exists(select 1 from public.invoices where supplier_id=sid);end if;
  if i.input?'gmailId' then update public.gmail_imports set status='imported',invoice_id=rid,source_document_id=d.id,metadata=metadata||jsonb_build_object('persistentJobId',j.id,'persistentItemId',i.id,'duplicateResolved',duplicate,'reviewRequired',false) where id=(i.input->>'gmailId')::uuid and owner_id=j.owner_id;end if;
 elsif j.kind='sales_document' then
  select id into rid from public.sales_invoices where owner_id=j.owner_id and (import_item_id=i.id or invoice_number=c->>'invoiceNumber') limit 1;
  if rid is not null then duplicate:=true;
  else
   if nullif(c->>'clientId','') is not null then select id into cid from public.clients where id=(c->>'clientId')::uuid and owner_id=j.owner_id and active;end if;
   if cid is null then select id into cid from public.clients where owner_id=j.owner_id and active and ((nullif(c#>>'{proposedClient,taxId}','') is not null and upper(regexp_replace(tax_id,'[^a-zA-Z0-9]','','g'))=upper(regexp_replace(c#>>'{proposedClient,taxId}','[^a-zA-Z0-9]','','g'))) or lower(trim(name))=lower(trim(c#>>'{proposedClient,name}'))) limit 1;end if;
   if cid is null then
    if coalesce((cfg#>>'{sales,autoCreateClients}')::boolean,true)=false then raise exception 'Selecciona un cliente existente';end if;
    insert into public.clients(owner_id,name,tax_id,email,phone,address_line1,address_line2,postal_code,city,province,country_code,payment_terms_days,default_vat_rate,default_payment_method) values(j.owner_id,c#>>'{proposedClient,name}',c#>>'{proposedClient,taxId}',c#>>'{proposedClient,email}',c#>>'{proposedClient,phone}',c#>>'{proposedClient,addressLine1}',c#>>'{proposedClient,addressLine2}',c#>>'{proposedClient,postalCode}',c#>>'{proposedClient,city}',c#>>'{proposedClient,province}',coalesce(nullif(c#>>'{proposedClient,countryCode}',''),'ES'),coalesce((cfg#>>'{clients,defaultPaymentTermsDays}')::integer,0),coalesce((cfg#>>'{clients,defaultVatRate}')::numeric,21),cfg#>>'{clients,defaultPaymentMethod}') returning id into cid;
   end if;
   select * into series from public.sales_invoice_series where id=(c->>'seriesId')::uuid and owner_id=j.owner_id and active and kind='standard' and year=extract(year from (c->>'issueDate')::date)::integer for update;
   if series.id is null then raise exception 'Serie no disponible para esta fecha';end if;
   if nullif(c->>'taxRegistrationId','') is not null and not exists(select 1 from public.business_tax_registrations where owner_id=j.owner_id and id=(c->>'taxRegistrationId')::uuid and active) then raise exception 'Registro fiscal no disponible';end if;
   insert into public.sales_invoices(owner_id,import_item_id,client_id,series_id,invoice_number,issue_date,due_date,currency,payment_method,notes,tax_registration_id,status)
   values(j.owner_id,i.id,cid,series.id,c->>'invoiceNumber',(c->>'issueDate')::date,nullif(c->>'dueDate','')::date,c->>'currency',c->>'paymentMethod',c->>'notes',nullif(c->>'taxRegistrationId','')::uuid,'draft') returning id into rid;
   for line in select value from jsonb_array_elements(c->'lines') loop
    row_position:=row_position+1;pid:=null;
    if nullif(line->>'productId','') is not null then select id into pid from public.products where id=(line->>'productId')::uuid and owner_id=j.owner_id;if pid is null then raise exception 'Producto no disponible';end if;end if;
    insert into public.sales_invoice_lines(owner_id,invoice_id,product_id,position,description,quantity,unit,unit_price,discount_percent,tax_rate) values(j.owner_id,rid,pid,row_position,line->>'description',(line->>'quantity')::numeric,coalesce(nullif(line->>'unit',''),'ud'),(line->>'unitPrice')::numeric,coalesce((line->>'discountPercent')::numeric,0),(line->>'taxRate')::numeric);
   end loop;
  end if;
 elsif j.kind='transport_tariff' then
  select id into rid from public.transport_tariff_documents where owner_id=j.owner_id and import_item_id=i.id;
  if rid is null then
   insert into public.transport_tariff_documents(owner_id,import_item_id,created_by,shipping_provider,carrier_code,carrier_name,status,effective_from,effective_to,currency_code,prices_include_vat,fuel_surcharge_pct,fuel_surcharge_included,source_file_name,source_file_path,source_mime_type,source_sha256,parser_provider,parser_model,parser_confidence,parser_notes)
   values(j.owner_id,i.id,j.created_by,j.options->>'shippingProvider',c->>'carrierCode',c->>'carrierName','draft',nullif(c->>'effectiveFrom','')::date,nullif(c->>'effectiveTo','')::date,c->>'currencyCode',coalesce((c->>'pricesIncludeVat')::boolean,false),(c->>'fuelSurchargePct')::numeric,coalesce((c->>'fuelSurchargeIncluded')::boolean,false),d.original_name,d.storage_path,d.mime_type,d.file_hash,'ollama',c->>'parserModel',coalesce((c->>'parserConfidence')::numeric,0),jsonb_build_object('notes',coalesce(c->'parserNotes','[]')) ) returning id into rid;
   for svc in select value from jsonb_array_elements(c->'services') loop
    insert into public.transport_tariff_services(owner_id,document_id,service_name,canonical_service_key,external_provider,external_service_code,mapping_status) values(j.owner_id,rid,svc->>'serviceName',svc->>'canonicalServiceKey',nullif(svc->>'externalProvider',''),nullif(svc->>'externalServiceCode',''),'suggested') returning id into svc_id;
    for band in select value from jsonb_array_elements(svc->'bands') loop
     insert into public.transport_tariff_bands(owner_id,service_id,country_code,zone_code,zone_name,min_weight_kg,max_weight_kg,base_price,extra_kg_price,notes) values(j.owner_id,svc_id,band->>'countryCode',band->>'zoneCode',band->>'zoneName',(band->>'minWeightKg')::numeric,(band->>'maxWeightKg')::numeric,(band->>'basePrice')::numeric,(band->>'extraKgPrice')::numeric,band->>'notes');
    end loop;
   end loop;
  else duplicate:=true;end if;
 else raise exception 'Tipo de documento no válido';end if;
 saved_result:=jsonb_build_object('id',rid,'candidate',c,'sourceDocumentId',d.id,'draft',j.kind in ('sales_document','transport_tariff'));
 update public.import_job_items set status=case when duplicate then 'duplicate' else 'imported' end,stage=case when j.kind='transport_tariff' then 'Borrador listo para revisión' else 'Guardada' end,result=saved_result,error=null,lease_token=null,lease_until=null,version=version+1,updated_at=now() where id=i.id;
 perform public.import_refresh_job(j.id);return saved_result;
end $$;
revoke all on function public.import_commit_document(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.import_commit_document(uuid,uuid,jsonb,jsonb) to service_role;

create function public.import_expand_candidates(p_item uuid,p_lease uuid,p_candidates jsonb) returns void language plpgsql set search_path='' as $$
declare i public.import_job_items;entry jsonb;n integer:=1;
begin
 select * into i from public.import_job_items where id=p_item for update;
 if i.status<>'running' or i.lease_token is distinct from p_lease or i.lease_until<=now() then raise exception 'Lease caducado';end if;
 update public.import_job_items set input=input||'{"multiInvoiceSource":true}'::jsonb where id=i.id;
 for entry in select value from jsonb_array_elements(p_candidates) loop
  n:=n+1;
  insert into public.import_job_items(job_id,owner_id,item_key,label,source_document_id,input,result,status) values(i.job_id,i.owner_id,i.item_key||':candidate:'||n,i.label||' · '||coalesce(entry->>'invoiceNumber',n::text),i.source_document_id,i.input||'{"multiInvoiceSource":true}'::jsonb,jsonb_build_object('candidate',entry),'ready') on conflict(job_id,item_key) do nothing;
 end loop;
end $$;
revoke all on function public.import_expand_candidates(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.import_expand_candidates(uuid,uuid,jsonb) to service_role;
