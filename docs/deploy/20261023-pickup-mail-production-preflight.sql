-- Read-only assertions: abort the deployment transaction on source/data drift.
DO $preflight$
BEGIN
 IF md5(pg_get_functiondef('public.pickup_document_mail_finish(uuid,uuid,uuid,text,text,text)'::regprocedure)) <> 'e1bdd8bb955642e487d977c5820e32dc'
 OR md5(pg_get_functiondef('public.pickup_document_mail_list(uuid,uuid,uuid)'::regprocedure)) <> '6fa79883c0e230177a0408347ad975ae'
 OR md5(pg_get_functiondef('public.pickup_document_mail_prepare(uuid,uuid,uuid,uuid,text,text,boolean,text)'::regprocedure)) <> 'd78de68dcd61d80fc2910272fc181cd7' THEN RAISE EXCEPTION 'PICKUP_MAIL_PREFLIGHT_SOURCE_CHANGED';END IF;
 IF (SELECT count(*) FROM private.pickup_document_mail)<>1
 OR NOT EXISTS(SELECT 1 FROM private.pickup_document_mail WHERE owner_id='7461b2b7-f383-460d-b1c7-6ccbb52e42b2' AND request_id='3461de73-9eeb-4e61-b03b-6d5563903048' AND report_id='8a011430-1bb2-4c7f-9e9f-2ecb5af2b9b5' AND status='failed' AND error_code='EDGE_CPU_LIMIT' AND message_id IS NULL AND finished_at IS NOT NULL)
 THEN RAISE EXCEPTION 'PICKUP_MAIL_PREFLIGHT_ATTEMPTS_CHANGED';END IF;
 IF NOT EXISTS(SELECT 1 FROM private.mfa_configuration WHERE enabled AND cohort_user_ids=ARRAY['7461b2b7-f383-460d-b1c7-6ccbb52e42b2'::uuid]) THEN RAISE EXCEPTION 'PICKUP_MAIL_PREFLIGHT_MFA_CHANGED';END IF;
END $preflight$;
