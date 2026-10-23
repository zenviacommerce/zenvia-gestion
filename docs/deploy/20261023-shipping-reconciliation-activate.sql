-- NOT EXECUTED. Repeat/show pre-count immediately before activation.
BEGIN;
DO $guard$
BEGIN
 IF EXISTS(SELECT 1 FROM public.fulfillment_orders WHERE tracking_status_code IN('MRW_CREATING','SENDCLOUD_CREATING','ENVIA_CREATING')) OR EXISTS(SELECT 1 FROM private.shipping_creation_operations WHERE closed_at IS NULL) THEN RAISE EXCEPTION 'CREATION_ACTIVATION_CHANGED_RECOUNT_REQUIRED';END IF;
 IF (SELECT count(*) FROM cron.job WHERE jobname='zenvia-shipping-creation-reconcile' AND NOT active)<>1 THEN RAISE EXCEPTION 'CREATION_JOB_CHANGED';END IF;
END $guard$;
UPDATE private.shipping_creation_worker_control SET enabled=true WHERE singleton;
SELECT cron.alter_job(jobid,active:=true) FROM cron.job WHERE jobname='zenvia-shipping-creation-reconcile';
COMMIT;
