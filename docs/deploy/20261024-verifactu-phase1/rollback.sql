-- Full schema rollback only BEFORE any use of the new issuer/shadow ledger.
-- After use, run disable-shadow.sql instead and retain all fiscal history.
BEGIN;
-- Restored legacy definitions may contain unqualified composite return types.
SET LOCAL search_path=public;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='15s';
DO $gate$ BEGIN
 IF EXISTS(SELECT 1 FROM private.verifactu_records) OR EXISTS(SELECT 1 FROM private.verifactu_events) OR EXISTS(SELECT 1 FROM private.verifactu_series_state) OR EXISTS(SELECT 1 FROM private.verifactu_receipt_snapshots) OR EXISTS(SELECT 1 FROM private.verifactu_cancellations) THEN RAISE EXCEPTION 'VF_ROLLBACK_PRESERVE_HISTORY: disable shadow, do not drop records or recycle numbers';END IF;
 IF EXISTS(SELECT 1 FROM public.sales_receipts WHERE status='draft' AND receipt_number IS NULL) OR EXISTS(SELECT 1 FROM public.sales_invoices WHERE verifactu_type IS NOT NULL OR rectification_mode IS NOT NULL) THEN RAISE EXCEPTION 'VF_ROLLBACK_REVIEW_NEW_DRAFTS';END IF;
END $gate$;
CREATE TEMP TABLE vf_restore_functions ON COMMIT DROP AS SELECT * FROM private.verifactu_migration_backup;
DO $triggers$ DECLARE r record;BEGIN
 FOR r IN SELECT t.tgname,t.tgrelid::regclass tbl FROM pg_trigger t WHERE NOT t.tgisinternal AND left(t.tgname,3)='vf_' AND t.tgrelid IN('public.sales_invoices'::regclass,'public.sales_invoice_lines'::regclass,'public.sales_receipts'::regclass,'public.sales_receipt_lines'::regclass,'public.sales_invoice_series'::regclass,'public.sales_receipt_counters'::regclass,'public.sales_invoice_released_numbers'::regclass) LOOP EXECUTE format('DROP TRIGGER %I ON %s',r.tgname,r.tbl);END LOOP;
 FOR r IN SELECT p.polname,p.polrelid::regclass tbl FROM pg_policy p WHERE left(p.polname,3)='vf_' AND p.polrelid IN('public.sales_invoices'::regclass,'public.sales_invoice_lines'::regclass,'public.sales_receipts'::regclass,'public.sales_receipt_lines'::regclass) LOOP EXECUTE format('DROP POLICY %I ON %s',r.polname,r.tbl);END LOOP;
END $triggers$;
DO $manifest$ DECLARE r record;BEGIN
 DELETE FROM private.mfa_function_manifest WHERE function_oid IN(SELECT oid FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('issue_sales_invoice','issue_sales_receipt','issue_sales_receipt_document','verifactu_cancel_sales_document','verifactu_shadow_status','delete_reversible_sales_invoice'));
 FOR r IN SELECT definition FROM vf_restore_functions WHERE signature LIKE 'manifest:%' LOOP
  INSERT INTO private.mfa_function_manifest SELECT (jsonb_populate_record(NULL::private.mfa_function_manifest,r.definition::jsonb)).*;
 END LOOP;
END $manifest$;
DO $functions$ DECLARE r record;BEGIN
 FOR r IN SELECT * FROM vf_restore_functions WHERE signature NOT LIKE 'manifest:%' LOOP EXECUTE r.definition;END LOOP;
END $functions$;
UPDATE public.sales_invoices i SET invoice_number=b.invoice_number,reserved_number=b.reserved_number FROM private.verifactu_draft_number_backup b WHERE i.id=b.invoice_id AND i.owner_id=b.owner_id AND i.status='draft';
DROP FUNCTION public.issue_sales_receipt_document(uuid);
DROP FUNCTION public.verifactu_cancel_sales_document(uuid,text,text);
DROP FUNCTION public.verifactu_shadow_status();
DO $private_functions$ DECLARE r record;BEGIN
 FOR r IN SELECT p.oid::regprocedure sig FROM pg_proc p WHERE p.pronamespace='private'::regnamespace AND (left(p.proname,3)='vf_' OR p.proname IN('mfa_impl_issue_sales_invoice','mfa_impl_issue_sales_receipt','mfa_impl_issue_sales_receipt_document','mfa_impl_verifactu_cancel_sales_document','mfa_impl_verifactu_shadow_status','mfa_impl_delete_reversible_sales_invoice')) AND NOT EXISTS(SELECT 1 FROM vf_restore_functions b WHERE b.signature=p.oid::regprocedure::text) LOOP
  IF to_regprocedure(r.sig::text) IS NOT NULL THEN EXECUTE 'DROP FUNCTION '||r.sig::text||' CASCADE';END IF;
 END LOOP;
END $private_functions$;
ALTER TABLE public.sales_receipts DROP CONSTRAINT vf_receipt_number_on_issue,ALTER COLUMN receipt_number SET NOT NULL,DROP COLUMN status,DROP COLUMN issued_at;
ALTER TABLE public.sales_invoices DROP COLUMN verifactu_type,DROP COLUMN rectification_mode;
GRANT INSERT,UPDATE,DELETE ON public.sales_invoice_released_numbers,public.sales_receipt_counters TO authenticated;
DROP TABLE private.verifactu_cancellations,private.verifactu_receipt_snapshots,private.verifactu_records,private.verifactu_chains,private.verifactu_events,private.verifactu_series_state,private.verifactu_settings,private.verifactu_draft_number_backup,private.verifactu_migration_backup;
COMMIT;
