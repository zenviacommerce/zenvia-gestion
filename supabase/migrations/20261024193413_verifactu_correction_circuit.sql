BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
SET LOCAL search_path='';
-- Additive only: no historic invoice/line/status updates and no backfill.
ALTER TABLE public.sales_invoices ADD COLUMN rectification_reason text,
 ADD COLUMN rectification_original_number text, ADD COLUMN rectification_original_date date,
 ADD COLUMN rectification_original_base numeric, ADD COLUMN rectification_original_tax numeric;
-- Use the base migration's private immutable backup store for coordinated rollback.
INSERT INTO private.verifactu_migration_backup(signature,definition)
SELECT 'correction:'||p.oid::regprocedure::text,pg_get_functiondef(p.oid)
FROM pg_proc p WHERE p.oid IN('private.vf_issue_invoice(uuid,boolean)'::regprocedure,'private.vf_cancel_document(uuid,text,text)'::regprocedure,'private.vf_append_record(uuid,text,uuid,text)'::regprocedure,'private.vf_shadow_status()'::regprocedure);

CREATE FUNCTION private.mfa_impl_create_sales_invoice_correction(p_original_id uuid,p_type text,p_mode text,p_reason text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o uuid:=private.vf_actor_owner(); i public.sales_invoices; s uuid; v_id uuid:=gen_random_uuid(); d date:=(clock_timestamp() AT TIME ZONE 'Europe/Madrid')::date;
BEGIN
 -- All three fiscal actions take this lock BEFORE document rows, so issuing a
 -- child and cancelling its parent cannot invert parent/child row lock order.
 PERFORM pg_advisory_xact_lock(hashtextextended('vf-correction:'||o::text,0));
 SELECT * INTO i FROM public.sales_invoices WHERE id=p_original_id AND owner_id=o FOR UPDATE;
 IF i.id IS NULL OR i.status IN('draft','cancelled') OR i.document_kind<>'invoice' OR EXISTS(SELECT 1 FROM private.verifactu_cancellations WHERE owner_id=o AND document_kind='invoice' AND document_id=i.id) THEN RAISE EXCEPTION 'VF_RECTIFIED_DOCUMENT_INVALID';END IF;
 IF p_type IS NULL OR p_type NOT IN('R1','R2','R3','R4','R5') OR p_mode IS NULL OR p_mode NOT IN('S','I') OR ((coalesce(i.verifactu_type,'F1') IN('F2','R5')) IS DISTINCT FROM (p_type='R5')) THEN RAISE EXCEPTION 'VF_DOCUMENT_CLASSIFICATION_INVALID';END IF;
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'VF_RECTIFICATION_REASON_REQUIRED';END IF;
 IF EXISTS(SELECT 1 FROM public.sales_invoices child WHERE child.owner_id=o AND child.rectifies_invoice_id=i.id AND child.status NOT IN('draft','cancelled') AND (p_mode='S' OR child.rectification_mode='S') AND NOT EXISTS(SELECT 1 FROM private.verifactu_cancellations annulled_child WHERE annulled_child.owner_id=o AND annulled_child.document_kind='invoice' AND annulled_child.document_id=child.id)) THEN RAISE EXCEPTION 'VF_CORRECTION_TARGET_SUPERSEDED';END IF;
 SELECT id INTO s FROM public.sales_invoice_series WHERE owner_id=o AND kind='rectifying' AND active AND year=extract(year FROM d)::integer ORDER BY code,id LIMIT 1;
 IF s IS NULL THEN RAISE EXCEPTION 'VF_RECTIFICATION_SERIES_REQUIRED';END IF;
 INSERT INTO public.sales_invoices(id,owner_id,client_id,series_id,invoice_type,rectifies_invoice_id,issue_date,operation_date,currency,payment_method,payment_method_id,notes,tax_registration_id,document_kind,fiscal_treatment,fiscal_reason,bank_account_id,verifactu_type,rectification_mode,rectification_reason,rectification_original_number,rectification_original_date,rectification_original_base,rectification_original_tax)
 VALUES(v_id,o,i.client_id,s,'rectifying',i.id,d,coalesce(i.operation_date,i.issue_date),i.currency,i.payment_method,i.payment_method_id,i.notes,i.tax_registration_id,'invoice',i.fiscal_treatment,i.fiscal_reason,i.bank_account_id,p_type,p_mode,btrim(p_reason),i.invoice_number,i.issue_date,i.subtotal,i.tax_amount);
 INSERT INTO public.sales_invoice_lines(owner_id,invoice_id,product_id,position,description,quantity,unit,unit_price,discount_percent,tax_rate)
 SELECT o,v_id,product_id,position,description,quantity,unit,CASE WHEN p_mode='S' THEN unit_price ELSE 0 END,discount_percent,tax_rate FROM public.sales_invoice_lines WHERE invoice_id=i.id AND owner_id=o ORDER BY position,id;
 IF NOT FOUND THEN RAISE EXCEPTION 'VF_LINES_INVALID';END IF;
 RETURN v_id;
END$$;
CREATE FUNCTION private.vf_correction_identity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF old.rectification_original_number IS NOT NULL AND
 (new.rectifies_invoice_id,new.rectification_mode,new.rectification_original_number,new.rectification_original_date,new.rectification_original_base,new.rectification_original_tax)
 IS DISTINCT FROM
 (old.rectifies_invoice_id,old.rectification_mode,old.rectification_original_number,old.rectification_original_date,old.rectification_original_base,old.rectification_original_tax)
 THEN RAISE EXCEPTION 'VF_CORRECTION_IDENTITY_IMMUTABLE';END IF;
 RETURN new;
END$$;
CREATE TRIGGER vf_correction_identity_guard BEFORE UPDATE ON public.sales_invoices FOR EACH ROW EXECUTE FUNCTION private.vf_correction_identity_guard();

CREATE OR REPLACE FUNCTION private.vf_issue_invoice(p_id uuid,p_receipt boolean DEFAULT false) RETURNS public.sales_invoices LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o uuid:=private.vf_actor_owner();i public.sales_invoices;s public.sales_invoice_series;c public.clients;b public.business_settings;t public.business_tax_registrations;cfg private.verifactu_settings;v_number text; original public.sales_invoices;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('vf-correction:'||o::text,0));
 SELECT * INTO i FROM public.sales_invoices WHERE id=p_id AND owner_id=o FOR UPDATE;
 IF i.id IS NULL THEN RAISE EXCEPTION 'VF_DOCUMENT_NOT_FOUND';END IF;
 IF p_receipt AND i.document_kind<>'receipt' THEN RAISE EXCEPTION 'VF_RECEIPT_KIND_REQUIRED';END IF;
 IF NOT p_receipt AND i.document_kind<>'invoice' THEN RAISE EXCEPTION 'VF_INVOICE_KIND_REQUIRED';END IF;
 IF i.status<>'draft' THEN RETURN i;END IF; -- retries never consume another number or hash
 IF (i.invoice_type='standard' AND (coalesce(i.verifactu_type,'F1') NOT IN('F1','F2','F3') OR i.rectifies_invoice_id IS NOT NULL OR i.rectification_mode IS NOT NULL))
 OR (i.invoice_type='rectifying' AND (i.verifactu_type IS NULL OR i.verifactu_type NOT IN('R1','R2','R3','R4','R5') OR i.rectification_mode IS NULL OR i.rectifies_invoice_id IS NULL)) THEN
  RAISE EXCEPTION 'VF_DOCUMENT_CLASSIFICATION_INVALID';
 END IF;
 IF i.invoice_type='rectifying' THEN
  SELECT * INTO original FROM public.sales_invoices WHERE id=i.rectifies_invoice_id AND owner_id=o FOR UPDATE;
  IF original.id IS NULL OR original.status IN('draft','cancelled') OR original.document_kind<>'invoice' OR original.currency IS DISTINCT FROM i.currency OR EXISTS(SELECT 1 FROM private.verifactu_cancellations WHERE owner_id=o AND document_kind='invoice' AND document_id=original.id) THEN RAISE EXCEPTION 'VF_RECTIFIED_DOCUMENT_INVALID';END IF;
  IF EXISTS(SELECT 1 FROM public.sales_invoices child WHERE child.owner_id=o AND child.rectifies_invoice_id=original.id AND child.id<>i.id AND child.status NOT IN('draft','cancelled') AND (i.rectification_mode='S' OR child.rectification_mode='S') AND NOT EXISTS(SELECT 1 FROM private.verifactu_cancellations annulled_child WHERE annulled_child.owner_id=o AND annulled_child.document_kind='invoice' AND annulled_child.document_id=child.id)) THEN RAISE EXCEPTION 'VF_CORRECTION_TARGET_SUPERSEDED';END IF;
  IF i.rectification_mode NOT IN('S','I') OR ((coalesce(original.verifactu_type,'F1') IN('F2','R5')) IS DISTINCT FROM (i.verifactu_type='R5')) THEN RAISE EXCEPTION 'VF_DOCUMENT_CLASSIFICATION_INVALID';END IF;
  IF i.rectification_reason IS NULL OR length(btrim(i.rectification_reason)) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'VF_RECTIFICATION_REASON_REQUIRED';END IF;
  IF (i.rectification_original_number,i.rectification_original_date,i.rectification_original_base,i.rectification_original_tax) IS DISTINCT FROM (original.invoice_number,original.issue_date,original.subtotal,original.tax_amount) THEN RAISE EXCEPTION 'VF_RECTIFICATION_SNAPSHOT_INVALID';END IF;
 END IF;
 -- Child writers lock this parent before changing lines. Recompute under the
 -- same parent lock: editable draft header totals are never a fiscal input.
 UPDATE public.sales_invoices SET
 subtotal=(SELECT coalesce(round(sum(line_net),2),0) FROM public.sales_invoice_lines WHERE invoice_id=i.id),
 discount_amount=(SELECT coalesce(round(sum(quantity*unit_price),2)-round(sum(line_net),2),0) FROM public.sales_invoice_lines WHERE invoice_id=i.id),
 tax_amount=(SELECT coalesce(round(sum(tax_amount),2),0) FROM public.sales_invoice_lines WHERE invoice_id=i.id),
 total_amount=(SELECT coalesce(round(sum(line_total),2),0) FROM public.sales_invoice_lines WHERE invoice_id=i.id)
 WHERE id=i.id AND owner_id=o RETURNING * INTO i;
 IF EXISTS(SELECT 1 FROM public.sales_invoice_lines WHERE invoice_id=i.id AND (quantity::text IN('NaN','Infinity','-Infinity') OR unit_price::text IN('NaN','Infinity','-Infinity') OR tax_rate::text IN('NaN','Infinity','-Infinity') OR discount_percent::text IN('NaN','Infinity','-Infinity'))) THEN RAISE EXCEPTION 'VF_LINES_INVALID';END IF;
 IF i.currency<>'EUR' THEN RAISE EXCEPTION 'VF_EUR_REQUIRED';END IF;
 IF i.total_amount IS NULL OR (i.invoice_type='standard' AND i.total_amount<=0) THEN RAISE EXCEPTION 'VF_DOCUMENT_TOTAL_INVALID';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sales_invoice_lines WHERE invoice_id=i.id AND owner_id=o) OR EXISTS(SELECT 1 FROM public.sales_invoice_lines WHERE invoice_id=i.id AND owner_id<>o) THEN RAISE EXCEPTION 'VF_LINES_INVALID';END IF;
 IF i.invoice_type='rectifying' AND NOT EXISTS(SELECT 1 FROM public.sales_invoices x WHERE x.id=i.rectifies_invoice_id AND x.owner_id=o AND x.status<>'draft' AND x.currency=i.currency) THEN RAISE EXCEPTION 'VF_RECTIFIED_DOCUMENT_INVALID';END IF;
 IF i.document_kind='receipt' AND i.fiscal_treatment<>'taxable' AND (coalesce(btrim(i.fiscal_reason),'')='' OR EXISTS(SELECT 1 FROM public.sales_invoice_lines WHERE invoice_id=i.id AND coalesce(tax_rate,0)<>0)) THEN RAISE EXCEPTION 'VF_RECEIPT_TAX_REASON_REQUIRED';END IF;
 SELECT * INTO c FROM public.clients WHERE id=i.client_id AND owner_id=o;
 SELECT * INTO b FROM public.business_settings WHERE owner_id=o;
 IF c.id IS NULL OR b.owner_id IS NULL OR coalesce(btrim(b.legal_name),'')='' OR coalesce(btrim(b.tax_id),'')='' OR coalesce(btrim(b.address_line1),'')='' OR coalesce(btrim(b.postal_code),'')='' OR coalesce(btrim(b.city),'')='' THEN RAISE EXCEPTION 'VF_FISCAL_PARTIES_INCOMPLETE';END IF;
 IF i.tax_registration_id IS NOT NULL THEN SELECT * INTO t FROM public.business_tax_registrations WHERE id=i.tax_registration_id AND owner_id=o AND active;
  IF t.id IS NULL THEN RAISE EXCEPTION 'VF_TAX_REGISTRATION_INVALID';END IF;
 ELSE SELECT * INTO t FROM public.business_tax_registrations WHERE owner_id=o AND active AND is_default LIMIT 1;END IF;
 INSERT INTO private.verifactu_settings(owner_id) SELECT o WHERE NOT EXISTS(SELECT 1 FROM private.verifactu_settings WHERE owner_id=o) ON CONFLICT DO NOTHING;
 SELECT * INTO cfg FROM private.verifactu_settings WHERE owner_id=o FOR SHARE;
 IF cfg.mode='shadow' THEN PERFORM private.vf_lock_chain(o,cfg.issuer_nif,cfg.installation_id);END IF;
 SELECT * INTO s FROM public.sales_invoice_series WHERE id=i.series_id AND owner_id=o FOR UPDATE;
 IF s.id IS NULL OR (i.document_kind='receipt' AND s.kind<>'receipt') OR (i.document_kind<>'receipt' AND ((i.invoice_type='standard' AND s.kind<>'standard') OR (i.invoice_type='rectifying' AND s.kind<>'rectifying'))) THEN RAISE EXCEPTION 'VF_SERIES_KIND_INVALID';END IF;
 v_number:=private.vf_allocate_number(o,i.series_id,i.issue_date);
 UPDATE public.sales_invoices SET invoice_number=v_number,reserved_number=NULL,status='issued',issued_at=clock_timestamp(),
 tax_registration_id=coalesce(t.id,tax_registration_id),client_name=c.name,client_tax_id=c.tax_id,client_email=c.email,client_phone=c.phone,
 client_address=concat_ws(', ',nullif(c.address_line1,''),nullif(c.address_line2,''),nullif(concat_ws(' ',nullif(c.postal_code,''),nullif(c.city,'')),''),nullif(c.province,''),nullif(c.country_code,'')),
 issuer_name=coalesce(nullif(t.fiscal_name,''),b.legal_name),issuer_tax_id=coalesce(nullif(t.vat_number,''),b.tax_id),issuer_email=b.email,issuer_phone=b.phone,
 issuer_address=coalesce(nullif(t.address_text,''),concat_ws(', ',nullif(b.address_line1,''),nullif(b.address_line2,''),nullif(concat_ws(' ',nullif(b.postal_code,''),nullif(b.city,'')),''),nullif(b.province,''),nullif(b.country_code,''))),
 issuer_tax_country_code=coalesce(t.country_code,b.country_code),issuer_tax_registration_label=t.label
 WHERE id=i.id AND owner_id=o RETURNING * INTO i;
 -- Do not overwrite the original invoice's status/totals when rectifying it.
 RETURN i;
