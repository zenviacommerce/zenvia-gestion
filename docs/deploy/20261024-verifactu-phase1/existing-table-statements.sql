-- INVENTARIO PARA REVISIÓN. NO ES UN SCRIPT DE DESPLIEGUE.
-- Fragmentos literales de la única migración candidata (no aplicada).
-- Recuentos de solo lectura: 24/10/2026; ver review-production-evidence.json.

-- A. ALTER de tablas existentes: 29 facturas / 8 recibos. 0 UPDATE de emitidas.
ALTER TABLE public.sales_invoices ADD COLUMN verifactu_type text CHECK(verifactu_type IN('F1','F2','F3','R1','R2','R3','R4','R5')),
 ADD COLUMN rectification_mode text CHECK(rectification_mode IN('S','I'));
-- Metadata defaults preserve existing receipt rows byte-for-byte. Existing
-- receipts were already numbered on creation; future ones start as drafts.
ALTER TABLE public.sales_receipts ADD COLUMN status text NOT NULL DEFAULT 'issued' CHECK(status IN('draft','issued')),
 ADD COLUMN issued_at timestamptz;
ALTER TABLE public.sales_receipts ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE public.sales_receipts ALTER COLUMN receipt_number DROP NOT NULL;
ALTER TABLE public.sales_receipts ADD CONSTRAINT vf_receipt_number_on_issue CHECK(status='draft' OR (receipt_number IS NOT NULL AND receipt_number<>''));


-- B. DML inmediato: respalda 1 borrador DEMO en tabla NUEVA y limpia su reserva.
-- También dispara updated_at y 1 INSERT de auditoría existente.
-- Las 28 cerradas y sus 48 líneas no se actualizan.
CREATE TABLE private.verifactu_draft_number_backup(invoice_id uuid PRIMARY KEY,owner_id uuid NOT NULL,invoice_number text,reserved_number integer,captured_at timestamptz NOT NULL DEFAULT now());
INSERT INTO private.verifactu_draft_number_backup(invoice_id,owner_id,invoice_number,reserved_number)
 SELECT id,owner_id,invoice_number,reserved_number FROM public.sales_invoices WHERE status='draft' AND (invoice_number IS NOT NULL OR reserved_number IS NOT NULL);
UPDATE public.sales_invoices SET invoice_number=NULL,reserved_number=NULL WHERE status='draft' AND (invoice_number IS NOT NULL OR reserved_number IS NOT NULL);

-- C. DDL: 7 triggers anti-TRUNCATE. 0 filas modificadas.
DO $no_truncate$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['sales_invoices','sales_invoice_lines','sales_receipts','sales_receipt_lines','sales_invoice_series','sales_invoice_released_numbers','sales_receipt_counters'] LOOP
 EXECUTE format('CREATE TRIGGER vf_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION private.vf_immutable()',t);
 END LOOP;
END $no_truncate$;

-- D. DDL: 7 triggers adicionales sobre tablas existentes. 0 filas modificadas.
CREATE TRIGGER vf_invoice_insert_guard BEFORE INSERT ON public.sales_invoices FOR EACH ROW EXECUTE FUNCTION private.guard_sales_invoice_immutable();
CREATE TRIGGER vf_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON public.sales_receipts FOR EACH ROW EXECUTE FUNCTION private.vf_receipt_guard();
CREATE TRIGGER vf_invoice_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.sales_invoice_lines FOR EACH ROW EXECUTE FUNCTION private.vf_line_guard();
CREATE TRIGGER vf_receipt_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.sales_receipt_lines FOR EACH ROW EXECUTE FUNCTION private.vf_line_guard();
CREATE TRIGGER vf_series_guard BEFORE UPDATE OR DELETE ON public.sales_invoice_series FOR EACH ROW EXECUTE FUNCTION private.vf_series_guard();
CREATE TRIGGER vf_receipt_counter_guard BEFORE INSERT OR UPDATE OR DELETE ON public.sales_receipt_counters FOR EACH ROW EXECUTE FUNCTION private.vf_receipt_counter_guard();
CREATE TRIGGER vf_invoice_capture AFTER UPDATE ON public.sales_invoices FOR EACH ROW EXECUTE FUNCTION private.vf_capture_invoice();

