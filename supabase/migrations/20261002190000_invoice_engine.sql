-- Additive migration only. Existing invoices, policies, indexes and evidence remain intact.
alter table public.suppliers add column if not exists iban text;
alter table public.suppliers add column if not exists address_details jsonb;
create table public.invoice_engine_jobs (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default private.app_workspace_owner_id() references public.workspaces(id),
 source_document_id uuid not null references public.source_documents(id) on delete restrict,
 document_key text not null,
 document jsonb not null,
 original_extraction jsonb not null,
 status text not null check(status in ('ready','needs_review','imported','duplicate','ignored')),
 invoice_id uuid references public.invoices(id) on delete set null,
 source_channel text not null check(source_channel in ('manual','camera','gmail')),
 metadata jsonb not null default '{}',
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(owner_id,source_document_id,document_key)
);
create table public.invoice_engine_identities (
 owner_id uuid not null default private.app_workspace_owner_id() references public.workspaces(id),
 fingerprint text not null,invoice_id uuid not null references public.invoices(id) on delete cascade,
 primary key(owner_id,fingerprint)
);
create table public.invoice_engine_corrections (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null default private.app_workspace_owner_id() references public.workspaces(id),
 supplier_tax_id text not null,job_id uuid not null references public.invoice_engine_jobs(id),
 original jsonb not null,corrected jsonb not null,changes jsonb not null,
 corrected_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now(),unique(job_id)
);
create index invoice_engine_review_idx on public.invoice_engine_jobs(owner_id,status,created_at desc);
create index invoice_engine_learning_idx on public.invoice_engine_corrections(owner_id,supplier_tax_id,created_at desc);
alter table public.invoice_engine_jobs enable row level security;
alter table public.invoice_engine_identities enable row level security;
alter table public.invoice_engine_corrections enable row level security;
do $$ declare t text;begin
 foreach t in array array['invoice_engine_jobs','invoice_engine_identities','invoice_engine_corrections'] loop
 execute format('create policy %I on public.%I for select to authenticated using (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission(''invoices'')) or (select private.app_has_permission(''gmail''))))',t||'_read',t);
 execute format('create policy %I on public.%I for insert to authenticated with check (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission(''invoices'')) or (select private.app_has_permission(''gmail''))))',t||'_insert',t);
 end loop;
