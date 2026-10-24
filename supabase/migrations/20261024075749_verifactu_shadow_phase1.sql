-- VERI*FACTU phase 1. DRAFT ONLY: no production execution is authorized.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';

-- Capture exact definitions for a pre-activation rollback, never invoice rows.
CREATE TABLE private.verifactu_migration_backup(signature text PRIMARY KEY,definition text NOT NULL);
INSERT INTO private.verifactu_migration_backup
SELECT p.oid::regprocedure::text,pg_get_functiondef(p.oid) FROM pg_proc p
WHERE p.oid IN(to_regprocedure('private.guard_sales_invoice_immutable()'),to_regprocedure('private.guard_sales_invoice_line_edit()'),to_regprocedure('private.assign_sales_receipt_number()'),to_regprocedure('private.bank_document_snapshot()'),to_regprocedure('private.set_default_sales_invoice_due_date()'),to_regprocedure('public.issue_sales_invoice(uuid)'),to_regprocedure('public.issue_sales_receipt(uuid)'),to_regprocedure('public.reopen_sales_invoice(uuid)'),to_regprocedure('public.delete_reversible_sales_invoice(uuid)'),to_regprocedure('public.update_sales_invoice_number(uuid,text)'));

ALTER TABLE public.sales_invoices ADD COLUMN verifactu_type text CHECK(verifactu_type IN('F1','F2','F3','R1','R2','R3','R4','R5')),
 ADD COLUMN rectification_mode text CHECK(rectification_mode IN('S','I'));
-- Metadata defaults preserve existing receipt rows byte-for-byte. Existing
-- receipts were already numbered on creation; future ones start as drafts.
ALTER TABLE public.sales_receipts ADD COLUMN status text NOT NULL DEFAULT 'issued' CHECK(status IN('draft','issued')),
 ADD COLUMN issued_at timestamptz;
ALTER TABLE public.sales_receipts ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE public.sales_receipts ALTER COLUMN receipt_number DROP NOT NULL;
ALTER TABLE public.sales_receipts ADD CONSTRAINT vf_receipt_number_on_issue CHECK(status='draft' OR (receipt_number IS NOT NULL AND receipt_number<>''));

CREATE TABLE private.verifactu_settings(
 owner_id uuid PRIMARY KEY REFERENCES public.workspaces(id),mode text NOT NULL DEFAULT 'disabled' CHECK(mode IN('disabled','shadow')),
 issuer_nif text,installation_id uuid NOT NULL DEFAULT gen_random_uuid(),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE private.verifactu_series_state(
 owner_id uuid NOT NULL REFERENCES public.workspaces(id),series_id uuid NOT NULL,year integer NOT NULL,
 anchor bigint NOT NULL CHECK(anchor>0),next_number bigint NOT NULL CHECK(next_number>=anchor),last_issue_date date,
 PRIMARY KEY(owner_id,series_id,year)
);
CREATE TABLE private.verifactu_chains(
 owner_id uuid NOT NULL REFERENCES public.workspaces(id),issuer_nif text NOT NULL,installation_id uuid NOT NULL,
 last_sequence bigint NOT NULL DEFAULT 0,last_hash text NOT NULL DEFAULT '',last_record_id uuid,
 PRIMARY KEY(owner_id,issuer_nif,installation_id)
);
CREATE TABLE private.verifactu_records(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES public.workspaces(id),
 issuer_nif text NOT NULL,installation_id uuid NOT NULL,sequence bigint NOT NULL CHECK(sequence>0),
 invoice_id uuid NOT NULL REFERENCES public.sales_invoices(id) ON DELETE RESTRICT,
 record_kind text NOT NULL CHECK(record_kind IN('alta','anulacion')),alta_record_id uuid,
 generated_at timestamptz NOT NULL,generated_at_with_offset text NOT NULL,
 previous_hash text NOT NULL,hash text NOT NULL CHECK(hash ~ '^[0-9A-F]{64}$'),hash_input text NOT NULL,
 hash_fields jsonb NOT NULL,snapshot jsonb NOT NULL,mode text NOT NULL DEFAULT 'shadow' CHECK(mode='shadow'),
 validation_status text NOT NULL DEFAULT 'shadow_not_submitted' CHECK(validation_status='shadow_not_submitted'),
 UNIQUE(owner_id,issuer_nif,installation_id,sequence),UNIQUE(owner_id,invoice_id,record_kind),UNIQUE(owner_id,id),
 FOREIGN KEY(owner_id,alta_record_id) REFERENCES private.verifactu_records(owner_id,id),
 CHECK((record_kind='alta' AND alta_record_id IS NULL) OR (record_kind='anulacion' AND alta_record_id IS NOT NULL))
);
CREATE TABLE private.verifactu_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES public.workspaces(id),sequence bigint NOT NULL,
 event_kind text NOT NULL,document_kind text,document_id uuid,actor_id uuid,occurred_at timestamptz NOT NULL,
 details jsonb NOT NULL,previous_hash text NOT NULL,hash text NOT NULL,hash_input text NOT NULL,
 UNIQUE(owner_id,sequence)
);
CREATE TABLE private.verifactu_cancellations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES public.workspaces(id),
 document_kind text NOT NULL CHECK(document_kind IN('invoice','receipt')),document_id uuid NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 5 AND 1000),actor_id uuid NOT NULL,
 cancelled_at timestamptz NOT NULL,record_id uuid REFERENCES private.verifactu_records(id),
 UNIQUE(owner_id,document_kind,document_id)
);
CREATE TABLE private.verifactu_receipt_snapshots(
 owner_id uuid NOT NULL REFERENCES public.workspaces(id),receipt_id uuid NOT NULL REFERENCES public.sales_receipts(id) ON DELETE RESTRICT,
 snapshot jsonb NOT NULL,issued_at timestamptz NOT NULL,PRIMARY KEY(owner_id,receipt_id)
);
-- Preserve, then clear only legacy draft reservations. Never touch an issued row.
CREATE TABLE private.verifactu_draft_number_backup(invoice_id uuid PRIMARY KEY,owner_id uuid NOT NULL,invoice_number text,reserved_number integer,captured_at timestamptz NOT NULL DEFAULT now());
INSERT INTO private.verifactu_draft_number_backup(invoice_id,owner_id,invoice_number,reserved_number)
 SELECT id,owner_id,invoice_number,reserved_number FROM public.sales_invoices WHERE status='draft' AND (invoice_number IS NOT NULL OR reserved_number IS NOT NULL);