-- E. REVOKE de DML authenticated en pool (0 filas) y contador recibos (1).
-- 8 políticas restrictivas añadidas; se conservan las anteriores tenant/MFA.
-- Facturas29 / líneas50 / recibos8 / líneas13; 0 filas modificadas.
REVOKE INSERT,UPDATE,DELETE ON public.sales_invoice_released_numbers,public.sales_receipt_counters FROM authenticated;
CREATE POLICY vf_invoice_delete_draft ON public.sales_invoices AS RESTRICTIVE FOR DELETE TO authenticated USING(status='draft');
CREATE POLICY vf_receipt_delete_draft ON public.sales_receipts AS RESTRICTIVE FOR DELETE TO authenticated USING(status='draft');
CREATE POLICY vf_invoice_lines_insert_draft ON public.sales_invoice_lines AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(EXISTS(SELECT 1 FROM public.sales_invoices p WHERE p.id=invoice_id AND p.owner_id=sales_invoice_lines.owner_id AND p.status='draft'));
CREATE POLICY vf_invoice_lines_update_draft ON public.sales_invoice_lines AS RESTRICTIVE FOR UPDATE TO authenticated USING(EXISTS(SELECT 1 FROM public.sales_invoices p WHERE p.id=invoice_id AND p.owner_id=sales_invoice_lines.owner_id AND p.status='draft')) WITH CHECK(EXISTS(SELECT 1 FROM public.sales_invoices p WHERE p.id=invoice_id AND p.owner_id=sales_invoice_lines.owner_id AND p.status='draft'));
CREATE POLICY vf_invoice_lines_delete_draft ON public.sales_invoice_lines AS RESTRICTIVE FOR DELETE TO authenticated USING(EXISTS(SELECT 1 FROM public.sales_invoices p WHERE p.id=invoice_id AND p.owner_id=sales_invoice_lines.owner_id AND p.status='draft'));
CREATE POLICY vf_receipt_lines_insert_draft ON public.sales_receipt_lines AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(EXISTS(SELECT 1 FROM public.sales_receipts p WHERE p.id=receipt_id AND p.owner_id=sales_receipt_lines.owner_id AND p.status='draft'));
CREATE POLICY vf_receipt_lines_update_draft ON public.sales_receipt_lines AS RESTRICTIVE FOR UPDATE TO authenticated USING(EXISTS(SELECT 1 FROM public.sales_receipts p WHERE p.id=receipt_id AND p.owner_id=sales_receipt_lines.owner_id AND p.status='draft')) WITH CHECK(EXISTS(SELECT 1 FROM public.sales_receipts p WHERE p.id=receipt_id AND p.owner_id=sales_receipt_lines.owner_id AND p.status='draft'));
CREATE POLICY vf_receipt_lines_delete_draft ON public.sales_receipt_lines AS RESTRICTIVE FOR DELETE TO authenticated USING(EXISTS(SELECT 1 FROM public.sales_receipts p WHERE p.id=receipt_id AND p.owner_id=sales_receipt_lines.owner_id AND p.status='draft'));


-- F. Funciones existentes modificadas (0 DML inmediato):
-- private.guard_sales_invoice_immutable, assign_sales_receipt_number,
-- bank_document_snapshot, set_default_sales_invoice_due_date, sync_sales_payment_status;
-- public.issue_sales_invoice, issue_sales_receipt, reopen_sales_invoice,
-- delete_reversible_sales_invoice, update_sales_invoice_number.
-- Las definiciones completas y respaldo están en la migración; helper-patch literal:
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


