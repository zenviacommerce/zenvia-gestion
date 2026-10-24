-- Review copy: NOT AUTHORIZED FOR PRODUCTION. Run only after explicit owner approval.
-- No invoice emission, PDF change, AEAT request, resource or certificate operation.
BEGIN;SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='15s';
SET LOCAL application_name='verifactu_owner_approved_shadow_activation';
DO $activate$ DECLARE o uuid:='7461b2b7-f383-460d-b1c7-6ccbb52e42b2';nif text;BEGIN
 SELECT btrim(tax_id) INTO nif FROM public.business_settings WHERE owner_id=o;
 IF nif IS NULL OR nif='' THEN RAISE EXCEPTION 'VF_REVIEW_ISSUER_NIF';END IF;
 IF EXISTS(SELECT 1 FROM public.sales_invoices WHERE owner_id=o AND status='draft' AND (invoice_number IS NOT NULL OR reserved_number IS NOT NULL)) THEN RAISE EXCEPTION 'VF_REVIEW_DRAFT_RESERVATIONS';END IF;
 INSERT INTO private.verifactu_settings(owner_id,mode,issuer_nif) VALUES(o,'shadow',nif)
 ON CONFLICT(owner_id) DO UPDATE SET mode='shadow',issuer_nif=excluded.issuer_nif;
END $activate$;
SELECT owner_id,mode,installation_id FROM private.verifactu_settings WHERE owner_id='7461b2b7-f383-460d-b1c7-6ccbb52e42b2';
COMMIT;