UPDATE public.sales_invoices SET invoice_number=NULL,reserved_number=NULL WHERE status='draft' AND (invoice_number IS NOT NULL OR reserved_number IS NOT NULL);
-- There is intentionally no delivery queue, transport worker, certificate or
-- AEAT endpoint in this phase. mode=shadow is an offline observation only.
DO $acl$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['verifactu_draft_number_backup','verifactu_migration_backup','verifactu_settings','verifactu_series_state','verifactu_chains','verifactu_records','verifactu_events','verifactu_cancellations','verifactu_receipt_snapshots'] LOOP
 EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $acl$;

CREATE FUNCTION private.vf_sha256(p_text text) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$SELECT upper(encode(sha256(convert_to(p_text,'UTF8')),'hex'))$$;
CREATE FUNCTION private.vf_text(p text,allow_empty boolean DEFAULT false) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE s text;BEGIN
 IF p IS NULL THEN RAISE EXCEPTION 'VF_HASH_FIELD_MISSING';END IF;
 s:=btrim(p,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
 IF (NOT allow_empty AND s='') OR s ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'VF_HASH_FIELD_INVALID';END IF;RETURN s;
END$$;
CREATE FUNCTION private.vf_money(p text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE s text:=private.vf_text(p);BEGIN
 IF s !~ '^[+-]?[0-9]{1,12}([.][0-9]{0,2})?$' THEN RAISE EXCEPTION 'VF_HASH_DECIMAL_INVALID';END IF;
 RETURN to_char(s::numeric,'FM999999999990.00');
END$$;
CREATE FUNCTION private.vf_hash_input(p_kind text,p jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE k text;d text;ts text:=private.vf_text(p->>'FechaHoraHusoGenRegistro');h text:=private.vf_text(p->>'Huella',true);n text;s text;t text;
BEGIN
 FOR k IN SELECT unnest(CASE WHEN p_kind='alta' THEN ARRAY['IDEmisorFactura','NumSerieFactura','FechaExpedicionFactura','TipoFactura','CuotaTotal','ImporteTotal','Huella','FechaHoraHusoGenRegistro'] ELSE ARRAY['IDEmisorFacturaAnulada','NumSerieFacturaAnulada','FechaExpedicionFacturaAnulada','Huella','FechaHoraHusoGenRegistro'] END) LOOP
  IF jsonb_typeof(p->k) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'VF_HASH_STRING_FIELDS_REQUIRED';END IF;
 END LOOP;
 IF h<>'' AND h !~ '^[0-9A-F]{64}$' THEN RAISE EXCEPTION 'VF_PREVIOUS_HASH_INVALID';END IF;
 IF ts !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([+-](0[0-9]|1[0-3]):[0-5][0-9]|[+-]14:00)$' THEN RAISE EXCEPTION 'VF_TIMESTAMP_OFFSET_REQUIRED';END IF;
 PERFORM ts::timestamptz;
 IF p_kind='alta' THEN
  d:=private.vf_text(p->>'FechaExpedicionFactura');n:=private.vf_text(p->>'IDEmisorFactura');s:=private.vf_text(p->>'NumSerieFactura');t:=private.vf_text(p->>'TipoFactura');
  IF t !~ '^(F[123]|R[12345])$' THEN RAISE EXCEPTION 'VF_INVOICE_TYPE_INVALID';END IF;
 ELSE
  IF p_kind<>'anulacion' THEN RAISE EXCEPTION 'VF_RECORD_KIND_INVALID';END IF;
  d:=private.vf_text(p->>'FechaExpedicionFacturaAnulada');n:=private.vf_text(p->>'IDEmisorFacturaAnulada');s:=private.vf_text(p->>'NumSerieFacturaAnulada');
 END IF;
 IF d !~ '^[0-9]{2}-[0-9]{2}-[0-9]{4}$' OR to_char(to_date(d,'DD-MM-YYYY'),'DD-MM-YYYY')<>d THEN RAISE EXCEPTION 'VF_ISSUE_DATE_INVALID';END IF;
 IF p_kind='alta' THEN RETURN 'IDEmisorFactura='||n||'&NumSerieFactura='||s||'&FechaExpedicionFactura='||d||'&TipoFactura='||t||'&CuotaTotal='||private.vf_money(p->>'CuotaTotal')||'&ImporteTotal='||private.vf_money(p->>'ImporteTotal')||'&Huella='||h||'&FechaHoraHusoGenRegistro='||ts;
 ELSE RETURN 'IDEmisorFacturaAnulada='||n||'&NumSerieFacturaAnulada='||s||'&FechaExpedicionFacturaAnulada='||d||'&Huella='||h||'&FechaHoraHusoGenRegistro='||ts;END IF;
END$$;
CREATE FUNCTION private.vf_offset_time(p_time timestamptz) RETURNS text LANGUAGE sql STABLE SET search_path='' AS $$
SELECT to_char(p_time AT TIME ZONE 'Europe/Madrid','YYYY-MM-DD"T"HH24:MI:SS')||
 CASE WHEN o>=0 THEN '+' ELSE '-' END||lpad((abs(o)/3600)::text,2,'0')||':'||lpad(((abs(o)%3600)/60)::text,2,'0')
FROM(SELECT extract(epoch FROM ((p_time AT TIME ZONE 'Europe/Madrid')-(p_time AT TIME ZONE 'UTC')))::int o)x$$;
CREATE FUNCTION private.vf_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$BEGIN RAISE EXCEPTION 'VF_APPEND_ONLY';END$$;
DO $append$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['verifactu_records','verifactu_events','verifactu_cancellations','verifactu_receipt_snapshots','verifactu_migration_backup','verifactu_draft_number_backup'] LOOP
 EXECUTE format('CREATE TRIGGER vf_immutable BEFORE UPDATE OR DELETE ON private.%I FOR EACH ROW EXECUTE FUNCTION private.vf_immutable()',t);
 EXECUTE format('CREATE TRIGGER vf_no_truncate BEFORE TRUNCATE ON private.%I FOR EACH STATEMENT EXECUTE FUNCTION private.vf_immutable()',t);
 END LOOP;
END $append$;
DO $no_truncate$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['sales_invoices','sales_invoice_lines','sales_receipts','sales_receipt_lines','sales_invoice_series','sales_invoice_released_numbers','sales_receipt_counters'] LOOP
 EXECUTE format('CREATE TRIGGER vf_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION private.vf_immutable()',t);
 END LOOP;
END $no_truncate$;
CREATE FUNCTION private.vf_event(p_owner uuid,p_kind text,p_doc_kind text,p_doc uuid,p_details jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prev private.verifactu_events;v_id uuid:=gen_random_uuid();v_time timestamptz:=clock_timestamp();v_input text;seq bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('vf-event:'||p_owner::text,0));
 SELECT * INTO prev FROM private.verifactu_events WHERE owner_id=p_owner ORDER BY sequence DESC LIMIT 1;
 seq:=coalesce(prev.sequence,0)+1;
 v_input:=jsonb_build_object('owner',p_owner,'sequence',seq,'kind',p_kind,'documentKind',p_doc_kind,'document',p_doc,'actor',auth.uid(),'at',v_time,'details',p_details,'previousHash',coalesce(prev.hash,''))::text;
 INSERT INTO private.verifactu_events(id,owner_id,sequence,event_kind,document_kind,document_id,actor_id,occurred_at,details,previous_hash,hash,hash_input)
 VALUES(v_id,p_owner,seq,p_kind,p_doc_kind,p_doc,auth.uid(),v_time,p_details,coalesce(prev.hash,''),private.vf_sha256(v_input),v_input);
 RETURN v_id;
END$$;
CREATE FUNCTION private.vf_settings_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'VF_SETTINGS_PRESERVE_CUTOVER';END IF;
 IF TG_OP='UPDATE' AND (new.owner_id IS DISTINCT FROM old.owner_id OR new.issuer_nif IS DISTINCT FROM old.issuer_nif OR new.installation_id IS DISTINCT FROM old.installation_id) AND EXISTS(SELECT 1 FROM private.verifactu_records WHERE owner_id=old.owner_id) THEN RAISE EXCEPTION 'VF_INSTALLATION_ALREADY_STARTED';END IF;
 IF new.mode='shadow' AND coalesce(btrim(new.issuer_nif),'')='' THEN RAISE EXCEPTION 'VF_ISSUER_NIF_REQUIRED';END IF;
 IF TG_OP='INSERT' OR new.mode IS DISTINCT FROM old.mode THEN PERFORM private.vf_event(new.owner_id,'mode_'||new.mode,NULL,NULL,jsonb_build_object('installation',new.installation_id));END IF;RETURN new;
END$$;
CREATE TRIGGER vf_settings_guard AFTER INSERT OR UPDATE OR DELETE ON private.verifactu_settings FOR EACH ROW EXECUTE FUNCTION private.vf_settings_guard();
CREATE FUNCTION private.vf_actor_owner() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE o uuid:=private.app_workspace_owner_id();BEGIN
 IF auth.uid() IS NULL OR o IS NULL OR NOT private.app_has_permission('sales') THEN RAISE EXCEPTION 'VF_ACCESS_DENIED' USING ERRCODE='42501';END IF;
 PERFORM public.security_mfa_assert(false);RETURN o;
END$$;

-- SECURITY INVOKER is deliberate: current_user is the checked issuer function's
-- owner during a legal issue, and authenticated/service_role on direct writes.
-- No user-settable session variable can grant a transition permit.
CREATE OR REPLACE FUNCTION private.guard_sales_invoice_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE internal_writer boolean:=current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='private.verifactu_records'::regclass));
BEGIN
 IF TG_OP='DELETE' THEN IF old.status<>'draft' THEN RAISE EXCEPTION 'VF_FISCAL_IMMUTABLE: usa una rectificativa o anulación registrada';END IF;RETURN old;END IF;
 IF TG_OP='INSERT' THEN
  IF new.status<>'draft' THEN RAISE EXCEPTION 'VF_ISSUE_RPC_REQUIRED';END IF;
  IF new.invoice_number IS NOT NULL OR new.reserved_number IS NOT NULL OR new.issued_at IS NOT NULL THEN RAISE EXCEPTION 'VF_NUMBER_ASSIGNED_ON_ISSUE';END IF;
 ELSE
  IF new.owner_id IS DISTINCT FROM old.owner_id THEN RAISE EXCEPTION 'VF_TENANT_IMMUTABLE';END IF;
  IF old.status<>'draft' THEN
   IF new.status NOT IN('issued','sent','partially_paid','paid','rectified','cancelled') OR (to_jsonb(new)-ARRAY['status','sent_at','paid_at','updated_at']) IS DISTINCT FROM (to_jsonb(old)-ARRAY['status','sent_at','paid_at','updated_at'])
    OR (old.status IN('cancelled','rectified') AND new.status IS DISTINCT FROM old.status)
    OR (new.status='cancelled' AND old.status<>'cancelled')
    OR (new.status='rectified' AND old.status<>'rectified') THEN RAISE EXCEPTION 'VF_FISCAL_IMMUTABLE: usa una rectificativa o anulación registrada';END IF;
   RETURN new;
  END IF;
  IF new.status<>'draft' THEN
   IF NOT internal_writer OR new.status<>'issued' OR new.invoice_number IS NULL OR new.issued_at IS NULL THEN RAISE EXCEPTION 'VF_ISSUE_RPC_REQUIRED';END IF;
  ELSIF new.invoice_number IS DISTINCT FROM old.invoice_number OR new.reserved_number IS DISTINCT FROM old.reserved_number OR new.issued_at IS DISTINCT FROM old.issued_at THEN RAISE EXCEPTION 'VF_NUMBER_ASSIGNED_ON_ISSUE';END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clients c WHERE c.id=new.client_id AND c.owner_id=new.owner_id)
 OR NOT EXISTS(SELECT 1 FROM public.sales_invoice_series s WHERE s.id=new.series_id AND s.owner_id=new.owner_id)
 OR (new.rectifies_invoice_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sales_invoices i WHERE i.id=new.rectifies_invoice_id AND i.owner_id=new.owner_id AND i.status<>'draft')) THEN RAISE EXCEPTION 'VF_TENANT_REFERENCE_INVALID';END IF;
 RETURN new;