-- G. 6 INSERT/UPSERT en tabla EXISTENTE private.mfa_function_manifest.
-- En producción hoy, 0 de estas 6 firmas tienen entrada: se esperan 6 INSERT.
-- REVOKE/GRANT de funciones públicas y privadas: ACL, 0 filas de negocio.
-- Use the existing public MFA-wrapper/manifest contract, without changing pilot
-- configuration, cohort, factors, credentials or any existing MFA setting.
-- pg_get_functiondef qualifies composite return types according to search_path.
-- Match private.mfa_activation_findings() exactly when recording wrapper hashes.
SET LOCAL search_path='';
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
-- H. DML de FUTURAS RPC. NO se ejecuta al aplicar la migración.
-- Cada emisión actualiza 1 documento y 1 contador. DELETE solo borradores.
 UPDATE public.sales_invoice_series SET next_number=st.next_number+1,updated_at=now() WHERE id=s.id AND owner_id=p_owner;

 UPDATE public.sales_invoices SET
 subtotal=(SELECT coalesce(round(sum(line_net),2),0) FROM public.sales_invoice_lines WHERE invoice_id=i.id),
 discount_amount=(SELECT coalesce(round(sum(quantity*unit_price),2)-round(sum(line_net),2),0) FROM public.sales_invoice_lines WHERE invoice_id=i.id),
 tax_amount=(SELECT coalesce(round(sum(tax_amount),2),0) FROM public.sales_invoice_lines WHERE invoice_id=i.id),
 total_amount=(SELECT coalesce(round(sum(line_total),2),0) FROM public.sales_invoice_lines WHERE invoice_id=i.id)
 WHERE id=i.id AND owner_id=o RETURNING * INTO i;

 UPDATE public.sales_invoices SET invoice_number=v_number,reserved_number=NULL,status='issued',issued_at=clock_timestamp(),
 tax_registration_id=coalesce(t.id,tax_registration_id),client_name=c.name,client_tax_id=c.tax_id,client_email=c.email,client_phone=c.phone,
 client_address=concat_ws(', ',nullif(c.address_line1,''),nullif(c.address_line2,''),nullif(concat_ws(' ',nullif(c.postal_code,''),nullif(c.city,'')),''),nullif(c.province,''),nullif(c.country_code,'')),
 issuer_name=coalesce(nullif(t.fiscal_name,''),b.legal_name),issuer_tax_id=coalesce(nullif(t.vat_number,''),b.tax_id),issuer_email=b.email,issuer_phone=b.phone,
 issuer_address=coalesce(nullif(t.address_text,''),concat_ws(', ',nullif(b.address_line1,''),nullif(b.address_line2,''),nullif(concat_ws(' ',nullif(b.postal_code,''),nullif(b.city,'')),''),nullif(b.province,''),nullif(b.country_code,''))),
 issuer_tax_country_code=coalesce(t.country_code,b.country_code),issuer_tax_registration_label=t.label
 WHERE id=i.id AND owner_id=o RETURNING * INTO i;

 DELETE FROM public.sales_invoices WHERE id=p_invoice_id AND owner_id=private.app_workspace_owner_id() AND status='draft';

 UPDATE public.sales_receipts SET total_amount=(SELECT coalesce(round(sum(line_total),2),0) FROM public.sales_receipt_lines WHERE receipt_id=r.id)
 WHERE id=r.id AND owner_id=o RETURNING * INTO r;

 INSERT INTO public.sales_receipt_counters(owner_id,year,next_number) VALUES(o,v_year,coalesce(v_high,0)+2)
 ON CONFLICT(owner_id,year) DO UPDATE SET next_number=greatest(sales_receipt_counters.next_number,coalesce(v_high,0)+1)+1 RETURNING next_number-1 INTO v_number;

 UPDATE public.sales_receipts SET receipt_number='REC-'||v_year||'-'||lpad(v_number::text,greatest(4,length(v_number::text)),'0'),status='issued',issued_at=clock_timestamp() WHERE id=r.id AND owner_id=o RETURNING * INTO r;

-- I. ROLLBACK PREVIO A USO (archivo separado rollback.sql):
-- DELETE private.mfa_function_manifest: las 6 filas añadidas; restaura backups previos (hoy 0).
-- UPDATE sales_invoices: restaura reserva original en 1 borrador DEMO; puede insertar 1 audit_logs por el trigger.
-- GRANT INSERT,UPDATE,DELETE pool/counters a authenticated: restaura ACL previa, 0 filas.
-- DROP POLICY/TRIGGER vf_* en tablas existentes: solo objetos añadidos, 0 filas.
-- ALTER sales_receipts DROP columnas nuevas status/issued_at y CHECK nuevo, restaura NOT NULL.
-- ALTER sales_invoices DROP columnas nuevas verifactu_type/rectification_mode.
-- DROP FUNCTION: tres RPC nuevas y helpers nuevos privados (CASCADE limitado por nombres y backups).
-- DROP TABLE: únicamente las 9 tablas NUEVAS private.verifactu_*; exige que no haya historia nueva.
-- No DROP TABLE de tabla preexistente ni DELETE de facturas/recibos existentes.