END$$;
CREATE OR REPLACE FUNCTION private.vf_cancel_document(p_document_id uuid,p_document_kind text,p_reason text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o uuid:=private.vf_actor_owner();v_existing private.verifactu_cancellations;v_status text;v_alta uuid;v_record uuid;v_id uuid:=gen_random_uuid();reason text:=btrim(p_reason);
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('vf-correction:'||o::text,0));
 IF p_document_kind NOT IN('invoice','receipt') OR reason IS NULL OR length(reason) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'VF_CANCELLATION_REASON_REQUIRED';END IF;
 IF p_document_kind='invoice' THEN SELECT status INTO v_status FROM public.sales_invoices WHERE id=p_document_id AND owner_id=o FOR UPDATE;
 ELSE SELECT status INTO v_status FROM public.sales_receipts WHERE id=p_document_id AND owner_id=o FOR UPDATE;END IF;
 IF v_status IS NULL OR v_status='draft' THEN RAISE EXCEPTION 'VF_ISSUED_DOCUMENT_REQUIRED';END IF;
 SELECT * INTO v_existing FROM private.verifactu_cancellations WHERE owner_id=o AND document_kind=p_document_kind AND document_id=p_document_id;
 IF FOUND THEN IF v_existing.reason<>reason THEN RAISE EXCEPTION 'VF_CANCELLATION_CONFLICT';END IF;RETURN v_existing.id;END IF;
 IF p_document_kind='invoice' THEN
  IF EXISTS(SELECT 1 FROM public.sales_invoices child WHERE child.owner_id=o AND child.rectifies_invoice_id=p_document_id AND child.status NOT IN('draft','cancelled') AND NOT EXISTS(SELECT 1 FROM private.verifactu_cancellations annulled_child WHERE annulled_child.owner_id=o AND annulled_child.document_kind='invoice' AND annulled_child.document_id=child.id)) THEN RAISE EXCEPTION 'VF_ACTIVE_CORRECTIONS';END IF;
  SELECT id INTO v_alta FROM private.verifactu_records WHERE owner_id=o AND invoice_id=p_document_id AND record_kind='alta';
  IF v_alta IS NOT NULL THEN v_record:=private.vf_append_record(p_document_id,'anulacion',v_alta,reason);END IF;
 END IF;
 INSERT INTO private.verifactu_cancellations(id,owner_id,document_kind,document_id,reason,actor_id,cancelled_at,record_id) VALUES(v_id,o,p_document_kind,p_document_id,reason,auth.uid(),clock_timestamp(),v_record);
 PERFORM private.vf_event(o,'document_cancelled',p_document_kind,p_document_id,jsonb_build_object('cancellationId',v_id,'recordId',v_record,'outsideFiscalCutover',v_record IS NULL));
 RETURN v_id;