END$$;
CREATE TRIGGER vf_invoice_insert_guard BEFORE INSERT ON public.sales_invoices FOR EACH ROW EXECUTE FUNCTION private.guard_sales_invoice_immutable();
CREATE FUNCTION private.vf_receipt_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE internal_writer boolean:=current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='private.verifactu_records'::regclass));
BEGIN
 IF TG_OP='DELETE' THEN IF old.status<>'draft' THEN RAISE EXCEPTION 'VF_FISCAL_IMMUTABLE';END IF;RETURN old;END IF;
 IF TG_OP='INSERT' THEN
  IF new.status<>'draft' OR new.receipt_number IS NOT NULL OR new.issued_at IS NOT NULL THEN RAISE EXCEPTION 'VF_ISSUE_RPC_REQUIRED';END IF;
 ELSE
  IF new.owner_id IS DISTINCT FROM old.owner_id THEN RAISE EXCEPTION 'VF_TENANT_IMMUTABLE';END IF;
  IF old.status<>'draft' THEN IF (to_jsonb(new)-'updated_at') IS DISTINCT FROM (to_jsonb(old)-'updated_at') THEN RAISE EXCEPTION 'VF_FISCAL_IMMUTABLE';END IF;RETURN new;END IF;
  IF new.status<>'draft' THEN
   IF NOT internal_writer OR new.status<>'issued' OR new.receipt_number IS NULL OR new.issued_at IS NULL THEN RAISE EXCEPTION 'VF_ISSUE_RPC_REQUIRED';END IF;
  ELSIF new.receipt_number IS DISTINCT FROM old.receipt_number OR new.issued_at IS DISTINCT FROM old.issued_at THEN RAISE EXCEPTION 'VF_NUMBER_ASSIGNED_ON_ISSUE';END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clients c WHERE c.id=new.client_id AND c.owner_id=new.owner_id) THEN RAISE EXCEPTION 'VF_TENANT_REFERENCE_INVALID';END IF;RETURN new;
