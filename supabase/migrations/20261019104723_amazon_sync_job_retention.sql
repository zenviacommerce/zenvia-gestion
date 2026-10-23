CREATE TABLE IF NOT EXISTS private.amazon_sync_job_retention_config(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),enabled boolean NOT NULL DEFAULT false,keep_days integer NOT NULL DEFAULT 14 CHECK(keep_days BETWEEN 7 AND 365),batch_size integer NOT NULL DEFAULT 500 CHECK(batch_size BETWEEN 1 AND 1000),updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO private.amazon_sync_job_retention_config(singleton,enabled,keep_days,batch_size) VALUES(true,false,14,500) ON CONFLICT(singleton) DO NOTHING;
REVOKE ALL ON private.amazon_sync_job_retention_config FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS private.amazon_sync_job_retention_receipts(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,executed_at timestamptz NOT NULL DEFAULT now(),deleted_count integer NOT NULL,elapsed_ms integer NOT NULL,skipped_reason text,keep_days integer NOT NULL,batch_size integer NOT NULL);
REVOKE ALL ON private.amazon_sync_job_retention_receipts FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION private.amazon_sync_job_retention_once() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $retention$
DECLARE cfg record; removed integer:=0; began timestamptz:=clock_timestamp();
BEGIN
 SELECT enabled,keep_days,batch_size INTO cfg FROM private.amazon_sync_job_retention_config WHERE singleton FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AMAZON_RETENTION_NO_CONFIGURATION'; END IF;
 IF NOT cfg.enabled THEN
  INSERT INTO private.amazon_sync_job_retention_receipts(deleted_count,elapsed_ms,skipped_reason,keep_days,batch_size) VALUES(0,0,'disabled',cfg.keep_days,cfg.batch_size);
  RETURN 0;
 END IF;
 WITH eligible AS (SELECT id FROM public.amazon_sync_jobs WHERE status IN ('success','superseded') AND finished_at IS NOT NULL AND finished_at < now()-make_interval(days=>cfg.keep_days) ORDER BY finished_at,id LIMIT cfg.batch_size FOR UPDATE SKIP LOCKED),
 deleted AS (DELETE FROM public.amazon_sync_jobs j USING eligible e WHERE j.id=e.id RETURNING j.id)
 SELECT count(*)::integer INTO removed FROM deleted;
 INSERT INTO private.amazon_sync_job_retention_receipts(deleted_count,elapsed_ms,keep_days,batch_size) VALUES(removed,ceil(extract(epoch FROM clock_timestamp()-began)*1000)::integer,cfg.keep_days,cfg.batch_size);
 RETURN removed;
END $retention$;
REVOKE ALL ON FUNCTION private.amazon_sync_job_retention_once() FROM PUBLIC,anon,authenticated;
SELECT cron.schedule('amazon-sync-job-retention','25 3 * * *',$job$SELECT private.amazon_sync_job_retention_once();$job$);