END$$;

-- Disabling capture stops new altas; existing altas retain chained cancellation.
CREATE OR REPLACE FUNCTION private.vf_append_record(p_invoice uuid,p_kind text,p_alta uuid DEFAULT NULL,p_reason text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.sales_invoices;c private.verifactu_settings;ch private.verifactu_chains;alta private.verifactu_records;
 fields jsonb;v_input text;v_hash text;v_snapshot jsonb;v_now timestamptz;v_lex text;v_id uuid:=gen_random_uuid();v_type text;
BEGIN
 SELECT * INTO i FROM public.sales_invoices WHERE id=p_invoice;
 SELECT * INTO c FROM private.verifactu_settings WHERE owner_id=i.owner_id FOR SHARE;
 IF p_kind='alta' AND c.mode IS DISTINCT FROM 'shadow' THEN RAISE EXCEPTION 'VF_SHADOW_DISABLED';END IF;
 IF private.vf_text(i.issuer_tax_id) IS DISTINCT FROM private.vf_text(c.issuer_nif) THEN RAISE EXCEPTION 'VF_ISSUER_NIF_MISMATCH';END IF;
 PERFORM private.vf_lock_chain(i.owner_id,c.issuer_nif,c.installation_id);
 SELECT * INTO ch FROM private.verifactu_chains WHERE owner_id=i.owner_id AND issuer_nif=c.issuer_nif AND installation_id=c.installation_id FOR UPDATE;
 -- A cancellation may wait for another document's chain lock. Timestamp the
 -- record after acquiring that lock so sequence and generation time agree.
 v_now:=clock_timestamp();
 v_lex:=private.vf_offset_time(v_now);
 IF p_kind='alta' THEN
  v_type:=coalesce(i.verifactu_type,CASE WHEN i.document_kind='receipt' THEN 'F2' WHEN i.invoice_type='standard' THEN 'F1' END);
  IF v_type IS NULL OR (i.invoice_type='rectifying' AND (v_type NOT IN('R1','R2','R3','R4','R5') OR i.rectification_mode IS NULL)) THEN RAISE EXCEPTION 'VF_RECTIFICATION_CLASSIFICATION_REQUIRED';END IF;
  fields:=jsonb_build_object('IDEmisorFactura',c.issuer_nif,'NumSerieFactura',i.invoice_number,'FechaExpedicionFactura',to_char(i.issue_date,'DD-MM-YYYY'),'TipoFactura',v_type,'CuotaTotal',private.vf_money(i.tax_amount::text),'ImporteTotal',private.vf_money(i.total_amount::text),'Huella',ch.last_hash,'FechaHoraHusoGenRegistro',v_lex);
  SELECT jsonb_build_object('invoice',to_jsonb(i),'lines',coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.position,l.id),'[]'::jsonb)) INTO v_snapshot FROM public.sales_invoice_lines l WHERE l.invoice_id=i.id AND l.owner_id=i.owner_id;
 ELSE
  SELECT * INTO alta FROM private.verifactu_records WHERE id=p_alta AND owner_id=i.owner_id AND invoice_id=i.id AND record_kind='alta';
  IF alta.id IS NULL OR alta.installation_id<>c.installation_id OR alta.issuer_nif<>c.issuer_nif THEN RAISE EXCEPTION 'VF_ALTA_RECORD_REQUIRED';END IF;
  fields:=jsonb_build_object('IDEmisorFacturaAnulada',alta.hash_fields->>'IDEmisorFactura','NumSerieFacturaAnulada',alta.hash_fields->>'NumSerieFactura','FechaExpedicionFacturaAnulada',alta.hash_fields->>'FechaExpedicionFactura','Huella',ch.last_hash,'FechaHoraHusoGenRegistro',v_lex);
  v_snapshot:=jsonb_build_object('altaRecordId',alta.id,'invoiceId',i.id,'reason',p_reason,'actor',auth.uid());
 END IF;
 v_input:=private.vf_hash_input(p_kind,fields);v_hash:=private.vf_sha256(v_input);
 INSERT INTO private.verifactu_records(id,owner_id,issuer_nif,installation_id,sequence,invoice_id,record_kind,alta_record_id,generated_at,generated_at_with_offset,previous_hash,hash,hash_input,hash_fields,snapshot)
 VALUES(v_id,i.owner_id,c.issuer_nif,c.installation_id,ch.last_sequence+1,i.id,p_kind,p_alta,v_now,v_lex,ch.last_hash,v_hash,v_input,fields,v_snapshot);
 UPDATE private.verifactu_chains SET last_sequence=last_sequence+1,last_hash=v_hash,last_record_id=v_id WHERE owner_id=i.owner_id AND issuer_nif=c.issuer_nif AND installation_id=c.installation_id;
 RETURN v_id;