END$$;
CREATE TRIGGER vf_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON public.sales_receipts FOR EACH ROW EXECUTE FUNCTION private.vf_receipt_guard();
CREATE OR REPLACE FUNCTION private.assign_sales_receipt_number() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$BEGIN RETURN new;END$$;
CREATE FUNCTION private.vf_line_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE old_id uuid;new_id uuid;parent text;key text;r record;n int:=0;expected int;
BEGIN
 IF TG_TABLE_NAME='sales_invoice_lines' THEN parent:='sales_invoices';key:='invoice_id';ELSE parent:='sales_receipts';key:='receipt_id';END IF;
 IF TG_OP<>'INSERT' THEN old_id:=(to_jsonb(old)->>key)::uuid;END IF;
 IF TG_OP<>'DELETE' THEN new_id:=(to_jsonb(new)->>key)::uuid;END IF;
 IF TG_OP='UPDATE' AND new.owner_id IS DISTINCT FROM old.owner_id THEN RAISE EXCEPTION 'VF_TENANT_IMMUTABLE';END IF;
 expected:=CASE WHEN old_id IS NOT NULL AND new_id IS NOT NULL AND old_id<>new_id THEN 2 ELSE 1 END;
 FOR r IN EXECUTE format('SELECT id,owner_id,status FROM public.%I WHERE id=ANY($1) ORDER BY id FOR UPDATE',parent) USING ARRAY[old_id,new_id] LOOP
  n:=n+1;IF r.status<>'draft' THEN RAISE EXCEPTION 'VF_FISCAL_IMMUTABLE';END IF;
  IF r.owner_id IS DISTINCT FROM (CASE WHEN TG_OP='DELETE' THEN old.owner_id ELSE new.owner_id END) THEN RAISE EXCEPTION 'VF_TENANT_REFERENCE_INVALID';END IF;
 END LOOP;
 IF n<>expected AND NOT(TG_OP='DELETE' AND n=0 AND pg_trigger_depth()>1) THEN RAISE EXCEPTION 'VF_PARENT_NOT_EDITABLE';END IF;
 IF TG_OP='DELETE' THEN RETURN old;ELSE RETURN new;END IF;
END$$;
CREATE TRIGGER vf_invoice_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.sales_invoice_lines FOR EACH ROW EXECUTE FUNCTION private.vf_line_guard();
CREATE TRIGGER vf_receipt_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.sales_receipt_lines FOR EACH ROW EXECUTE FUNCTION private.vf_line_guard();
-- The old line guard remains as an additional guard. The new guard checks both
-- OLD and NEW parents and takes row locks, closing reparenting/concurrent issue.
CREATE FUNCTION private.vf_series_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE used boolean;internal_writer boolean:=current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='private.verifactu_records'::regclass));
BEGIN
 SELECT EXISTS(SELECT 1 FROM public.sales_invoices WHERE series_id=old.id AND status<>'draft') INTO used;
 IF TG_OP='DELETE' THEN IF used THEN RAISE EXCEPTION 'VF_SERIES_HAS_ISSUED_DOCUMENTS';END IF;RETURN old;END IF;
 IF new.owner_id IS DISTINCT FROM old.owner_id THEN RAISE EXCEPTION 'VF_TENANT_IMMUTABLE';END IF;
 IF used AND (new.code IS DISTINCT FROM old.code OR new.kind IS DISTINCT FROM old.kind OR new.year IS DISTINCT FROM old.year OR new.prefix IS DISTINCT FROM old.prefix OR new.padding IS DISTINCT FROM old.padding OR (new.next_number IS DISTINCT FROM old.next_number AND NOT internal_writer)) THEN RAISE EXCEPTION 'VF_SERIES_IMMUTABLE';END IF;RETURN new;
