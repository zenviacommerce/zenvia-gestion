-- PREPARE ONLY. Execute with the reviewed backend release, after snapshot/count.
-- Clone the existing authenticated worker template without printing its secret.
BEGIN;
DO $schedule$
DECLARE cmd text;job bigint;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM private.shipping_creation_worker_control WHERE singleton AND NOT enabled) THEN RAISE EXCEPTION 'CREATION_WORKER_MUST_BE_PAUSED';END IF;
 IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='zenvia-shipping-creation-reconcile') THEN RAISE EXCEPTION 'CREATION_JOB_ALREADY_EXISTS';END IF;
 SELECT command INTO STRICT cmd FROM cron.job WHERE jobname='amazon-sync-worker';
 IF position('/amazon-sync-worker' IN cmd)=0 THEN RAISE EXCEPTION 'CREATION_CRON_TEMPLATE_CHANGED';END IF;
 cmd:=replace(cmd,'/amazon-sync-worker','/shipping-creation-worker');
 job:=cron.schedule('zenvia-shipping-creation-reconcile','* * * * *',cmd);
 PERFORM cron.alter_job(job,active:=false);
END $schedule$;
COMMIT;
