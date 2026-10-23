-- Safe containment: preserve operations, order locks, and evidence. No DROP/DELETE.
BEGIN;
UPDATE private.shipping_creation_worker_control SET enabled=false WHERE singleton;
SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='zenvia-shipping-creation-reconcile';
COMMIT;
-- Before downgrading any provider creation Edge Function, require ZERO open
-- attempts and ZERO *_CREATING markers. Otherwise keep the current guarded
-- provider handlers + manual reconcile endpoint, and roll UI back independently.
DO $downgrade_guard$
BEGIN
 IF EXISTS(SELECT 1 FROM private.shipping_creation_operations WHERE closed_at IS NULL) OR EXISTS(SELECT 1 FROM public.fulfillment_orders WHERE tracking_status_code IN('MRW_CREATING','SENDCLOUD_CREATING','ENVIA_CREATING')) THEN
  RAISE EXCEPTION 'CREATION_DOWNGRADE_UNSAFE_KEEP_GUARDED_HANDLERS';
 END IF;
END $downgrade_guard$;
