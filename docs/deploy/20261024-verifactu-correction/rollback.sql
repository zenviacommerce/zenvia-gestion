-- Run BEFORE the phase-1 rollback. Refuse after any fiscal/audit activity.
BEGIN;
SET LOCAL search_path='';
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
-- Match the operation lock order, then stop writes while checking history.
LOCK TABLE public.sales_invoices,public.sales_invoice_lines IN ACCESS EXCLUSIVE MODE;
DO $gate$ BEGIN
 IF EXISTS(SELECT 1 FROM private.verifactu_records) OR EXISTS(SELECT 1 FROM private.verifactu_events) OR EXISTS(SELECT 1 FROM private.verifactu_cancellations) OR EXISTS(SELECT 1 FROM private.verifactu_series_state) OR EXISTS(SELECT 1 FROM private.verifactu_receipt_snapshots) THEN RAISE EXCEPTION 'VF_ROLLBACK_PRESERVE_HISTORY';END IF;
 IF EXISTS(SELECT 1 FROM public.sales_invoices WHERE rectification_reason IS NOT NULL OR rectification_original_number IS NOT NULL) THEN RAISE EXCEPTION 'VF_ROLLBACK_REVIEW_NEW_DRAFTS';END IF;
END $gate$;
DO $restore$ DECLARE r record;BEGIN
 FOR r IN SELECT definition FROM private.verifactu_migration_backup WHERE signature LIKE 'correction:%' LOOP EXECUTE r.definition;END LOOP;
END $restore$;
-- Only the newly introduced public function is removed; issue/cancel wrappers,
-- their manifests, ACLs and OIDs were not changed by this migration.
DELETE FROM private.mfa_function_manifest WHERE function_oid IN('public.create_sales_invoice_correction(uuid,text,text,text)'::regprocedure,'public.save_sales_invoice_correction(uuid,jsonb,jsonb)'::regprocedure);
DROP FUNCTION public.save_sales_invoice_correction(uuid,jsonb,jsonb);
DROP FUNCTION private.mfa_impl_save_sales_invoice_correction(uuid,jsonb,jsonb);
DROP FUNCTION public.create_sales_invoice_correction(uuid,text,text,text);
DROP TRIGGER vf_correction_identity_guard ON public.sales_invoices;
DROP FUNCTION private.vf_correction_identity_guard();
DROP FUNCTION private.mfa_impl_create_sales_invoice_correction(uuid,text,text,text);
ALTER TABLE public.sales_invoices DROP COLUMN rectification_reason,DROP COLUMN rectification_original_number,DROP COLUMN rectification_original_date,DROP COLUMN rectification_original_base,DROP COLUMN rectification_original_tax;
ALTER TABLE private.verifactu_migration_backup DISABLE TRIGGER vf_immutable;
DELETE FROM private.verifactu_migration_backup WHERE signature LIKE 'correction:%';
ALTER TABLE private.verifactu_migration_backup ENABLE TRIGGER vf_immutable;
COMMIT;