END$$;
CREATE TRIGGER vf_series_guard BEFORE UPDATE OR DELETE ON public.sales_invoice_series FOR EACH ROW EXECUTE FUNCTION private.vf_series_guard();
CREATE FUNCTION private.vf_receipt_counter_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user IS DISTINCT FROM pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='private.verifactu_records'::regclass)) THEN RAISE EXCEPTION 'VF_INTERNAL_COUNTER_ONLY';END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN old ELSE new END;
END$$;
CREATE TRIGGER vf_receipt_counter_guard BEFORE INSERT OR UPDATE OR DELETE ON public.sales_receipt_counters FOR EACH ROW EXECUTE FUNCTION private.vf_receipt_counter_guard();
REVOKE INSERT,UPDATE,DELETE ON public.sales_invoice_released_numbers,public.sales_receipt_counters FROM authenticated;
CREATE POLICY vf_invoice_delete_draft ON public.sales_invoices AS RESTRICTIVE FOR DELETE TO authenticated USING(status='draft');
CREATE POLICY vf_receipt_delete_draft ON public.sales_receipts AS RESTRICTIVE FOR DELETE TO authenticated USING(status='draft');
CREATE POLICY vf_invoice_lines_insert_draft ON public.sales_invoice_lines AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(EXISTS(SELECT 1 FROM public.sales_invoices p WHERE p.id=invoice_id AND p.owner_id=sales_invoice_lines.owner_id AND p.status='draft'));
CREATE POLICY vf_invoice_lines_update_draft ON public.sales_invoice_lines AS RESTRICTIVE FOR UPDATE TO authenticated USING(EXISTS(SELECT 1 FROM public.sales_invoices p WHERE p.id=invoice_id AND p.owner_id=sales_invoice_lines.owner_id AND p.status='draft')) WITH CHECK(EXISTS(SELECT 1 FROM public.sales_invoices p WHERE p.id=invoice_id AND p.owner_id=sales_invoice_lines.owner_id AND p.status='draft'));
CREATE POLICY vf_invoice_lines_delete_draft ON public.sales_invoice_lines AS RESTRICTIVE FOR DELETE TO authenticated USING(EXISTS(SELECT 1 FROM public.sales_invoices p WHERE p.id=invoice_id AND p.owner_id=sales_invoice_lines.owner_id AND p.status='draft'));
CREATE POLICY vf_receipt_lines_insert_draft ON public.sales_receipt_lines AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(EXISTS(SELECT 1 FROM public.sales_receipts p WHERE p.id=receipt_id AND p.owner_id=sales_receipt_lines.owner_id AND p.status='draft'));
CREATE POLICY vf_receipt_lines_update_draft ON public.sales_receipt_lines AS RESTRICTIVE FOR UPDATE TO authenticated USING(EXISTS(SELECT 1 FROM public.sales_receipts p WHERE p.id=receipt_id AND p.owner_id=sales_receipt_lines.owner_id AND p.status='draft')) WITH CHECK(EXISTS(SELECT 1 FROM public.sales_receipts p WHERE p.id=receipt_id AND p.owner_id=sales_receipt_lines.owner_id AND p.status='draft'));
CREATE POLICY vf_receipt_lines_delete_draft ON public.sales_receipt_lines AS RESTRICTIVE FOR DELETE TO authenticated USING(EXISTS(SELECT 1 FROM public.sales_receipts p WHERE p.id=receipt_id AND p.owner_id=sales_receipt_lines.owner_id AND p.status='draft'));

-- Preserve legacy closed rows: snapshot/default helpers must not backfill fiscal
-- columns as a side effect of recording a payment or sent timestamp.
DO $helpers$ DECLARE f record;src text;BEGIN
 FOR f IN SELECT oid FROM pg_proc WHERE oid IN(to_regprocedure('private.bank_document_snapshot()'),to_regprocedure('private.set_default_sales_invoice_due_date()')) LOOP
  src:=pg_get_functiondef(f.oid);
  src:=regexp_replace(src,'begin','begin IF TG_OP=''UPDATE'' AND OLD.status<>''draft'' THEN RETURN NEW;END IF;','i');
  -- bank snapshot also serves independent receipts, which now have status.
  src:=replace(src,'if tg_table_name=''sales_invoices'' then v_capture:=new.status<>''draft'';v_series:=new.series_id;else v_capture:=true;end if;',
   'v_capture:=new.status<>''draft'';if tg_table_name=''sales_invoices'' then v_series:=new.series_id;end if;');
  EXECUTE src;
 END LOOP;
 IF to_regprocedure('private.sync_sales_payment_status()') IS NOT NULL THEN
  src:=pg_get_functiondef('private.sync_sales_payment_status()'::regprocedure);
  INSERT INTO private.verifactu_migration_backup(signature,definition) VALUES('private.sync_sales_payment_status()',src);
  EXECUTE replace(src,'set status=case','set status=case when v_status in (''cancelled'',''rectified'') then v_status');
 END IF;
END $helpers$;