end $$;
create policy invoice_engine_jobs_update on public.invoice_engine_jobs for update to authenticated
 using(owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail'))))
 with check(owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail'))));
grant select,insert,update on public.invoice_engine_jobs to authenticated;
grant select,insert on public.invoice_engine_identities,public.invoice_engine_corrections to authenticated;
create function public.invoice_engine_context() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('owner_id',private.app_workspace_owner_id(),'can_import',auth.uid() is not null and (private.app_has_permission('invoices') or private.app_has_permission('gmail')));
$$;
create function public.invoice_engine_tax_key(v text) returns text language sql immutable set search_path='' as $$
 select regexp_replace(regexp_replace(upper(coalesce(v,'')),'[^A-Z0-9]','','g'),'^ES(?=[A-Z0-9]{9}$)','');
$$;
create function public.invoice_engine_name_key(v text) returns text language sql immutable set search_path='' as $$
 select regexp_replace(lower(translate(coalesce(v,''),'áéíóúüñ','aeiouun')),'[^a-z0-9]','','g');
$$;
-- Token similarity avoids a dependency on extensions and handles reordered legal names.
create function public.invoice_engine_full_number(n text,s text) returns text language sql immutable set search_path='' as $$
 select case when coalesce(s,'')<>'' and not (lower(left(n,length(s)))=lower(s) and substring(n from length(s)+1 for 1) ~ '[^a-zA-Z0-9]') then s||'-'||n else n end;
$$;
create function public.invoice_engine_name_similarity(a text,b text) returns numeric language sql immutable set search_path='' as $$
 with x as(select distinct unnest(regexp_split_to_array(lower(coalesce(a,'')),'[^a-z0-9áéíóúüñ]+')) w),
 y as(select distinct unnest(regexp_split_to_array(lower(coalesce(b,'')),'[^a-z0-9áéíóúüñ]+')) w)
 select case when public.invoice_engine_name_key(a)=public.invoice_engine_name_key(b) then 1::numeric else
 (select count(*)::numeric from x join y using(w) where length(w)>1)/greatest(1,(select count(*) from x where length(w)>1),(select count(*) from y where length(w)>1)) end;
$$;
create function public.invoice_engine_valid_nif(v text) returns boolean language plpgsql immutable set search_path='' as $$
declare n text:=public.invoice_engine_tax_key(v);s int:=0;i int;d int;c int;letters text:='TRWAGMYFPDXBNJZSQVHLCKE';begin
 if n ~ '^\d{8}[A-Z]$' then return substr(letters,(substr(n,1,8)::bigint%23)::int+1,1)=right(n,1);end if;
 if n ~ '^[XYZ]\d{7}[A-Z]$' then return substr(letters,((((strpos('XYZ',left(n,1))-1)::text||substr(n,2,7))::bigint%23)+1)::int,1)=right(n,1);end if;
 if n !~ '^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$' then return false;end if;
 for i in 2..8 loop d:=substr(n,i,1)::int;if i%2=0 then d:=d*2;s:=s+d/10+d%10;else s:=s+d;end if;end loop;
 c:=(10-s%10)%10;
 if left(n,1) ~ '[KPQS]' then return right(n,1)=substr('JABCDEFGHI',c+1,1);end if;
 if left(n,1) ~ '[ABEH]' then return right(n,1)=c::text;end if;
 return right(n,1)=c::text or right(n,1)=substr('JABCDEFGHI',c+1,1);
end $$;
create function public.invoice_engine_stage(p_source uuid,p_key text,p_document jsonb,p_status text,p_channel text,p_metadata jsonb default '{}') returns uuid
language plpgsql security invoker set search_path='' as $$
declare v uuid;o uuid:=private.app_workspace_owner_id();begin
 if auth.uid() is null or not(private.app_has_permission('invoices') or private.app_has_permission('gmail')) then raise exception 'Sin permisos';end if;
 if p_status not in ('ready','needs_review') or jsonb_typeof(p_document)<>'object' then raise exception 'Documento inválido';end if;
 if not exists(select 1 from public.source_documents where id=p_source and owner_id=o) then raise exception 'Documento original ajeno';end if;
 insert into public.invoice_engine_jobs(owner_id,source_document_id,document_key,document,original_extraction,status,source_channel,metadata)
 values(o,p_source,p_key,p_document,p_document,p_status,p_channel,p_metadata)
 on conflict(owner_id,source_document_id,document_key) do update set document=case when public.invoice_engine_jobs.status in ('imported','duplicate') and public.invoice_engine_jobs.invoice_id is not null then public.invoice_engine_jobs.document else excluded.document end,
 status=case when public.invoice_engine_jobs.status in ('imported','duplicate') and public.invoice_engine_jobs.invoice_id is not null then public.invoice_engine_jobs.status else excluded.status end,updated_at=now()
 returning id into v;return v;
end $$;
create function public.invoice_engine_commit(p_job uuid,p_document jsonb,p_reviewed boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare o uuid:=private.app_workspace_owner_id();j public.invoice_engine_jobs;s public.suppliers;src public.source_documents;
 iid uuid;pid uuid;spid uuid;lineid uuid;cfg jsonb:='{}';auto_cfg jsonb:='{}';auto_enabled boolean:=true;update_cost boolean:=true;record_history boolean:=true;base_currency text:='EUR';l jsonb;t jsonb;tax text;n text;full_number text;fp text;amount numeric;net numeric;vat numeric;total numeric;
 issue date;category uuid;matches int;cost numeric;units numeric:=1;old_cost numeric;old_date date;kind text;confidence numeric;changes jsonb;
begin
 if auth.uid() is null or not(private.app_has_permission('invoices') or private.app_has_permission('gmail')) then raise exception 'Sin permisos';end if;
 -- Serialize identity resolution, preventing races creating suppliers/products/invoices.
 perform pg_advisory_xact_lock(hashtextextended(o::text||':invoice-engine',0));
 select config into cfg from public.app_settings where owner_id=o;cfg:=coalesce(cfg,'{}');
 select config,enabled into auto_cfg,auto_enabled from public.automation_rules where owner_id=o and rule_key='expense_invoice_imported';
 auto_cfg:=coalesce(auto_cfg,'{}');auto_enabled:=coalesce(auto_enabled,true);
 base_currency:=coalesce(cfg#>>'{general,currencyCode}','EUR');
 update_cost:=coalesce((cfg#>>'{expenses,updateProductCosts}')::boolean,true) and coalesce((cfg#>>'{products,updateCostFromImports}')::boolean,true) and auto_enabled and coalesce((auto_cfg->>'updateProductCosts')::boolean,true) and coalesce(cfg#>>'{products,costMethod}','last_purchase')<>'manual';
 record_history:=auto_enabled and coalesce((auto_cfg->>'updatePriceHistory')::boolean,true);
 select * into j from public.invoice_engine_jobs where id=p_job and owner_id=o for update;
 if j.id is null then raise exception 'Importación ajena o inexistente';end if;
 if j.invoice_id is not null then return jsonb_build_object('invoiceId',j.invoice_id,'duplicate',true);end if;
 tax:=public.invoice_engine_tax_key(p_document#>>'{supplier,taxId}');n:=trim(p_document#>>'{supplier,name}');
 if n is null or n='' or coalesce(p_document->>'number','')='' then raise exception 'Proveedor y número obligatorios';end if;
 if p_document->>'type' not in ('complete','simplified','rectification','credit') then raise exception 'Tipo de factura inválido';end if;
 if tax='' and p_document->>'type'<>'simplified' then raise exception 'Falta NIF/VAT';end if;
 if tax<>'' and (p_document#>>'{supplier,countryCode}'='ES' or p_document#>>'{supplier,taxId}' ~ '^ES') and not public.invoice_engine_valid_nif(tax) then raise exception 'NIF inválido';end if;
 issue:=(p_document->>'issueDate')::date;
 if issue is null or issue>current_date+2 then raise exception 'Fecha inválida';end if;
 if nullif(p_document->>'dueDate','') is not null and (p_document->>'dueDate')::date<issue then raise exception 'Vencimiento inválido';end if;
 if coalesce(p_document->>'currency','') !~ '^[A-Z]{3}$' then raise exception 'Moneda inválida';end if;
 net:=(p_document->>'subtotal')::numeric;vat:=(p_document->>'vat')::numeric;total:=(p_document->>'total')::numeric;
 if net is null or vat is null or total is null or net::text in ('NaN','Infinity','-Infinity') or vat::text in ('NaN','Infinity','-Infinity') or total::text in ('NaN','Infinity','-Infinity') then raise exception 'Importes inválidos';end if;
 if total=0 or (total<0 and p_document->>'type' not in ('credit','rectification')) then raise exception 'Signo del total inválido';end if;
 if abs(net+vat+coalesce((p_document->>'surcharge')::numeric,0)-coalesce((p_document->>'withholding')::numeric,0)-total)>.02 then raise exception 'El total fiscal no cuadra';end if;
 if nullif(p_document->>'segmentationWarning','') is not null and not(p_reviewed and coalesce((p_document->>'segmentationResolved')::boolean,false)) then raise exception 'Revisa y confirma la separación de páginas';end if;
 if not p_reviewed then
   if j.status<>'ready' or p_document is distinct from j.document then raise exception 'La extracción necesita revisión';end if;
   foreach kind in array array['supplier','taxId','number','issueDate','currency','lines','taxes','total'] loop
    if kind='taxId' and tax='' then continue;end if;
    confidence:=(p_document->'confidence'->>kind)::numeric;if confidence is null or confidence<.92 then raise exception 'Confianza insuficiente: %',kind;end if;
   end loop;
   foreach kind in array array['email','phone','address','iban'] loop
    if nullif(p_document->'supplier'->>kind,'') is not null and coalesce((p_document->'confidence'->>kind)::numeric,0)<.92 then raise exception 'Contacto dudoso: %',kind;end if;
   end loop;
 end if;
 if jsonb_typeof(p_document->'lines')<>'array' or jsonb_array_length(p_document->'lines')=0 or jsonb_array_length(p_document->'lines')>2000 then raise exception 'Faltan líneas';end if;
 amount:=0;
 for l in select value from jsonb_array_elements(p_document->'lines') loop
  if coalesce(l->>'description','')='' or l->>'kind' not in ('product','expense') or l->>'net' is null or l->>'vat' is null or l->>'quantity' is null or l->>'unitPrice' is null or l->>'vatRate' is null or l->>'total' is null then raise exception 'Línea incompleta';end if;
  if coalesce((l->>'discountPercent')::numeric,0) not between 0 and 100 then raise exception 'Descuento inválido';end if;
  if abs((l->>'net')::numeric-(l->>'quantity')::numeric*(l->>'unitPrice')::numeric*(1-coalesce((l->>'discountPercent')::numeric,0)/100))>.02 then raise exception 'Precio/descuento de línea incorrecto';end if;
  if abs((l->>'vat')::numeric-(l->>'net')::numeric*(l->>'vatRate')::numeric/100)>.02 or abs((l->>'total')::numeric-(l->>'net')::numeric-(l->>'vat')::numeric)>.02 then raise exception 'IVA/total de línea incorrecto';end if;
  if p_document#>>'{supplier,countryCode}'='ES' and (l->>'vatRate')::numeric not in (0,4,10,21) then raise exception 'IVA no permitido';end if;
  amount:=amount+(l->>'net')::numeric;
 end loop;
 if abs(amount-net)>greatest(.02,jsonb_array_length(p_document->'lines')*.01) then raise exception 'Las líneas no suman la base';end if;
 if jsonb_typeof(p_document->'taxes')<>'array' or jsonb_array_length(p_document->'taxes')=0 then raise exception 'Falta desglose IVA';end if;
 for t in select value from jsonb_array_elements(p_document->'taxes') loop
  if t->>'base' is null or t->>'amount' is null or t->>'rate' is null or abs((t->>'amount')::numeric-(t->>'base')::numeric*(t->>'rate')::numeric/100)>.02 then raise exception 'Cuota IVA inválida';end if;
 end loop;
 select sum((value->>'base')::numeric),sum((value->>'amount')::numeric) into amount,cost from jsonb_array_elements(p_document->'taxes');
 if abs(amount-net)>.02 or abs(cost-vat)>.02 then raise exception 'Desglose fiscal inconsistente';end if;
 if nullif(p_document->>'withholdingRate','') is not null and abs((p_document->>'withholding')::numeric-net*(p_document->>'withholdingRate')::numeric/100)>.02 then raise exception 'Retención IRPF incorrecta';end if;
 if coalesce((p_document->>'surcharge')::numeric,0)<>0 then
  if jsonb_typeof(p_document->'surcharges') is distinct from 'array' then raise exception 'Falta desglose recargo';end if;
  amount:=0;for t in select value from jsonb_array_elements(p_document->'surcharges') loop
   if t->>'base' is null or t->>'amount' is null or t->>'rate' is null or abs((t->>'amount')::numeric-(t->>'base')::numeric*(t->>'rate')::numeric/100)>.02 then raise exception 'Recargo incorrecto';end if;amount:=amount+(t->>'amount')::numeric;
  end loop;if abs(amount-(p_document->>'surcharge')::numeric)>.02 then raise exception 'Desglose recargo incorrecto';end if;
 end if;
 if coalesce((p_document->>'reverseCharge')::boolean,false) or coalesce((p_document->>'intraCommunity')::boolean,false) then if vat<>0 then raise exception 'Revisar IVA intracomunitario/inversión';end if;end if;
 if nullif(p_document->>'categoryId','') is not null then category:=(p_document->>'categoryId')::uuid;if not exists(select 1 from public.expense_categories where id=category and owner_id=o) then raise exception 'Categoría ajena';end if;end if;
 full_number:=public.invoice_engine_full_number(p_document->>'number',p_document->>'series');
 fp:=coalesce(nullif(tax,''),'name:'||public.invoice_engine_name_key(n))||'|'||public.invoice_engine_name_key(full_number)||'|'||issue::text||'|'||round(total*100)::text||'|'||(p_document->>'currency');
 select invoice_id into iid from public.invoice_engine_identities where owner_id=o and fingerprint=fp;
 if iid is not null then update public.invoice_engine_jobs set invoice_id=iid,status='duplicate',updated_at=now() where id=j.id;return jsonb_build_object('invoiceId',iid,'duplicate',true);end if;
 if tax<>'' then select * into s from public.suppliers where owner_id=o and public.invoice_engine_tax_key(tax_id)=tax order by created_at limit 1;end if;
 if s.id is null then
  select sp.* into s from public.entity_alias_rules a join public.suppliers sp on sp.id=a.target_entity_id and sp.owner_id=o where a.owner_id=o and a.entity_type='supplier' and a.active and public.invoice_engine_name_key(a.alias)=public.invoice_engine_name_key(n) and (tax='' or public.invoice_engine_tax_key(sp.tax_id) in ('',tax)) order by a.priority limit 1;
 end if;
 if s.id is null then
  select count(*) into matches from public.suppliers where owner_id=o and (tax='' or public.invoice_engine_tax_key(tax_id) in ('',tax)) and public.invoice_engine_name_similarity(name,n)>=.8;
  if matches>1 then raise exception 'Coincidencia ambigua entre proveedores: revisar';end if;
  select * into s from public.suppliers where owner_id=o and (tax='' or public.invoice_engine_tax_key(tax_id) in ('',tax)) and public.invoice_engine_name_similarity(name,n)>=.8 limit 1;
 end if;
 if s.id is null then
  insert into public.suppliers(owner_id,name,tax_id,email,phone,address,iban,address_details,supplier_type,default_category_id)
  values(o,n,nullif(tax,''),nullif(p_document#>>'{supplier,email}',''),nullif(p_document#>>'{supplier,phone}',''),nullif(p_document#>>'{supplier,address}',''),nullif(p_document#>>'{supplier,iban}',''),p_document->'supplier',case when exists(select 1 from jsonb_array_elements(p_document->'lines') where value->>'kind'='product') then 'goods' else 'service' end,category) returning * into s;
 else
  update public.suppliers set tax_id=coalesce(nullif(tax_id,''),nullif(tax,'')),email=coalesce(nullif(email,''),nullif(p_document#>>'{supplier,email}','')),
   phone=coalesce(nullif(phone,''),nullif(p_document#>>'{supplier,phone}','')),address=coalesce(nullif(address,''),nullif(p_document#>>'{supplier,address}','')),iban=coalesce(nullif(iban,''),nullif(p_document#>>'{supplier,iban}','')),address_details=coalesce(address_details,p_document->'supplier') where id=s.id;
 end if;
 if coalesce(category,s.default_category_id) is null and exists(select 1 from jsonb_array_elements(p_document->'lines') where value->>'kind'='expense') then raise exception 'Selecciona una categoría para el gasto';end if;
 -- Existing unique supplier/number index remains: treat conflicting dates/totals as a review, never silently merge.
 select id into iid from public.invoices where owner_id=o and supplier_id=s.id and public.invoice_engine_name_key(invoice_number)=public.invoice_engine_name_key(full_number) and issue_date=issue and currency=p_document->>'currency' and abs(total_amount-total)<.005 limit 1;
 if iid is not null then insert into public.invoice_engine_identities values(o,fp,iid);update public.invoice_engine_jobs set invoice_id=iid,status='duplicate' where id=j.id;return jsonb_build_object('invoiceId',iid,'duplicate',true);end if;
 if exists(select 1 from public.invoices where owner_id=o and supplier_id=s.id and public.invoice_engine_name_key(invoice_number)=public.invoice_engine_name_key(full_number)) then raise exception 'Mismo proveedor/número con distinta fecha o total: revisión necesaria';end if;
 select * into src from public.source_documents where id=j.source_document_id and owner_id=o;
 if src.id is null then raise exception 'Original ajeno';end if;
 insert into public.invoices(owner_id,supplier_id,invoice_number,issue_date,expense_category_id,net_amount,tax_amount,total_amount,withholding_amount,equivalence_surcharge_amount,currency,source,status,source_document_id,file_path,file_name,mime_type,file_hash,extraction,extraction_confidence,invoice_type,invoice_series,due_date,payment_method,order_reference,delivery_note_reference,vat_breakdown,qr_payload,intracommunity,reverse_charge,field_confidence)
 values(o,s.id,full_number,issue,coalesce(category,s.default_category_id),net,vat,total,coalesce((p_document->>'withholding')::numeric,0),coalesce((p_document->>'surcharge')::numeric,0),p_document->>'currency',j.source_channel,case when p_reviewed then 'reviewed' else 'pending' end,src.id,src.storage_path,src.original_name,src.mime_type,src.file_hash,jsonb_build_object('invoiceEngine',p_document,'engineVersion',1,'reviewedByUser',p_reviewed,'sourceMetadata',j.metadata),(p_document#>>'{confidence,total}')::numeric,p_document->>'type',p_document->>'series',nullif(p_document->>'dueDate','')::date,p_document->>'paymentMethod',p_document->>'orderNumber',p_document->>'deliveryNoteNumber',p_document->'taxes',coalesce(p_document->>'qrVerifactu',p_document->>'qrTicketBai'),coalesce((p_document->>'intraCommunity')::boolean,false),coalesce((p_document->>'reverseCharge')::boolean,false),p_document->'confidence') returning id into iid;
 for l in select value from jsonb_array_elements(p_document->'lines') loop
  pid:=null;spid:=null;old_date:=null;units:=1;
  if l->>'kind'='product' then
   if nullif(l->>'reference','') is not null then
    select count(distinct sp.product_id) into matches from public.supplier_products sp where sp.owner_id=o and sp.supplier_id=s.id and public.invoice_engine_name_key(sp.supplier_sku)=public.invoice_engine_name_key(l->>'reference');
    if matches>1 then raise exception 'Referencia de proveedor ambigua';end if;
    select sp.id,sp.product_id into spid,pid from public.supplier_products sp where sp.owner_id=o and sp.supplier_id=s.id and public.invoice_engine_name_key(sp.supplier_sku)=public.invoice_engine_name_key(l->>'reference') limit 1;
   end if;
   if pid is null then
    select count(*) into matches from public.supplier_products sp where sp.owner_id=o and sp.supplier_id=s.id and (nullif(l->>'reference','') is null or nullif(sp.supplier_sku,'') is null) and public.invoice_engine_name_similarity(sp.supplier_description,l->>'description')>=.85;
    if matches>1 then raise exception 'Descripción de producto ambigua';end if;
    select sp.id,sp.product_id into spid,pid from public.supplier_products sp where sp.owner_id=o and sp.supplier_id=s.id and (nullif(l->>'reference','') is null or nullif(sp.supplier_sku,'') is null) and public.invoice_engine_name_similarity(sp.supplier_description,l->>'description')>=.85 limit 1;
   end if;
   if pid is null then
    select count(*) into matches from public.products p where p.owner_id=o and public.invoice_engine_name_similarity(p.name,l->>'description')>=.85 and (nullif(l->>'reference','') is null or nullif(p.sku,'') is null or public.invoice_engine_name_key(p.sku)=public.invoice_engine_name_key(l->>'reference')) and not exists(select 1 from public.supplier_products conflicting where conflicting.owner_id=o and conflicting.supplier_id=s.id and conflicting.product_id=p.id and nullif(l->>'reference','') is not null and nullif(conflicting.supplier_sku,'') is not null and public.invoice_engine_name_key(conflicting.supplier_sku)<>public.invoice_engine_name_key(l->>'reference'));
    if matches>1 then raise exception 'Producto ambiguo: revisar descripción o referencia';end if;
    select p.id into pid from public.products p where p.owner_id=o and public.invoice_engine_name_similarity(p.name,l->>'description')>=.85 and (nullif(l->>'reference','') is null or nullif(p.sku,'') is null or public.invoice_engine_name_key(p.sku)=public.invoice_engine_name_key(l->>'reference')) and not exists(select 1 from public.supplier_products conflicting where conflicting.owner_id=o and conflicting.supplier_id=s.id and conflicting.product_id=p.id and nullif(l->>'reference','') is not null and nullif(conflicting.supplier_sku,'') is not null and public.invoice_engine_name_key(conflicting.supplier_sku)<>public.invoice_engine_name_key(l->>'reference')) limit 1;
    if pid is null then insert into public.products(owner_id,name,base_unit) values(o,l->>'description',coalesce(nullif(l->>'unit',''),'ud')) returning id into pid;end if;
    insert into public.supplier_products(owner_id,supplier_id,product_id,supplier_sku,supplier_description,purchase_unit) values(o,s.id,pid,nullif(l->>'reference',''),(l->>'description')||case when nullif(l->>'reference','') is not null then ' ['||(l->>'reference')||']' else '' end,coalesce(nullif(l->>'unit',''),'ud')) returning id into spid;
   end if;
   select units_per_purchase into units from public.supplier_products where id=spid and owner_id=o;
   select last_purchase_date,last_cost into old_date,old_cost from public.products where id=pid and owner_id=o;
  end if;
  -- Native trigger captures history and cost only for newer, positive EUR purchases.
  insert into public.invoice_lines(owner_id,invoice_id,product_id,supplier_product_id,description,supplier_sku,quantity,unit,units_per_purchase,unit_price,normalized_unit_price,discount_percent,line_net,tax_rate,tax_amount,line_total,ai_confidence,price_update_status)
  values(o,iid,pid,spid,l->>'description',nullif(l->>'reference',''),(l->>'quantity')::numeric,coalesce(nullif(l->>'unit',''),'ud'),coalesce(units,1),(l->>'unitPrice')::numeric,(l->>'unitPrice')::numeric*(1-coalesce((l->>'discountPercent')::numeric,0)/100)/coalesce(units,1),coalesce((l->>'discountPercent')::numeric,0),(l->>'net')::numeric,(l->>'vatRate')::numeric,(l->>'vat')::numeric,(l->>'total')::numeric,coalesce((l->>'confidence')::numeric,(p_document#>>'{confidence,lines}')::numeric),case when pid is not null and total>0 and (old_date is null or issue>=old_date) and p_document->>'currency'=base_currency and update_cost and record_history and coalesce(cfg#>>'{products,costMethod}','last_purchase')='last_purchase' then 'confirmed' else 'ignored' end) returning id into lineid;
  if pid is not null and total>0 and p_document->>'currency'=base_currency then
   cost:=(l->>'unitPrice')::numeric*(1-coalesce((l->>'discountPercent')::numeric,0)/100)/coalesce(units,1);
   if record_history then insert into public.product_price_history(owner_id,product_id,supplier_id,invoice_id,invoice_line_id,price_date,purchase_unit_price,normalized_unit_price,base_unit,currency) values(o,pid,s.id,iid,lineid,issue,(l->>'unitPrice')::numeric,cost,coalesce(nullif(l->>'unit',''),'ud'),base_currency) on conflict(invoice_line_id) do nothing;end if;
   if update_cost and (old_date is null or issue>=old_date) and (not record_history or coalesce(cfg#>>'{products,costMethod}','last_purchase')='average') then
    if cfg#>>'{products,costMethod}'='average' then select avg(normalized_unit_price) into cost from public.product_price_history where owner_id=o and product_id=pid and currency=base_currency;end if;
    if cost is not null then update public.products set previous_cost=case when last_cost is distinct from cost then last_cost else previous_cost end,last_cost=cost,last_supplier_id=s.id,last_purchase_date=issue where id=pid and owner_id=o;end if;
   end if;
  end if;
 end loop;
 insert into public.invoice_engine_identities values(o,fp,iid);
 if p_reviewed and p_document is distinct from j.original_extraction and tax<>'' then
  select coalesce(jsonb_object_agg(key,value),'{}') into changes from jsonb_each(p_document) where value is distinct from j.original_extraction->key;
  insert into public.invoice_engine_corrections(owner_id,supplier_tax_id,job_id,original,corrected,changes) values(o,tax,j.id,j.original_extraction,p_document,changes) on conflict(job_id) do nothing;
 end if;
 update public.invoice_engine_jobs set invoice_id=iid,status='imported',document=p_document,updated_at=now() where id=j.id;
 return jsonb_build_object('invoiceId',iid,'duplicate',false);
end $$;
revoke all on function public.invoice_engine_context(),public.invoice_engine_stage(uuid,text,jsonb,text,text,jsonb),public.invoice_engine_commit(uuid,jsonb,boolean) from public,anon;
grant execute on function public.invoice_engine_context(),public.invoice_engine_stage(uuid,text,jsonb,text,text,jsonb),public.invoice_engine_commit(uuid,jsonb,boolean) to authenticated;
-- New private bucket: keep original HTML/HEIC evidence without changing the existing bucket.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('invoice-engine-originals','invoice-engine-originals',false,26214400,array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif','text/html','application/octet-stream']);
create policy invoice_engine_original_upload on storage.objects for insert to authenticated with check
 (bucket_id='invoice-engine-originals' and (storage.foldername(name))[1]=(select auth.uid())::text and ((select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail'))));
create policy invoice_engine_original_read on storage.objects for select to authenticated using
 (bucket_id='invoice-engine-originals' and (select private.app_storage_folder_in_workspace((storage.foldername(name))[1])) and ((select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail'))));

create policy invoice_engine_job_links on public.invoice_engine_jobs as restrictive for all to authenticated using(true) with check(exists(select 1 from public.source_documents d where d.id=source_document_id and d.owner_id=invoice_engine_jobs.owner_id));
create policy invoice_engine_identity_links on public.invoice_engine_identities as restrictive for insert to authenticated with check(exists(select 1 from public.invoices i where i.id=invoice_id and i.owner_id=invoice_engine_identities.owner_id));
create policy invoice_engine_correction_links on public.invoice_engine_corrections as restrictive for insert to authenticated with check(corrected_by=(select auth.uid()) and exists(select 1 from public.invoice_engine_jobs j where j.id=job_id and j.owner_id=invoice_engine_corrections.owner_id));