END$$;

-- Dashboard readers have the same owner-scoped read access as invoice RLS.
CREATE OR REPLACE FUNCTION private.vf_shadow_status() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE o uuid:=private.app_workspace_owner_id();BEGIN
 IF auth.uid() IS NULL OR o IS NULL OR NOT (coalesce(private.app_has_permission('sales'),false) OR coalesce(private.app_has_permission('dashboard'),false)) THEN RAISE EXCEPTION 'VF_ACCESS_DENIED' USING ERRCODE='42501';END IF;
 PERFORM public.security_mfa_assert(false);
 RETURN jsonb_build_object('mode',coalesce((SELECT mode FROM private.verifactu_settings WHERE owner_id=o),'disabled'),'records',(SELECT count(*) FROM private.verifactu_records WHERE owner_id=o),'cancellations',(SELECT coalesce(jsonb_agg(jsonb_build_object('documentId',document_id,'documentKind',document_kind,'cancelledAt',cancelled_at)),'[]'::jsonb) FROM private.verifactu_cancellations WHERE owner_id=o),'aeatConnected',false);END$$;

CREATE FUNCTION public.create_sales_invoice_correction(p_original_id uuid,p_type text,p_mode text,p_reason text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501';END IF;
 PERFORM public.security_mfa_assert(false);
 RETURN private.mfa_impl_create_sales_invoice_correction(p_original_id,p_type,p_mode,p_reason);
END$$;
REVOKE ALL ON FUNCTION public.create_sales_invoice_correction(uuid,text,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.create_sales_invoice_correction(uuid,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION private.mfa_impl_create_sales_invoice_correction(uuid,text,text,text),private.vf_correction_identity_guard() FROM PUBLIC,anon,authenticated,service_role;
-- Unchanged public issue/cancel wrappers retain their signatures, hashes and ACL.
-- Canonical pg_get_functiondef exactly matches the real MFA gate's search_path.
INSERT INTO private.mfa_function_manifest(signature,function_oid,implementation,original_definition,wrapper_hash)
SELECT p.oid::regprocedure::text,p.oid,'private.mfa_impl_create_sales_invoice_correction(uuid,text,text,text)'::regprocedure,pg_get_functiondef(p.oid),md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.oid='public.create_sales_invoice_correction(uuid,text,text,text)'::regprocedure;
-- A correction save is one transaction with the same pre-row owner lock as issue.
CREATE FUNCTION private.mfa_impl_save_sales_invoice_correction(p_invoice_id uuid,p_header jsonb,p_lines jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o uuid:=private.vf_actor_owner();i public.sales_invoices;v public.sales_invoices;k text;l jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('vf-correction:'||o::text,0));
 SELECT * INTO i FROM public.sales_invoices WHERE id=p_invoice_id AND owner_id=o FOR UPDATE;
 IF i.id IS NULL THEN RAISE EXCEPTION 'VF_DOCUMENT_NOT_FOUND';END IF;
 IF i.status<>'draft' OR i.invoice_type<>'rectifying' THEN RAISE EXCEPTION 'VF_CORRECTION_DRAFT_REQUIRED';END IF;
 IF jsonb_typeof(p_header) IS DISTINCT FROM 'object' OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'VF_CORRECTION_SAVE_INVALID';END IF;
 IF jsonb_array_length(p_lines) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'VF_LINES_INVALID';END IF;
 FOR k IN SELECT jsonb_object_keys(p_header) LOOP
  IF k NOT IN('client_id','series_id','tax_registration_id','issue_date','operation_date','due_date','currency','payment_method','payment_method_id','bank_account_id','notes','verifactu_type','rectification_reason') OR jsonb_typeof(p_header->k) NOT IN('string','null') THEN RAISE EXCEPTION 'VF_CORRECTION_SAVE_INVALID';END IF;
  IF k IN('client_id','series_id','issue_date','currency','verifactu_type','rectification_reason') AND p_header->k='null'::jsonb THEN RAISE EXCEPTION 'VF_CORRECTION_SAVE_INVALID';END IF;
 END LOOP;
 SELECT * INTO v FROM jsonb_populate_record(NULL::public.sales_invoices,to_jsonb(i)||p_header);
 IF v.verifactu_type IS NULL OR v.verifactu_type NOT IN('R1','R2','R3','R4','R5') THEN RAISE EXCEPTION 'VF_DOCUMENT_CLASSIFICATION_INVALID';END IF;
 IF v.rectification_reason IS NULL OR length(btrim(v.rectification_reason)) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'VF_RECTIFICATION_REASON_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clients WHERE id=v.client_id AND owner_id=o) OR NOT EXISTS(SELECT 1 FROM public.sales_invoice_series WHERE id=v.series_id AND owner_id=o AND kind='rectifying' AND active) THEN RAISE EXCEPTION 'VF_CORRECTION_SAVE_INVALID';END IF;
 IF v.tax_registration_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.business_tax_registrations WHERE id=v.tax_registration_id AND owner_id=o AND active) THEN RAISE EXCEPTION 'VF_TAX_REGISTRATION_INVALID';END IF;
 FOR l IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  IF jsonb_typeof(l) IS DISTINCT FROM 'object' OR jsonb_typeof(l->'description') IS DISTINCT FROM 'string' OR coalesce(btrim(l->>'description'),'')='' OR jsonb_typeof(l->'quantity') IS DISTINCT FROM 'number' OR jsonb_typeof(l->'unit_price') IS DISTINCT FROM 'number' OR jsonb_typeof(l->'tax_rate') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'VF_LINES_INVALID';END IF;
  IF (l->>'quantity')::numeric<=0 OR (l->>'tax_rate')::numeric NOT BETWEEN 0 AND 100 OR (l ? 'discount_percent' AND (jsonb_typeof(l->'discount_percent') IS DISTINCT FROM 'number' OR (l->>'discount_percent')::numeric NOT BETWEEN 0 AND 100)) OR (l ? 'unit' AND (jsonb_typeof(l->'unit') IS DISTINCT FROM 'string' OR btrim(l->>'unit')='')) THEN RAISE EXCEPTION 'VF_LINES_INVALID';END IF;
  -- JSON numeric tokens cannot contain NaN/Infinity; numeric strings are rejected.
  IF l ? 'product_id' AND jsonb_typeof(l->'product_id') NOT IN('string','null') THEN RAISE EXCEPTION 'VF_LINES_INVALID';END IF;
  IF l->>'product_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.products WHERE id=(l->>'product_id')::uuid AND owner_id=o) THEN RAISE EXCEPTION 'VF_LINES_INVALID';END IF;
 END LOOP;
 UPDATE public.sales_invoices SET client_id=v.client_id,series_id=v.series_id,tax_registration_id=v.tax_registration_id,issue_date=v.issue_date,operation_date=v.operation_date,due_date=v.due_date,currency=v.currency,payment_method=v.payment_method,payment_method_id=v.payment_method_id,bank_account_id=v.bank_account_id,notes=v.notes,verifactu_type=v.verifactu_type,rectification_reason=btrim(v.rectification_reason) WHERE id=i.id AND owner_id=o;
 DELETE FROM public.sales_invoice_lines WHERE invoice_id=i.id AND owner_id=o;
 INSERT INTO public.sales_invoice_lines(owner_id,invoice_id,product_id,position,description,quantity,unit,unit_price,discount_percent,tax_rate)
 SELECT o,i.id,(x.line->>'product_id')::uuid,x.position::integer,btrim(x.line->>'description'),(x.line->>'quantity')::numeric,coalesce(x.line->>'unit','ud'),(x.line->>'unit_price')::numeric,coalesce((x.line->>'discount_percent')::numeric,0),(x.line->>'tax_rate')::numeric FROM jsonb_array_elements(p_lines) WITH ORDINALITY x(line,position);
 RETURN i.id;
END$$;
CREATE FUNCTION public.save_sales_invoice_correction(p_invoice_id uuid,p_header jsonb,p_lines jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501';END IF;
 PERFORM public.security_mfa_assert(false);
 RETURN private.mfa_impl_save_sales_invoice_correction(p_invoice_id,p_header,p_lines);
END$$;
REVOKE ALL ON FUNCTION public.save_sales_invoice_correction(uuid,jsonb,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.save_sales_invoice_correction(uuid,jsonb,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION private.mfa_impl_save_sales_invoice_correction(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO private.mfa_function_manifest(signature,function_oid,implementation,original_definition,wrapper_hash)
SELECT p.oid::regprocedure::text,p.oid,'private.mfa_impl_save_sales_invoice_correction(uuid,jsonb,jsonb)'::regprocedure,pg_get_functiondef(p.oid),md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.oid='public.save_sales_invoice_correction(uuid,jsonb,jsonb)'::regprocedure;

COMMIT;