CREATE FUNCTION private.vf_lock_chain(p_owner uuid,p_nif text,p_installation uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO private.verifactu_chains(owner_id,issuer_nif,installation_id) VALUES(p_owner,p_nif,p_installation) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM private.verifactu_chains WHERE owner_id=p_owner AND issuer_nif=p_nif AND installation_id=p_installation FOR UPDATE;
END$$;
CREATE FUNCTION private.vf_allocate_number(p_owner uuid,p_series uuid,p_day date) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.sales_invoice_series;st private.verifactu_series_state;floor_number bigint;max_issued bigint;v_number text;
BEGIN
 SELECT * INTO s FROM public.sales_invoice_series WHERE id=p_series AND owner_id=p_owner FOR UPDATE;
 IF s.id IS NULL OR NOT s.active OR s.year<>extract(year FROM p_day)::int OR coalesce(s.prefix,'')='' THEN RAISE EXCEPTION 'VF_SERIES_DATE_INVALID';END IF;
 SELECT * INTO st FROM private.verifactu_series_state WHERE owner_id=p_owner AND series_id=p_series AND year=s.year FOR UPDATE;
 IF NOT FOUND THEN
  SELECT max(substring(invoice_number FROM char_length(s.prefix)+1)::bigint) INTO max_issued FROM public.sales_invoices
  WHERE owner_id=p_owner AND series_id=s.id AND status<>'draft' AND left(invoice_number,char_length(s.prefix))=s.prefix AND substring(invoice_number FROM char_length(s.prefix)+1) ~ '^[0-9]+$';
  floor_number:=greatest(s.next_number,coalesce(max_issued,0)+1);
  INSERT INTO private.verifactu_series_state(owner_id,series_id,year,anchor,next_number,last_issue_date) VALUES(p_owner,s.id,s.year,floor_number,floor_number,NULL) RETURNING * INTO st;
 END IF;
 IF st.last_issue_date IS NOT NULL AND p_day<st.last_issue_date THEN RAISE EXCEPTION 'VF_ISSUE_DATE_BEFORE_PREVIOUS';END IF;
 IF st.next_number>=2147483647 THEN RAISE EXCEPTION 'VF_SERIES_EXHAUSTED';END IF;
 v_number:=s.prefix||lpad(st.next_number::text,greatest(s.padding,length(st.next_number::text)),'0');
 UPDATE private.verifactu_series_state SET next_number=next_number+1,last_issue_date=p_day WHERE owner_id=p_owner AND series_id=s.id AND year=s.year;
 UPDATE public.sales_invoice_series SET next_number=st.next_number+1,updated_at=now() WHERE id=s.id AND owner_id=p_owner;
 RETURN v_number;
END$$;
CREATE FUNCTION private.vf_append_record(p_invoice uuid,p_kind text,p_alta uuid DEFAULT NULL,p_reason text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.sales_invoices;c private.verifactu_settings;ch private.verifactu_chains;alta private.verifactu_records;
 fields jsonb;v_input text;v_hash text;v_snapshot jsonb;v_now timestamptz:=clock_timestamp();v_lex text;v_id uuid:=gen_random_uuid();v_type text;
BEGIN
 SELECT * INTO i FROM public.sales_invoices WHERE id=p_invoice;
 SELECT * INTO c FROM private.verifactu_settings WHERE owner_id=i.owner_id FOR SHARE;
 IF c.mode IS DISTINCT FROM 'shadow' THEN RAISE EXCEPTION 'VF_SHADOW_DISABLED';END IF;
 IF private.vf_text(i.issuer_tax_id) IS DISTINCT FROM private.vf_text(c.issuer_nif) THEN RAISE EXCEPTION 'VF_ISSUER_NIF_MISMATCH';END IF;
 PERFORM private.vf_lock_chain(i.owner_id,c.issuer_nif,c.installation_id);
 SELECT * INTO ch FROM private.verifactu_chains WHERE owner_id=i.owner_id AND issuer_nif=c.issuer_nif AND installation_id=c.installation_id FOR UPDATE;
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
CREATE FUNCTION private.vf_capture_invoice() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.verifactu_settings;v_record uuid;
BEGIN
 IF old.status='draft' AND new.status='issued' THEN
  SELECT * INTO c FROM private.verifactu_settings WHERE owner_id=new.owner_id FOR SHARE;
  IF c.mode='shadow' THEN v_record:=private.vf_append_record(new.id,'alta');END IF;
  PERFORM private.vf_event(new.owner_id,'document_issued','invoice',new.id,jsonb_build_object('recordId',v_record,'mode',coalesce(c.mode,'disabled'),'series',new.series_id));
 ELSIF old.status<>'draft' AND (old.status IS DISTINCT FROM new.status OR old.sent_at IS DISTINCT FROM new.sent_at OR old.paid_at IS DISTINCT FROM new.paid_at) THEN
  PERFORM private.vf_event(new.owner_id,'commercial_status_changed','invoice',new.id,jsonb_build_object('from',old.status,'to',new.status,'previousPaidAt',old.paid_at,'paidAt',new.paid_at,'previousSentAt',old.sent_at,'sentAt',new.sent_at));
 END IF;RETURN new;
END$$;
CREATE TRIGGER vf_invoice_capture AFTER UPDATE ON public.sales_invoices FOR EACH ROW EXECUTE FUNCTION private.vf_capture_invoice();
CREATE FUNCTION private.vf_issue_invoice(p_id uuid,p_receipt boolean DEFAULT false) RETURNS public.sales_invoices LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o uuid:=private.vf_actor_owner();i public.sales_invoices;s public.sales_invoice_series;c public.clients;b public.business_settings;t public.business_tax_registrations;cfg private.verifactu_settings;v_number text;
BEGIN
 SELECT * INTO i FROM public.sales_invoices WHERE id=p_id AND owner_id=o FOR UPDATE;
 IF i.id IS NULL THEN RAISE EXCEPTION 'VF_DOCUMENT_NOT_FOUND';END IF;
 IF p_receipt AND i.document_kind<>'receipt' THEN RAISE EXCEPTION 'VF_RECEIPT_KIND_REQUIRED';END IF;
 IF NOT p_receipt AND i.document_kind<>'invoice' THEN RAISE EXCEPTION 'VF_INVOICE_KIND_REQUIRED';END IF;
 IF i.status<>'draft' THEN RETURN i;END IF; -- retries never consume another number or hash
 IF (i.invoice_type='standard' AND (coalesce(i.verifactu_type,'F1') NOT IN('F1','F2','F3') OR i.rectifies_invoice_id IS NOT NULL OR i.rectification_mode IS NOT NULL))
 OR (i.invoice_type='rectifying' AND (i.verifactu_type IS NULL OR i.verifactu_type NOT IN('R1','R2','R3','R4','R5') OR i.rectification_mode IS NULL OR i.rectifies_invoice_id IS NULL)) THEN
  RAISE EXCEPTION 'VF_DOCUMENT_CLASSIFICATION_INVALID';
 END IF;
 -- Child writers lock this parent before changing lines. Recompute under the
 -- same parent lock: editable draft header totals are never a fiscal input.
 UPDATE public.sales_invoices SET
 subtotal=(SELECT coalesce(round(sum(line_net),2),0) FROM public.sales_invoice_lines WHERE invoice_id=i.id),
 discount_amount=(SELECT coalesce(round(sum(quantity*unit_price),2)-round(sum(line_net),2),0) FROM public.sales_invoice_lines WHERE invoice_id=i.id),
 tax_amount=(SELECT coalesce(round(sum(tax_amount),2),0) FROM public.sales_invoice_lines WHERE invoice_id=i.id),
 total_amount=(SELECT coalesce(round(sum(line_total),2),0) FROM public.sales_invoice_lines WHERE invoice_id=i.id)
 WHERE id=i.id AND owner_id=o RETURNING * INTO i;
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
CREATE OR REPLACE FUNCTION public.issue_sales_invoice(p_invoice_id uuid) RETURNS public.sales_invoices LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$SELECT private.vf_issue_invoice(p_invoice_id,false)$$;
CREATE OR REPLACE FUNCTION public.issue_sales_receipt(p_invoice_id uuid) RETURNS public.sales_invoices LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$SELECT private.vf_issue_invoice(p_invoice_id,true)$$;
CREATE OR REPLACE FUNCTION public.reopen_sales_invoice(p_invoice_id uuid) RETURNS public.sales_invoices LANGUAGE plpgsql SET search_path='' AS $$BEGIN RAISE EXCEPTION 'VF_FISCAL_IMMUTABLE: crea una rectificativa';END$$;
CREATE OR REPLACE FUNCTION public.delete_reversible_sales_invoice(p_invoice_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$BEGIN
 PERFORM private.vf_actor_owner();IF EXISTS(SELECT 1 FROM public.sales_invoices WHERE id=p_invoice_id AND owner_id=private.app_workspace_owner_id() AND status<>'draft') THEN RAISE EXCEPTION 'VF_FISCAL_IMMUTABLE';END IF;
 DELETE FROM public.sales_invoices WHERE id=p_invoice_id AND owner_id=private.app_workspace_owner_id() AND status='draft';
END$$;
CREATE OR REPLACE FUNCTION public.update_sales_invoice_number(p_invoice_id uuid,p_invoice_number text) RETURNS public.sales_invoices LANGUAGE plpgsql SET search_path='' AS $$BEGIN RAISE EXCEPTION 'VF_NUMBER_ASSIGNED_ON_ISSUE';END$$;

CREATE FUNCTION private.vf_issue_receipt_document(p_id uuid) RETURNS public.sales_receipts LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o uuid:=private.vf_actor_owner();r public.sales_receipts;v_year integer;v_number bigint;v_high bigint;v_snapshot jsonb;
BEGIN
 SELECT * INTO r FROM public.sales_receipts WHERE id=p_id AND owner_id=o FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'VF_DOCUMENT_NOT_FOUND';END IF;
 IF r.status<>'draft' THEN RETURN r;END IF;
 UPDATE public.sales_receipts SET total_amount=(SELECT coalesce(round(sum(line_total),2),0) FROM public.sales_receipt_lines WHERE receipt_id=r.id)
 WHERE id=r.id AND owner_id=o RETURNING * INTO r;
 IF r.total_amount<=0 OR NOT EXISTS(SELECT 1 FROM public.sales_receipt_lines WHERE receipt_id=r.id AND owner_id=o) OR EXISTS(SELECT 1 FROM public.sales_receipt_lines WHERE receipt_id=r.id AND owner_id<>o) THEN RAISE EXCEPTION 'VF_RECEIPT_LINES_INVALID';END IF;
 v_year:=extract(year FROM r.receipt_date)::integer;
 -- Serialise by owner/year, including an absent counter, without sequences.
 PERFORM pg_advisory_xact_lock(hashtextextended('vf-receipt:'||o::text||':'||v_year::text,0));
 SELECT max(substring(receipt_number FROM length('REC-'||v_year||'-')+1)::bigint) INTO v_high FROM public.sales_receipts WHERE owner_id=o AND status<>'draft' AND left(receipt_number,length('REC-'||v_year||'-'))='REC-'||v_year||'-' AND substring(receipt_number FROM length('REC-'||v_year||'-')+1) ~ '^[0-9]+$';
 INSERT INTO public.sales_receipt_counters(owner_id,year,next_number) VALUES(o,v_year,coalesce(v_high,0)+2)
 ON CONFLICT(owner_id,year) DO UPDATE SET next_number=greatest(sales_receipt_counters.next_number,coalesce(v_high,0)+1)+1 RETURNING next_number-1 INTO v_number;
 UPDATE public.sales_receipts SET receipt_number='REC-'||v_year||'-'||lpad(v_number::text,greatest(4,length(v_number::text)),'0'),status='issued',issued_at=clock_timestamp() WHERE id=r.id AND owner_id=o RETURNING * INTO r;
 SELECT jsonb_build_object('receipt',to_jsonb(r),'lines',coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.position,l.id),'[]'::jsonb)) INTO v_snapshot FROM public.sales_receipt_lines l WHERE l.receipt_id=r.id AND l.owner_id=o;
 INSERT INTO private.verifactu_receipt_snapshots(owner_id,receipt_id,snapshot,issued_at) VALUES(o,r.id,v_snapshot,r.issued_at);
 PERFORM private.vf_event(o,'document_issued','receipt',r.id,jsonb_build_object('fiscalInvoice',false));RETURN r;
END$$;
CREATE FUNCTION public.issue_sales_receipt_document(p_receipt_id uuid) RETURNS public.sales_receipts LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$SELECT private.vf_issue_receipt_document(p_receipt_id)$$;
CREATE FUNCTION private.vf_cancel_document(p_document_id uuid,p_document_kind text,p_reason text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o uuid:=private.vf_actor_owner();v_existing private.verifactu_cancellations;v_status text;v_alta uuid;v_record uuid;v_id uuid:=gen_random_uuid();reason text:=btrim(p_reason);
BEGIN
 IF p_document_kind NOT IN('invoice','receipt') OR reason IS NULL OR length(reason) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'VF_CANCELLATION_REASON_REQUIRED';END IF;
 IF p_document_kind='invoice' THEN SELECT status INTO v_status FROM public.sales_invoices WHERE id=p_document_id AND owner_id=o FOR UPDATE;
 ELSE SELECT status INTO v_status FROM public.sales_receipts WHERE id=p_document_id AND owner_id=o FOR UPDATE;END IF;
 IF v_status IS NULL OR v_status='draft' THEN RAISE EXCEPTION 'VF_ISSUED_DOCUMENT_REQUIRED';END IF;
 SELECT * INTO v_existing FROM private.verifactu_cancellations WHERE owner_id=o AND document_kind=p_document_kind AND document_id=p_document_id;
 IF FOUND THEN IF v_existing.reason<>reason THEN RAISE EXCEPTION 'VF_CANCELLATION_CONFLICT';END IF;RETURN v_existing.id;END IF;
 IF p_document_kind='invoice' THEN
  SELECT id INTO v_alta FROM private.verifactu_records WHERE owner_id=o AND invoice_id=p_document_id AND record_kind='alta';
  IF v_alta IS NOT NULL THEN v_record:=private.vf_append_record(p_document_id,'anulacion',v_alta,reason);END IF;
 END IF;
 INSERT INTO private.verifactu_cancellations(id,owner_id,document_kind,document_id,reason,actor_id,cancelled_at,record_id) VALUES(v_id,o,p_document_kind,p_document_id,reason,auth.uid(),clock_timestamp(),v_record);
 PERFORM private.vf_event(o,'document_cancelled',p_document_kind,p_document_id,jsonb_build_object('cancellationId',v_id,'recordId',v_record,'outsideFiscalCutover',v_record IS NULL));
 RETURN v_id;
END$$;
CREATE FUNCTION public.verifactu_cancel_sales_document(p_document_id uuid,p_document_kind text,p_reason text) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$SELECT private.vf_cancel_document(p_document_id,p_document_kind,p_reason)$$;
CREATE FUNCTION private.vf_shadow_status() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE o uuid:=private.vf_actor_owner();BEGIN RETURN jsonb_build_object('mode',coalesce((SELECT mode FROM private.verifactu_settings WHERE owner_id=o),'disabled'),'records',(SELECT count(*) FROM private.verifactu_records WHERE owner_id=o),'cancellations',(SELECT coalesce(jsonb_agg(jsonb_build_object('documentId',document_id,'documentKind',document_kind,'cancelledAt',cancelled_at)),'[]'::jsonb) FROM private.verifactu_cancellations WHERE owner_id=o),'aeatConnected',false);END$$;
CREATE FUNCTION public.verifactu_shadow_status() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT private.vf_shadow_status()$$;

-- Use the existing public MFA-wrapper/manifest contract, without changing pilot
-- configuration, cohort, factors, credentials or any existing MFA setting.
DO $wrappers$ DECLARE f record;src text;impl text;impl_oid regprocedure;args text;body text;result_type text;old_manifest jsonb;BEGIN
 FOR f IN SELECT p.* FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN('issue_sales_invoice','issue_sales_receipt','issue_sales_receipt_document','verifactu_cancel_sales_document','verifactu_shadow_status','delete_reversible_sales_invoice') LOOP
  SELECT to_jsonb(m) INTO old_manifest FROM private.mfa_function_manifest m WHERE m.function_oid=f.oid;
  IF old_manifest IS NOT NULL THEN INSERT INTO private.verifactu_migration_backup(signature,definition) VALUES('manifest:'||f.oid::regprocedure::text,old_manifest::text);END IF;
  src:=pg_get_functiondef(f.oid);impl:='mfa_impl_'||f.proname;
  EXECUTE replace(src,'FUNCTION public.'||f.proname||'(','FUNCTION private.'||impl||'(');
  impl_oid:=to_regprocedure('private.'||impl||'('||oidvectortypes(f.proargtypes)||')');
  SELECT coalesce(string_agg('$'||x,',' ORDER BY x),'') INTO args FROM generate_series(1,f.pronargs)x;
  result_type:=pg_get_function_result(f.oid);
  body:='BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION ''AUTH_REQUIRED'' USING ERRCODE=''42501'';END IF;PERFORM public.security_mfa_assert(false);';
  IF f.prorettype='void'::regtype THEN body:=body||'PERFORM private.'||impl||'('||args||');RETURN;END;';ELSE body:=body||'RETURN private.'||impl||'('||args||');END;';END IF;
  EXECUTE format('CREATE OR REPLACE FUNCTION public.%I(%s) RETURNS %s LANGUAGE plpgsql %s SECURITY DEFINER SET search_path=%L AS %L',f.proname,pg_get_function_arguments(f.oid),result_type,CASE WHEN f.provolatile='s' THEN 'STABLE' ELSE 'VOLATILE' END,'',body);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon',f.oid::regprocedure);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.oid::regprocedure);
  INSERT INTO private.mfa_function_manifest(signature,function_oid,implementation,original_definition,wrapper_hash)
  VALUES(f.oid::regprocedure::text,f.oid,impl_oid,src,md5(pg_get_functiondef(f.oid))) ON CONFLICT(signature) DO UPDATE SET implementation=excluded.implementation,original_definition=excluded.original_definition,wrapper_hash=excluded.wrapper_hash;
 END LOOP;
END $wrappers$;
DO $private_acl$ DECLARE f record;BEGIN
 FOR f IN SELECT oid FROM pg_proc WHERE pronamespace='private'::regnamespace AND (proname LIKE 'vf\_%' ESCAPE '\' OR proname IN('mfa_impl_issue_sales_invoice','mfa_impl_issue_sales_receipt','mfa_impl_issue_sales_receipt_document','mfa_impl_verifactu_cancel_sales_document','mfa_impl_verifactu_shadow_status','mfa_impl_delete_reversible_sales_invoice')) LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.oid::regprocedure);
 END LOOP;
END $private_acl$;
COMMIT;
