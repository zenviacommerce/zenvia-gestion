BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_prepared_statements WHERE name='projection_benchmark_receipt') THEN DEALLOCATE projection_benchmark_receipt;END IF;END$$;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='25ms';
SET LOCAL application_name='orders-projection-write-benchmark';
CREATE TEMP TABLE projection_write_cohort ON COMMIT DROP AS
WITH groups AS MATERIALIZED (
 SELECT DISTINCT ON(owner_id,private.orders_dashboard_group_key(source_channel,order_number,id)) id,owner_id,
 private.orders_dashboard_group_key(source_channel,order_number,id) group_key
 FROM public.fulfillment_orders WHERE source_channel='amazon' AND pii_purged_at IS NULL AND order_action_lease IS NULL
 ORDER BY owner_id,private.orders_dashboard_group_key(source_channel,order_number,id),id
)
SELECT id,row_number() OVER(ORDER BY owner_id,group_key,id) rn FROM groups ORDER BY owner_id,group_key,id LIMIT 200;
CREATE TEMP TABLE projection_write_times(row_n bigint,ms double precision,ok boolean,error_code text) ON COMMIT DROP;
DO $bench$
DECLARE r record; started timestamptz; phase boolean; before_q bigint; after_q bigint; n integer:=0; failures_before bigint; errors integer:=0; receipt jsonb; wall_start timestamptz; wall_end timestamptz; cohort_hash text;
BEGIN
 SELECT maintenance_enabled INTO STRICT phase FROM private.orders_projection_control WHERE singleton;
 IF phase IS DISTINCT FROM __ENABLED__ THEN RAISE EXCEPTION 'BENCHMARK_SWITCH_MISMATCH';END IF;
 PERFORM pg_sleep(greatest(0,extract(epoch from '__BARRIER__'::timestamptz-clock_timestamp())));
 SELECT count(*) INTO before_q FROM private.orders_projection_dirty;
 SELECT count(*) INTO failures_before FROM private.orders_projection_failures;
 wall_start:=clock_timestamp();
 SELECT md5(string_agg(id::text,',' ORDER BY rn)) INTO cohort_hash FROM projection_write_cohort;
 IF (SELECT count(*) FROM projection_write_cohort)<>200 THEN RAISE EXCEPTION 'INCOMPLETE_COHORT';END IF;
 FOR r IN SELECT id,rn FROM projection_write_cohort WHERE (rn-1)%__LANES__=__LANE__ ORDER BY rn LOOP
  started:=clock_timestamp();
  BEGIN
   UPDATE public.fulfillment_orders SET updated_at=clock_timestamp() WHERE id=r.id;
   INSERT INTO projection_write_times VALUES(r.rn,extract(epoch from clock_timestamp()-started)*1000,true,null);
   n:=n+1;
  EXCEPTION WHEN lock_not_available THEN
   INSERT INTO projection_write_times VALUES(r.rn,extract(epoch from clock_timestamp()-started)*1000,false,SQLSTATE);errors:=errors+1;
  END;
  PERFORM pg_sleep(0.001);
 END LOOP;
 wall_end:=clock_timestamp();
 SELECT count(*) INTO after_q FROM private.orders_projection_dirty;
 SELECT jsonb_build_object('cohort_hash',cohort_hash,'maintenance_enabled',phase,'lane',__LANE__,'lanes',__LANES__,'pid',pg_backend_pid(),
  'transaction_id',pg_current_xact_id()::text,'wall_start',wall_start,'wall_end',wall_end,'successful_updates',n,'lock_timeouts',errors,'queued_delta',after_q-before_q,
  'failure_delta',(SELECT count(*)-failures_before FROM private.orders_projection_failures),
  'p50_ms',percentile_cont(.5)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),'p95_ms',percentile_cont(.95)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),
  'max_ms',max(ms)FILTER(WHERE ok),'paired_samples',jsonb_agg(jsonb_build_object('row',row_n,'ms',ms)ORDER BY row_n)FILTER(WHERE ok),'samples_ms',jsonb_agg(ms ORDER BY ms)FILTER(WHERE ok)) INTO receipt FROM projection_write_times;
 IF n<>200/__LANES__ OR errors<>0 THEN RAISE EXCEPTION 'INCOMPLETE_OR_FAILED_UPDATES';END IF;
 IF phase AND after_q-before_q<>2*n THEN RAISE EXCEPTION 'ENQUEUE_NOT_EXERCISED';END IF;
 IF NOT phase AND after_q-before_q<>0 THEN RAISE EXCEPTION 'DISABLED_TRIGGER_ENQUEUED';END IF;
 EXECUTE format('PREPARE projection_benchmark_receipt AS SELECT %L::jsonb receipt,pg_xact_status(%L::xid8) transaction_status',receipt::text,pg_current_xact_id()::text);
END $bench$;
ROLLBACK;
EXECUTE projection_benchmark_receipt;
