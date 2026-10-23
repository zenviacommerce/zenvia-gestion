SELECT cron.schedule('write-0850-on-4-0','50 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0850-on-4-0''); UPDATE private.orders_projection_control SET maintenance_enabled=true WHERE singleton; COMMIT;
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_prepared_statements WHERE name=''projection_benchmark_receipt'') THEN DEALLOCATE projection_benchmark_receipt;END IF;END$$;
SET LOCAL statement_timeout=''15s'';
SET LOCAL lock_timeout=''25ms'';
SET LOCAL application_name=''orders-projection-write-benchmark'';
CREATE TEMP TABLE projection_write_cohort ON COMMIT DROP AS
WITH groups AS MATERIALIZED (
 SELECT DISTINCT ON(owner_id,private.orders_dashboard_group_key(source_channel,order_number,id)) id,owner_id,
 private.orders_dashboard_group_key(source_channel,order_number,id) group_key
 FROM public.fulfillment_orders WHERE source_channel=''amazon'' AND pii_purged_at IS NULL AND order_action_lease IS NULL
 ORDER BY owner_id,private.orders_dashboard_group_key(source_channel,order_number,id),id
)
SELECT id,row_number() OVER(ORDER BY owner_id,group_key,id) rn FROM groups ORDER BY owner_id,group_key,id LIMIT 200;
CREATE TEMP TABLE projection_write_times(row_n bigint,ms double precision,ok boolean,error_code text) ON COMMIT DROP;
DO $bench$
DECLARE r record; started timestamptz; phase boolean; before_q bigint; after_q bigint; n integer:=0; failures_before bigint; errors integer:=0; receipt jsonb; wall_start timestamptz; wall_end timestamptz; cohort_hash text;
BEGIN
 SELECT maintenance_enabled INTO STRICT phase FROM private.orders_projection_control WHERE singleton;
 IF phase IS DISTINCT FROM true THEN RAISE EXCEPTION ''BENCHMARK_SWITCH_MISMATCH'';END IF;
 PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:50:03.000Z''::timestamptz-clock_timestamp())));
 SELECT count(*) INTO before_q FROM private.orders_projection_dirty;
 SELECT count(*) INTO failures_before FROM private.orders_projection_failures;
 wall_start:=clock_timestamp();
 SELECT md5(string_agg(id::text,'','' ORDER BY rn)) INTO cohort_hash FROM projection_write_cohort;
 IF (SELECT count(*) FROM projection_write_cohort)<>200 THEN RAISE EXCEPTION ''INCOMPLETE_COHORT'';END IF;
 FOR r IN SELECT id,rn FROM projection_write_cohort WHERE (rn-1)%4=0 ORDER BY rn LOOP
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
 SELECT jsonb_build_object(''cohort_hash'',cohort_hash,''maintenance_enabled'',phase,''lane'',0,''lanes'',4,''pid'',pg_backend_pid(),
  ''transaction_id'',pg_current_xact_id()::text,''wall_start'',wall_start,''wall_end'',wall_end,''successful_updates'',n,''lock_timeouts'',errors,''queued_delta'',after_q-before_q,
  ''failure_delta'',(SELECT count(*)-failures_before FROM private.orders_projection_failures),
  ''p50_ms'',percentile_cont(.5)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),''p95_ms'',percentile_cont(.95)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),
  ''max_ms'',max(ms)FILTER(WHERE ok),''paired_samples'',jsonb_agg(jsonb_build_object(''row'',row_n,''ms'',ms)ORDER BY row_n)FILTER(WHERE ok),''samples_ms'',jsonb_agg(ms ORDER BY ms)FILTER(WHERE ok)) INTO receipt FROM projection_write_times;
 IF n<>200/4 OR errors<>0 THEN RAISE EXCEPTION ''INCOMPLETE_OR_FAILED_UPDATES'';END IF;
 IF phase AND after_q-before_q<>2*n THEN RAISE EXCEPTION ''ENQUEUE_NOT_EXERCISED'';END IF;
 IF NOT phase AND after_q-before_q<>0 THEN RAISE EXCEPTION ''DISABLED_TRIGGER_ENQUEUED'';END IF;
 EXECUTE format(''PREPARE projection_benchmark_receipt AS INSERT INTO private.orders_projection_write_measurements(batch,lane,receipt,rollback_status) VALUES (''''write-0850-on-4'''',0,%L::jsonb,pg_xact_status(%L::xid8)) RETURNING rollback_status'',receipt::text,pg_current_xact_id()::text);
END $bench$;
ROLLBACK;
EXECUTE projection_benchmark_receipt;
');
SELECT cron.schedule('write-0850-on-4-1','50 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0850-on-4-1''); UPDATE private.orders_projection_control SET maintenance_enabled=true WHERE singleton; COMMIT;
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_prepared_statements WHERE name=''projection_benchmark_receipt'') THEN DEALLOCATE projection_benchmark_receipt;END IF;END$$;
SET LOCAL statement_timeout=''15s'';
SET LOCAL lock_timeout=''25ms'';
SET LOCAL application_name=''orders-projection-write-benchmark'';
CREATE TEMP TABLE projection_write_cohort ON COMMIT DROP AS
WITH groups AS MATERIALIZED (
 SELECT DISTINCT ON(owner_id,private.orders_dashboard_group_key(source_channel,order_number,id)) id,owner_id,
 private.orders_dashboard_group_key(source_channel,order_number,id) group_key
 FROM public.fulfillment_orders WHERE source_channel=''amazon'' AND pii_purged_at IS NULL AND order_action_lease IS NULL
 ORDER BY owner_id,private.orders_dashboard_group_key(source_channel,order_number,id),id
)
SELECT id,row_number() OVER(ORDER BY owner_id,group_key,id) rn FROM groups ORDER BY owner_id,group_key,id LIMIT 200;
CREATE TEMP TABLE projection_write_times(row_n bigint,ms double precision,ok boolean,error_code text) ON COMMIT DROP;
DO $bench$
DECLARE r record; started timestamptz; phase boolean; before_q bigint; after_q bigint; n integer:=0; failures_before bigint; errors integer:=0; receipt jsonb; wall_start timestamptz; wall_end timestamptz; cohort_hash text;
BEGIN
 SELECT maintenance_enabled INTO STRICT phase FROM private.orders_projection_control WHERE singleton;
 IF phase IS DISTINCT FROM true THEN RAISE EXCEPTION ''BENCHMARK_SWITCH_MISMATCH'';END IF;
 PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:50:03.000Z''::timestamptz-clock_timestamp())));
 SELECT count(*) INTO before_q FROM private.orders_projection_dirty;
 SELECT count(*) INTO failures_before FROM private.orders_projection_failures;
 wall_start:=clock_timestamp();
 SELECT md5(string_agg(id::text,'','' ORDER BY rn)) INTO cohort_hash FROM projection_write_cohort;
 IF (SELECT count(*) FROM projection_write_cohort)<>200 THEN RAISE EXCEPTION ''INCOMPLETE_COHORT'';END IF;
 FOR r IN SELECT id,rn FROM projection_write_cohort WHERE (rn-1)%4=1 ORDER BY rn LOOP
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
 SELECT jsonb_build_object(''cohort_hash'',cohort_hash,''maintenance_enabled'',phase,''lane'',1,''lanes'',4,''pid'',pg_backend_pid(),
  ''transaction_id'',pg_current_xact_id()::text,''wall_start'',wall_start,''wall_end'',wall_end,''successful_updates'',n,''lock_timeouts'',errors,''queued_delta'',after_q-before_q,
  ''failure_delta'',(SELECT count(*)-failures_before FROM private.orders_projection_failures),
  ''p50_ms'',percentile_cont(.5)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),''p95_ms'',percentile_cont(.95)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),
  ''max_ms'',max(ms)FILTER(WHERE ok),''paired_samples'',jsonb_agg(jsonb_build_object(''row'',row_n,''ms'',ms)ORDER BY row_n)FILTER(WHERE ok),''samples_ms'',jsonb_agg(ms ORDER BY ms)FILTER(WHERE ok)) INTO receipt FROM projection_write_times;
 IF n<>200/4 OR errors<>0 THEN RAISE EXCEPTION ''INCOMPLETE_OR_FAILED_UPDATES'';END IF;
 IF phase AND after_q-before_q<>2*n THEN RAISE EXCEPTION ''ENQUEUE_NOT_EXERCISED'';END IF;
 IF NOT phase AND after_q-before_q<>0 THEN RAISE EXCEPTION ''DISABLED_TRIGGER_ENQUEUED'';END IF;
 EXECUTE format(''PREPARE projection_benchmark_receipt AS INSERT INTO private.orders_projection_write_measurements(batch,lane,receipt,rollback_status) VALUES (''''write-0850-on-4'''',1,%L::jsonb,pg_xact_status(%L::xid8)) RETURNING rollback_status'',receipt::text,pg_current_xact_id()::text);
END $bench$;
ROLLBACK;
EXECUTE projection_benchmark_receipt;
');
SELECT cron.schedule('write-0850-on-4-2','50 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0850-on-4-2''); UPDATE private.orders_projection_control SET maintenance_enabled=true WHERE singleton; COMMIT;
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_prepared_statements WHERE name=''projection_benchmark_receipt'') THEN DEALLOCATE projection_benchmark_receipt;END IF;END$$;
SET LOCAL statement_timeout=''15s'';
SET LOCAL lock_timeout=''25ms'';
SET LOCAL application_name=''orders-projection-write-benchmark'';
CREATE TEMP TABLE projection_write_cohort ON COMMIT DROP AS
WITH groups AS MATERIALIZED (
 SELECT DISTINCT ON(owner_id,private.orders_dashboard_group_key(source_channel,order_number,id)) id,owner_id,
 private.orders_dashboard_group_key(source_channel,order_number,id) group_key
 FROM public.fulfillment_orders WHERE source_channel=''amazon'' AND pii_purged_at IS NULL AND order_action_lease IS NULL
 ORDER BY owner_id,private.orders_dashboard_group_key(source_channel,order_number,id),id
)
SELECT id,row_number() OVER(ORDER BY owner_id,group_key,id) rn FROM groups ORDER BY owner_id,group_key,id LIMIT 200;
CREATE TEMP TABLE projection_write_times(row_n bigint,ms double precision,ok boolean,error_code text) ON COMMIT DROP;
DO $bench$
DECLARE r record; started timestamptz; phase boolean; before_q bigint; after_q bigint; n integer:=0; failures_before bigint; errors integer:=0; receipt jsonb; wall_start timestamptz; wall_end timestamptz; cohort_hash text;
BEGIN
 SELECT maintenance_enabled INTO STRICT phase FROM private.orders_projection_control WHERE singleton;
 IF phase IS DISTINCT FROM true THEN RAISE EXCEPTION ''BENCHMARK_SWITCH_MISMATCH'';END IF;
 PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:50:03.000Z''::timestamptz-clock_timestamp())));
 SELECT count(*) INTO before_q FROM private.orders_projection_dirty;
 SELECT count(*) INTO failures_before FROM private.orders_projection_failures;
 wall_start:=clock_timestamp();
 SELECT md5(string_agg(id::text,'','' ORDER BY rn)) INTO cohort_hash FROM projection_write_cohort;
 IF (SELECT count(*) FROM projection_write_cohort)<>200 THEN RAISE EXCEPTION ''INCOMPLETE_COHORT'';END IF;
 FOR r IN SELECT id,rn FROM projection_write_cohort WHERE (rn-1)%4=2 ORDER BY rn LOOP
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
 SELECT jsonb_build_object(''cohort_hash'',cohort_hash,''maintenance_enabled'',phase,''lane'',2,''lanes'',4,''pid'',pg_backend_pid(),
  ''transaction_id'',pg_current_xact_id()::text,''wall_start'',wall_start,''wall_end'',wall_end,''successful_updates'',n,''lock_timeouts'',errors,''queued_delta'',after_q-before_q,
  ''failure_delta'',(SELECT count(*)-failures_before FROM private.orders_projection_failures),
  ''p50_ms'',percentile_cont(.5)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),''p95_ms'',percentile_cont(.95)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),
  ''max_ms'',max(ms)FILTER(WHERE ok),''paired_samples'',jsonb_agg(jsonb_build_object(''row'',row_n,''ms'',ms)ORDER BY row_n)FILTER(WHERE ok),''samples_ms'',jsonb_agg(ms ORDER BY ms)FILTER(WHERE ok)) INTO receipt FROM projection_write_times;
 IF n<>200/4 OR errors<>0 THEN RAISE EXCEPTION ''INCOMPLETE_OR_FAILED_UPDATES'';END IF;
 IF phase AND after_q-before_q<>2*n THEN RAISE EXCEPTION ''ENQUEUE_NOT_EXERCISED'';END IF;
 IF NOT phase AND after_q-before_q<>0 THEN RAISE EXCEPTION ''DISABLED_TRIGGER_ENQUEUED'';END IF;
 EXECUTE format(''PREPARE projection_benchmark_receipt AS INSERT INTO private.orders_projection_write_measurements(batch,lane,receipt,rollback_status) VALUES (''''write-0850-on-4'''',2,%L::jsonb,pg_xact_status(%L::xid8)) RETURNING rollback_status'',receipt::text,pg_current_xact_id()::text);
END $bench$;
ROLLBACK;
EXECUTE projection_benchmark_receipt;
');
SELECT cron.schedule('write-0850-on-4-3','50 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0850-on-4-3''); UPDATE private.orders_projection_control SET maintenance_enabled=true WHERE singleton; COMMIT;
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_prepared_statements WHERE name=''projection_benchmark_receipt'') THEN DEALLOCATE projection_benchmark_receipt;END IF;END$$;
SET LOCAL statement_timeout=''15s'';
SET LOCAL lock_timeout=''25ms'';
SET LOCAL application_name=''orders-projection-write-benchmark'';
CREATE TEMP TABLE projection_write_cohort ON COMMIT DROP AS
WITH groups AS MATERIALIZED (
 SELECT DISTINCT ON(owner_id,private.orders_dashboard_group_key(source_channel,order_number,id)) id,owner_id,
 private.orders_dashboard_group_key(source_channel,order_number,id) group_key
 FROM public.fulfillment_orders WHERE source_channel=''amazon'' AND pii_purged_at IS NULL AND order_action_lease IS NULL
 ORDER BY owner_id,private.orders_dashboard_group_key(source_channel,order_number,id),id
)
SELECT id,row_number() OVER(ORDER BY owner_id,group_key,id) rn FROM groups ORDER BY owner_id,group_key,id LIMIT 200;
CREATE TEMP TABLE projection_write_times(row_n bigint,ms double precision,ok boolean,error_code text) ON COMMIT DROP;
DO $bench$
DECLARE r record; started timestamptz; phase boolean; before_q bigint; after_q bigint; n integer:=0; failures_before bigint; errors integer:=0; receipt jsonb; wall_start timestamptz; wall_end timestamptz; cohort_hash text;
BEGIN
 SELECT maintenance_enabled INTO STRICT phase FROM private.orders_projection_control WHERE singleton;
 IF phase IS DISTINCT FROM true THEN RAISE EXCEPTION ''BENCHMARK_SWITCH_MISMATCH'';END IF;
 PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:50:03.000Z''::timestamptz-clock_timestamp())));
 SELECT count(*) INTO before_q FROM private.orders_projection_dirty;
 SELECT count(*) INTO failures_before FROM private.orders_projection_failures;
 wall_start:=clock_timestamp();
 SELECT md5(string_agg(id::text,'','' ORDER BY rn)) INTO cohort_hash FROM projection_write_cohort;
 IF (SELECT count(*) FROM projection_write_cohort)<>200 THEN RAISE EXCEPTION ''INCOMPLETE_COHORT'';END IF;
 FOR r IN SELECT id,rn FROM projection_write_cohort WHERE (rn-1)%4=3 ORDER BY rn LOOP
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
 SELECT jsonb_build_object(''cohort_hash'',cohort_hash,''maintenance_enabled'',phase,''lane'',3,''lanes'',4,''pid'',pg_backend_pid(),
  ''transaction_id'',pg_current_xact_id()::text,''wall_start'',wall_start,''wall_end'',wall_end,''successful_updates'',n,''lock_timeouts'',errors,''queued_delta'',after_q-before_q,
  ''failure_delta'',(SELECT count(*)-failures_before FROM private.orders_projection_failures),
  ''p50_ms'',percentile_cont(.5)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),''p95_ms'',percentile_cont(.95)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),
  ''max_ms'',max(ms)FILTER(WHERE ok),''paired_samples'',jsonb_agg(jsonb_build_object(''row'',row_n,''ms'',ms)ORDER BY row_n)FILTER(WHERE ok),''samples_ms'',jsonb_agg(ms ORDER BY ms)FILTER(WHERE ok)) INTO receipt FROM projection_write_times;
 IF n<>200/4 OR errors<>0 THEN RAISE EXCEPTION ''INCOMPLETE_OR_FAILED_UPDATES'';END IF;
 IF phase AND after_q-before_q<>2*n THEN RAISE EXCEPTION ''ENQUEUE_NOT_EXERCISED'';END IF;
 IF NOT phase AND after_q-before_q<>0 THEN RAISE EXCEPTION ''DISABLED_TRIGGER_ENQUEUED'';END IF;
 EXECUTE format(''PREPARE projection_benchmark_receipt AS INSERT INTO private.orders_projection_write_measurements(batch,lane,receipt,rollback_status) VALUES (''''write-0850-on-4'''',3,%L::jsonb,pg_xact_status(%L::xid8)) RETURNING rollback_status'',receipt::text,pg_current_xact_id()::text);
END $bench$;
ROLLBACK;
EXECUTE projection_benchmark_receipt;
');
SELECT cron.schedule('write-0850-on-4-watch','50 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0850-on-4-watch'');COMMIT; SET application_name=''projection-lock-watch''; DO $watch$ DECLARE n int; w int; mx int:=0; waits int:=0; overlap int:=0; advisory int:=0; samples int:=0; started timestamptz; BEGIN PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:50:03.000Z''::timestamptz-clock_timestamp())-.05));started:=clock_timestamp();FOR i IN 1..300 LOOP PERFORM pg_stat_clear_snapshot(); SELECT count(*),count(*) FILTER(WHERE wait_event_type=''Lock'') INTO n,w FROM pg_stat_activity WHERE application_name=''orders-projection-write-benchmark'' AND state=''active'';mx:=greatest(mx,n);waits:=waits+w;IF n>=2 THEN overlap:=overlap+1;END IF;SELECT count(*) INTO w FROM pg_locks l JOIN pg_stat_activity a USING(pid) WHERE a.application_name=''orders-projection-write-benchmark'' AND NOT l.granted AND l.locktype=''advisory'';advisory:=advisory+w;samples:=samples+1;PERFORM pg_sleep(.01);END LOOP;UPDATE private.orders_projection_control SET maintenance_enabled=true WHERE singleton;INSERT INTO private.orders_projection_write_measurements VALUES(''write-0850-on-4'',-1,jsonb_build_object(''max_active_sessions'',mx,''overlap_samples'',overlap,''lock_wait_samples'',waits,''advisory_wait_samples'',advisory,''samples'',samples,''started'',started,''restored_at'',clock_timestamp()),''observer'',clock_timestamp());END $watch$;');
SELECT cron.schedule('write-0851-off-4-0','51 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0851-off-4-0''); UPDATE private.orders_projection_control SET maintenance_enabled=false WHERE singleton; COMMIT;
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_prepared_statements WHERE name=''projection_benchmark_receipt'') THEN DEALLOCATE projection_benchmark_receipt;END IF;END$$;
SET LOCAL statement_timeout=''15s'';
SET LOCAL lock_timeout=''25ms'';
SET LOCAL application_name=''orders-projection-write-benchmark'';
CREATE TEMP TABLE projection_write_cohort ON COMMIT DROP AS
WITH groups AS MATERIALIZED (
 SELECT DISTINCT ON(owner_id,private.orders_dashboard_group_key(source_channel,order_number,id)) id,owner_id,
 private.orders_dashboard_group_key(source_channel,order_number,id) group_key
 FROM public.fulfillment_orders WHERE source_channel=''amazon'' AND pii_purged_at IS NULL AND order_action_lease IS NULL
 ORDER BY owner_id,private.orders_dashboard_group_key(source_channel,order_number,id),id
)
SELECT id,row_number() OVER(ORDER BY owner_id,group_key,id) rn FROM groups ORDER BY owner_id,group_key,id LIMIT 200;
CREATE TEMP TABLE projection_write_times(row_n bigint,ms double precision,ok boolean,error_code text) ON COMMIT DROP;
DO $bench$
DECLARE r record; started timestamptz; phase boolean; before_q bigint; after_q bigint; n integer:=0; failures_before bigint; errors integer:=0; receipt jsonb; wall_start timestamptz; wall_end timestamptz; cohort_hash text;
BEGIN
 SELECT maintenance_enabled INTO STRICT phase FROM private.orders_projection_control WHERE singleton;
 IF phase IS DISTINCT FROM false THEN RAISE EXCEPTION ''BENCHMARK_SWITCH_MISMATCH'';END IF;
 PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:51:03.000Z''::timestamptz-clock_timestamp())));
 SELECT count(*) INTO before_q FROM private.orders_projection_dirty;
 SELECT count(*) INTO failures_before FROM private.orders_projection_failures;
 wall_start:=clock_timestamp();
 SELECT md5(string_agg(id::text,'','' ORDER BY rn)) INTO cohort_hash FROM projection_write_cohort;
 IF (SELECT count(*) FROM projection_write_cohort)<>200 THEN RAISE EXCEPTION ''INCOMPLETE_COHORT'';END IF;
 FOR r IN SELECT id,rn FROM projection_write_cohort WHERE (rn-1)%4=0 ORDER BY rn LOOP
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
 SELECT jsonb_build_object(''cohort_hash'',cohort_hash,''maintenance_enabled'',phase,''lane'',0,''lanes'',4,''pid'',pg_backend_pid(),
  ''transaction_id'',pg_current_xact_id()::text,''wall_start'',wall_start,''wall_end'',wall_end,''successful_updates'',n,''lock_timeouts'',errors,''queued_delta'',after_q-before_q,
  ''failure_delta'',(SELECT count(*)-failures_before FROM private.orders_projection_failures),
  ''p50_ms'',percentile_cont(.5)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),''p95_ms'',percentile_cont(.95)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),
  ''max_ms'',max(ms)FILTER(WHERE ok),''paired_samples'',jsonb_agg(jsonb_build_object(''row'',row_n,''ms'',ms)ORDER BY row_n)FILTER(WHERE ok),''samples_ms'',jsonb_agg(ms ORDER BY ms)FILTER(WHERE ok)) INTO receipt FROM projection_write_times;
 IF n<>200/4 OR errors<>0 THEN RAISE EXCEPTION ''INCOMPLETE_OR_FAILED_UPDATES'';END IF;
 IF phase AND after_q-before_q<>2*n THEN RAISE EXCEPTION ''ENQUEUE_NOT_EXERCISED'';END IF;
 IF NOT phase AND after_q-before_q<>0 THEN RAISE EXCEPTION ''DISABLED_TRIGGER_ENQUEUED'';END IF;
 EXECUTE format(''PREPARE projection_benchmark_receipt AS INSERT INTO private.orders_projection_write_measurements(batch,lane,receipt,rollback_status) VALUES (''''write-0851-off-4'''',0,%L::jsonb,pg_xact_status(%L::xid8)) RETURNING rollback_status'',receipt::text,pg_current_xact_id()::text);
END $bench$;
ROLLBACK;
EXECUTE projection_benchmark_receipt;
');
SELECT cron.schedule('write-0851-off-4-1','51 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0851-off-4-1''); UPDATE private.orders_projection_control SET maintenance_enabled=false WHERE singleton; COMMIT;
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_prepared_statements WHERE name=''projection_benchmark_receipt'') THEN DEALLOCATE projection_benchmark_receipt;END IF;END$$;
SET LOCAL statement_timeout=''15s'';
SET LOCAL lock_timeout=''25ms'';
SET LOCAL application_name=''orders-projection-write-benchmark'';
CREATE TEMP TABLE projection_write_cohort ON COMMIT DROP AS
WITH groups AS MATERIALIZED (
 SELECT DISTINCT ON(owner_id,private.orders_dashboard_group_key(source_channel,order_number,id)) id,owner_id,
 private.orders_dashboard_group_key(source_channel,order_number,id) group_key
 FROM public.fulfillment_orders WHERE source_channel=''amazon'' AND pii_purged_at IS NULL AND order_action_lease IS NULL
 ORDER BY owner_id,private.orders_dashboard_group_key(source_channel,order_number,id),id
)
SELECT id,row_number() OVER(ORDER BY owner_id,group_key,id) rn FROM groups ORDER BY owner_id,group_key,id LIMIT 200;
CREATE TEMP TABLE projection_write_times(row_n bigint,ms double precision,ok boolean,error_code text) ON COMMIT DROP;
DO $bench$
DECLARE r record; started timestamptz; phase boolean; before_q bigint; after_q bigint; n integer:=0; failures_before bigint; errors integer:=0; receipt jsonb; wall_start timestamptz; wall_end timestamptz; cohort_hash text;
BEGIN
 SELECT maintenance_enabled INTO STRICT phase FROM private.orders_projection_control WHERE singleton;
 IF phase IS DISTINCT FROM false THEN RAISE EXCEPTION ''BENCHMARK_SWITCH_MISMATCH'';END IF;
 PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:51:03.000Z''::timestamptz-clock_timestamp())));
 SELECT count(*) INTO before_q FROM private.orders_projection_dirty;
 SELECT count(*) INTO failures_before FROM private.orders_projection_failures;
 wall_start:=clock_timestamp();
 SELECT md5(string_agg(id::text,'','' ORDER BY rn)) INTO cohort_hash FROM projection_write_cohort;
 IF (SELECT count(*) FROM projection_write_cohort)<>200 THEN RAISE EXCEPTION ''INCOMPLETE_COHORT'';END IF;
 FOR r IN SELECT id,rn FROM projection_write_cohort WHERE (rn-1)%4=1 ORDER BY rn LOOP
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
 SELECT jsonb_build_object(''cohort_hash'',cohort_hash,''maintenance_enabled'',phase,''lane'',1,''lanes'',4,''pid'',pg_backend_pid(),
  ''transaction_id'',pg_current_xact_id()::text,''wall_start'',wall_start,''wall_end'',wall_end,''successful_updates'',n,''lock_timeouts'',errors,''queued_delta'',after_q-before_q,
  ''failure_delta'',(SELECT count(*)-failures_before FROM private.orders_projection_failures),
  ''p50_ms'',percentile_cont(.5)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),''p95_ms'',percentile_cont(.95)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),
  ''max_ms'',max(ms)FILTER(WHERE ok),''paired_samples'',jsonb_agg(jsonb_build_object(''row'',row_n,''ms'',ms)ORDER BY row_n)FILTER(WHERE ok),''samples_ms'',jsonb_agg(ms ORDER BY ms)FILTER(WHERE ok)) INTO receipt FROM projection_write_times;
 IF n<>200/4 OR errors<>0 THEN RAISE EXCEPTION ''INCOMPLETE_OR_FAILED_UPDATES'';END IF;
 IF phase AND after_q-before_q<>2*n THEN RAISE EXCEPTION ''ENQUEUE_NOT_EXERCISED'';END IF;
 IF NOT phase AND after_q-before_q<>0 THEN RAISE EXCEPTION ''DISABLED_TRIGGER_ENQUEUED'';END IF;
 EXECUTE format(''PREPARE projection_benchmark_receipt AS INSERT INTO private.orders_projection_write_measurements(batch,lane,receipt,rollback_status) VALUES (''''write-0851-off-4'''',1,%L::jsonb,pg_xact_status(%L::xid8)) RETURNING rollback_status'',receipt::text,pg_current_xact_id()::text);
END $bench$;
ROLLBACK;
EXECUTE projection_benchmark_receipt;
');
SELECT cron.schedule('write-0851-off-4-2','51 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0851-off-4-2''); UPDATE private.orders_projection_control SET maintenance_enabled=false WHERE singleton; COMMIT;
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_prepared_statements WHERE name=''projection_benchmark_receipt'') THEN DEALLOCATE projection_benchmark_receipt;END IF;END$$;
SET LOCAL statement_timeout=''15s'';
SET LOCAL lock_timeout=''25ms'';
SET LOCAL application_name=''orders-projection-write-benchmark'';
CREATE TEMP TABLE projection_write_cohort ON COMMIT DROP AS
WITH groups AS MATERIALIZED (
 SELECT DISTINCT ON(owner_id,private.orders_dashboard_group_key(source_channel,order_number,id)) id,owner_id,
 private.orders_dashboard_group_key(source_channel,order_number,id) group_key
 FROM public.fulfillment_orders WHERE source_channel=''amazon'' AND pii_purged_at IS NULL AND order_action_lease IS NULL
 ORDER BY owner_id,private.orders_dashboard_group_key(source_channel,order_number,id),id
)
SELECT id,row_number() OVER(ORDER BY owner_id,group_key,id) rn FROM groups ORDER BY owner_id,group_key,id LIMIT 200;
CREATE TEMP TABLE projection_write_times(row_n bigint,ms double precision,ok boolean,error_code text) ON COMMIT DROP;
DO $bench$
DECLARE r record; started timestamptz; phase boolean; before_q bigint; after_q bigint; n integer:=0; failures_before bigint; errors integer:=0; receipt jsonb; wall_start timestamptz; wall_end timestamptz; cohort_hash text;
BEGIN
 SELECT maintenance_enabled INTO STRICT phase FROM private.orders_projection_control WHERE singleton;
 IF phase IS DISTINCT FROM false THEN RAISE EXCEPTION ''BENCHMARK_SWITCH_MISMATCH'';END IF;
 PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:51:03.000Z''::timestamptz-clock_timestamp())));
 SELECT count(*) INTO before_q FROM private.orders_projection_dirty;
 SELECT count(*) INTO failures_before FROM private.orders_projection_failures;
 wall_start:=clock_timestamp();
 SELECT md5(string_agg(id::text,'','' ORDER BY rn)) INTO cohort_hash FROM projection_write_cohort;
 IF (SELECT count(*) FROM projection_write_cohort)<>200 THEN RAISE EXCEPTION ''INCOMPLETE_COHORT'';END IF;
 FOR r IN SELECT id,rn FROM projection_write_cohort WHERE (rn-1)%4=2 ORDER BY rn LOOP
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
 SELECT jsonb_build_object(''cohort_hash'',cohort_hash,''maintenance_enabled'',phase,''lane'',2,''lanes'',4,''pid'',pg_backend_pid(),
  ''transaction_id'',pg_current_xact_id()::text,''wall_start'',wall_start,''wall_end'',wall_end,''successful_updates'',n,''lock_timeouts'',errors,''queued_delta'',after_q-before_q,
  ''failure_delta'',(SELECT count(*)-failures_before FROM private.orders_projection_failures),
  ''p50_ms'',percentile_cont(.5)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),''p95_ms'',percentile_cont(.95)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),
  ''max_ms'',max(ms)FILTER(WHERE ok),''paired_samples'',jsonb_agg(jsonb_build_object(''row'',row_n,''ms'',ms)ORDER BY row_n)FILTER(WHERE ok),''samples_ms'',jsonb_agg(ms ORDER BY ms)FILTER(WHERE ok)) INTO receipt FROM projection_write_times;
 IF n<>200/4 OR errors<>0 THEN RAISE EXCEPTION ''INCOMPLETE_OR_FAILED_UPDATES'';END IF;
 IF phase AND after_q-before_q<>2*n THEN RAISE EXCEPTION ''ENQUEUE_NOT_EXERCISED'';END IF;
 IF NOT phase AND after_q-before_q<>0 THEN RAISE EXCEPTION ''DISABLED_TRIGGER_ENQUEUED'';END IF;
 EXECUTE format(''PREPARE projection_benchmark_receipt AS INSERT INTO private.orders_projection_write_measurements(batch,lane,receipt,rollback_status) VALUES (''''write-0851-off-4'''',2,%L::jsonb,pg_xact_status(%L::xid8)) RETURNING rollback_status'',receipt::text,pg_current_xact_id()::text);
END $bench$;
ROLLBACK;
EXECUTE projection_benchmark_receipt;
');
SELECT cron.schedule('write-0851-off-4-3','51 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0851-off-4-3''); UPDATE private.orders_projection_control SET maintenance_enabled=false WHERE singleton; COMMIT;
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_prepared_statements WHERE name=''projection_benchmark_receipt'') THEN DEALLOCATE projection_benchmark_receipt;END IF;END$$;
SET LOCAL statement_timeout=''15s'';
SET LOCAL lock_timeout=''25ms'';
SET LOCAL application_name=''orders-projection-write-benchmark'';
CREATE TEMP TABLE projection_write_cohort ON COMMIT DROP AS
WITH groups AS MATERIALIZED (
 SELECT DISTINCT ON(owner_id,private.orders_dashboard_group_key(source_channel,order_number,id)) id,owner_id,
 private.orders_dashboard_group_key(source_channel,order_number,id) group_key
 FROM public.fulfillment_orders WHERE source_channel=''amazon'' AND pii_purged_at IS NULL AND order_action_lease IS NULL
 ORDER BY owner_id,private.orders_dashboard_group_key(source_channel,order_number,id),id
)
SELECT id,row_number() OVER(ORDER BY owner_id,group_key,id) rn FROM groups ORDER BY owner_id,group_key,id LIMIT 200;
CREATE TEMP TABLE projection_write_times(row_n bigint,ms double precision,ok boolean,error_code text) ON COMMIT DROP;
DO $bench$
DECLARE r record; started timestamptz; phase boolean; before_q bigint; after_q bigint; n integer:=0; failures_before bigint; errors integer:=0; receipt jsonb; wall_start timestamptz; wall_end timestamptz; cohort_hash text;
BEGIN
 SELECT maintenance_enabled INTO STRICT phase FROM private.orders_projection_control WHERE singleton;
 IF phase IS DISTINCT FROM false THEN RAISE EXCEPTION ''BENCHMARK_SWITCH_MISMATCH'';END IF;
 PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:51:03.000Z''::timestamptz-clock_timestamp())));
 SELECT count(*) INTO before_q FROM private.orders_projection_dirty;
 SELECT count(*) INTO failures_before FROM private.orders_projection_failures;
 wall_start:=clock_timestamp();
 SELECT md5(string_agg(id::text,'','' ORDER BY rn)) INTO cohort_hash FROM projection_write_cohort;
 IF (SELECT count(*) FROM projection_write_cohort)<>200 THEN RAISE EXCEPTION ''INCOMPLETE_COHORT'';END IF;
 FOR r IN SELECT id,rn FROM projection_write_cohort WHERE (rn-1)%4=3 ORDER BY rn LOOP
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
 SELECT jsonb_build_object(''cohort_hash'',cohort_hash,''maintenance_enabled'',phase,''lane'',3,''lanes'',4,''pid'',pg_backend_pid(),
  ''transaction_id'',pg_current_xact_id()::text,''wall_start'',wall_start,''wall_end'',wall_end,''successful_updates'',n,''lock_timeouts'',errors,''queued_delta'',after_q-before_q,
  ''failure_delta'',(SELECT count(*)-failures_before FROM private.orders_projection_failures),
  ''p50_ms'',percentile_cont(.5)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),''p95_ms'',percentile_cont(.95)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),
  ''max_ms'',max(ms)FILTER(WHERE ok),''paired_samples'',jsonb_agg(jsonb_build_object(''row'',row_n,''ms'',ms)ORDER BY row_n)FILTER(WHERE ok),''samples_ms'',jsonb_agg(ms ORDER BY ms)FILTER(WHERE ok)) INTO receipt FROM projection_write_times;
 IF n<>200/4 OR errors<>0 THEN RAISE EXCEPTION ''INCOMPLETE_OR_FAILED_UPDATES'';END IF;
 IF phase AND after_q-before_q<>2*n THEN RAISE EXCEPTION ''ENQUEUE_NOT_EXERCISED'';END IF;
 IF NOT phase AND after_q-before_q<>0 THEN RAISE EXCEPTION ''DISABLED_TRIGGER_ENQUEUED'';END IF;
 EXECUTE format(''PREPARE projection_benchmark_receipt AS INSERT INTO private.orders_projection_write_measurements(batch,lane,receipt,rollback_status) VALUES (''''write-0851-off-4'''',3,%L::jsonb,pg_xact_status(%L::xid8)) RETURNING rollback_status'',receipt::text,pg_current_xact_id()::text);
END $bench$;
ROLLBACK;
EXECUTE projection_benchmark_receipt;
');
SELECT cron.schedule('write-0851-off-4-watch','51 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0851-off-4-watch'');COMMIT; SET application_name=''projection-lock-watch''; DO $watch$ DECLARE n int; w int; mx int:=0; waits int:=0; overlap int:=0; advisory int:=0; samples int:=0; started timestamptz; BEGIN PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:51:03.000Z''::timestamptz-clock_timestamp())-.05));started:=clock_timestamp();FOR i IN 1..300 LOOP PERFORM pg_stat_clear_snapshot(); SELECT count(*),count(*) FILTER(WHERE wait_event_type=''Lock'') INTO n,w FROM pg_stat_activity WHERE application_name=''orders-projection-write-benchmark'' AND state=''active'';mx:=greatest(mx,n);waits:=waits+w;IF n>=2 THEN overlap:=overlap+1;END IF;SELECT count(*) INTO w FROM pg_locks l JOIN pg_stat_activity a USING(pid) WHERE a.application_name=''orders-projection-write-benchmark'' AND NOT l.granted AND l.locktype=''advisory'';advisory:=advisory+w;samples:=samples+1;PERFORM pg_sleep(.01);END LOOP;UPDATE private.orders_projection_control SET maintenance_enabled=true WHERE singleton;INSERT INTO private.orders_projection_write_measurements VALUES(''write-0851-off-4'',-1,jsonb_build_object(''max_active_sessions'',mx,''overlap_samples'',overlap,''lock_wait_samples'',waits,''advisory_wait_samples'',advisory,''samples'',samples,''started'',started,''restored_at'',clock_timestamp()),''observer'',clock_timestamp());END $watch$;');
SELECT cron.schedule('write-0852-on-2-0','52 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0852-on-2-0''); UPDATE private.orders_projection_control SET maintenance_enabled=true WHERE singleton; COMMIT;
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_prepared_statements WHERE name=''projection_benchmark_receipt'') THEN DEALLOCATE projection_benchmark_receipt;END IF;END$$;
SET LOCAL statement_timeout=''15s'';
SET LOCAL lock_timeout=''25ms'';
SET LOCAL application_name=''orders-projection-write-benchmark'';
CREATE TEMP TABLE projection_write_cohort ON COMMIT DROP AS
WITH groups AS MATERIALIZED (
 SELECT DISTINCT ON(owner_id,private.orders_dashboard_group_key(source_channel,order_number,id)) id,owner_id,
 private.orders_dashboard_group_key(source_channel,order_number,id) group_key
 FROM public.fulfillment_orders WHERE source_channel=''amazon'' AND pii_purged_at IS NULL AND order_action_lease IS NULL
 ORDER BY owner_id,private.orders_dashboard_group_key(source_channel,order_number,id),id
)
SELECT id,row_number() OVER(ORDER BY owner_id,group_key,id) rn FROM groups ORDER BY owner_id,group_key,id LIMIT 200;
CREATE TEMP TABLE projection_write_times(row_n bigint,ms double precision,ok boolean,error_code text) ON COMMIT DROP;
DO $bench$
DECLARE r record; started timestamptz; phase boolean; before_q bigint; after_q bigint; n integer:=0; failures_before bigint; errors integer:=0; receipt jsonb; wall_start timestamptz; wall_end timestamptz; cohort_hash text;
BEGIN
 SELECT maintenance_enabled INTO STRICT phase FROM private.orders_projection_control WHERE singleton;
 IF phase IS DISTINCT FROM true THEN RAISE EXCEPTION ''BENCHMARK_SWITCH_MISMATCH'';END IF;
 PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:52:03.000Z''::timestamptz-clock_timestamp())));
 SELECT count(*) INTO before_q FROM private.orders_projection_dirty;
 SELECT count(*) INTO failures_before FROM private.orders_projection_failures;
 wall_start:=clock_timestamp();
 SELECT md5(string_agg(id::text,'','' ORDER BY rn)) INTO cohort_hash FROM projection_write_cohort;
 IF (SELECT count(*) FROM projection_write_cohort)<>200 THEN RAISE EXCEPTION ''INCOMPLETE_COHORT'';END IF;
 FOR r IN SELECT id,rn FROM projection_write_cohort WHERE (rn-1)%2=0 ORDER BY rn LOOP
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
 SELECT jsonb_build_object(''cohort_hash'',cohort_hash,''maintenance_enabled'',phase,''lane'',0,''lanes'',2,''pid'',pg_backend_pid(),
  ''transaction_id'',pg_current_xact_id()::text,''wall_start'',wall_start,''wall_end'',wall_end,''successful_updates'',n,''lock_timeouts'',errors,''queued_delta'',after_q-before_q,
  ''failure_delta'',(SELECT count(*)-failures_before FROM private.orders_projection_failures),
  ''p50_ms'',percentile_cont(.5)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),''p95_ms'',percentile_cont(.95)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),
  ''max_ms'',max(ms)FILTER(WHERE ok),''paired_samples'',jsonb_agg(jsonb_build_object(''row'',row_n,''ms'',ms)ORDER BY row_n)FILTER(WHERE ok),''samples_ms'',jsonb_agg(ms ORDER BY ms)FILTER(WHERE ok)) INTO receipt FROM projection_write_times;
 IF n<>200/2 OR errors<>0 THEN RAISE EXCEPTION ''INCOMPLETE_OR_FAILED_UPDATES'';END IF;
 IF phase AND after_q-before_q<>2*n THEN RAISE EXCEPTION ''ENQUEUE_NOT_EXERCISED'';END IF;
 IF NOT phase AND after_q-before_q<>0 THEN RAISE EXCEPTION ''DISABLED_TRIGGER_ENQUEUED'';END IF;
 EXECUTE format(''PREPARE projection_benchmark_receipt AS INSERT INTO private.orders_projection_write_measurements(batch,lane,receipt,rollback_status) VALUES (''''write-0852-on-2'''',0,%L::jsonb,pg_xact_status(%L::xid8)) RETURNING rollback_status'',receipt::text,pg_current_xact_id()::text);
END $bench$;
ROLLBACK;
EXECUTE projection_benchmark_receipt;
');
SELECT cron.schedule('write-0852-on-2-1','52 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0852-on-2-1''); UPDATE private.orders_projection_control SET maintenance_enabled=true WHERE singleton; COMMIT;
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_prepared_statements WHERE name=''projection_benchmark_receipt'') THEN DEALLOCATE projection_benchmark_receipt;END IF;END$$;
SET LOCAL statement_timeout=''15s'';
SET LOCAL lock_timeout=''25ms'';
SET LOCAL application_name=''orders-projection-write-benchmark'';
CREATE TEMP TABLE projection_write_cohort ON COMMIT DROP AS
WITH groups AS MATERIALIZED (
 SELECT DISTINCT ON(owner_id,private.orders_dashboard_group_key(source_channel,order_number,id)) id,owner_id,
 private.orders_dashboard_group_key(source_channel,order_number,id) group_key
 FROM public.fulfillment_orders WHERE source_channel=''amazon'' AND pii_purged_at IS NULL AND order_action_lease IS NULL
 ORDER BY owner_id,private.orders_dashboard_group_key(source_channel,order_number,id),id
)
SELECT id,row_number() OVER(ORDER BY owner_id,group_key,id) rn FROM groups ORDER BY owner_id,group_key,id LIMIT 200;
CREATE TEMP TABLE projection_write_times(row_n bigint,ms double precision,ok boolean,error_code text) ON COMMIT DROP;
DO $bench$
DECLARE r record; started timestamptz; phase boolean; before_q bigint; after_q bigint; n integer:=0; failures_before bigint; errors integer:=0; receipt jsonb; wall_start timestamptz; wall_end timestamptz; cohort_hash text;
BEGIN
 SELECT maintenance_enabled INTO STRICT phase FROM private.orders_projection_control WHERE singleton;
 IF phase IS DISTINCT FROM true THEN RAISE EXCEPTION ''BENCHMARK_SWITCH_MISMATCH'';END IF;
 PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:52:03.000Z''::timestamptz-clock_timestamp())));
 SELECT count(*) INTO before_q FROM private.orders_projection_dirty;
 SELECT count(*) INTO failures_before FROM private.orders_projection_failures;
 wall_start:=clock_timestamp();
 SELECT md5(string_agg(id::text,'','' ORDER BY rn)) INTO cohort_hash FROM projection_write_cohort;
 IF (SELECT count(*) FROM projection_write_cohort)<>200 THEN RAISE EXCEPTION ''INCOMPLETE_COHORT'';END IF;
 FOR r IN SELECT id,rn FROM projection_write_cohort WHERE (rn-1)%2=1 ORDER BY rn LOOP
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
 SELECT jsonb_build_object(''cohort_hash'',cohort_hash,''maintenance_enabled'',phase,''lane'',1,''lanes'',2,''pid'',pg_backend_pid(),
  ''transaction_id'',pg_current_xact_id()::text,''wall_start'',wall_start,''wall_end'',wall_end,''successful_updates'',n,''lock_timeouts'',errors,''queued_delta'',after_q-before_q,
  ''failure_delta'',(SELECT count(*)-failures_before FROM private.orders_projection_failures),
  ''p50_ms'',percentile_cont(.5)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),''p95_ms'',percentile_cont(.95)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),
  ''max_ms'',max(ms)FILTER(WHERE ok),''paired_samples'',jsonb_agg(jsonb_build_object(''row'',row_n,''ms'',ms)ORDER BY row_n)FILTER(WHERE ok),''samples_ms'',jsonb_agg(ms ORDER BY ms)FILTER(WHERE ok)) INTO receipt FROM projection_write_times;
 IF n<>200/2 OR errors<>0 THEN RAISE EXCEPTION ''INCOMPLETE_OR_FAILED_UPDATES'';END IF;
 IF phase AND after_q-before_q<>2*n THEN RAISE EXCEPTION ''ENQUEUE_NOT_EXERCISED'';END IF;
 IF NOT phase AND after_q-before_q<>0 THEN RAISE EXCEPTION ''DISABLED_TRIGGER_ENQUEUED'';END IF;
 EXECUTE format(''PREPARE projection_benchmark_receipt AS INSERT INTO private.orders_projection_write_measurements(batch,lane,receipt,rollback_status) VALUES (''''write-0852-on-2'''',1,%L::jsonb,pg_xact_status(%L::xid8)) RETURNING rollback_status'',receipt::text,pg_current_xact_id()::text);
END $bench$;
ROLLBACK;
EXECUTE projection_benchmark_receipt;
');
SELECT cron.schedule('write-0852-on-2-watch','52 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0852-on-2-watch'');COMMIT; SET application_name=''projection-lock-watch''; DO $watch$ DECLARE n int; w int; mx int:=0; waits int:=0; overlap int:=0; advisory int:=0; samples int:=0; started timestamptz; BEGIN PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:52:03.000Z''::timestamptz-clock_timestamp())-.05));started:=clock_timestamp();FOR i IN 1..300 LOOP PERFORM pg_stat_clear_snapshot(); SELECT count(*),count(*) FILTER(WHERE wait_event_type=''Lock'') INTO n,w FROM pg_stat_activity WHERE application_name=''orders-projection-write-benchmark'' AND state=''active'';mx:=greatest(mx,n);waits:=waits+w;IF n>=2 THEN overlap:=overlap+1;END IF;SELECT count(*) INTO w FROM pg_locks l JOIN pg_stat_activity a USING(pid) WHERE a.application_name=''orders-projection-write-benchmark'' AND NOT l.granted AND l.locktype=''advisory'';advisory:=advisory+w;samples:=samples+1;PERFORM pg_sleep(.01);END LOOP;UPDATE private.orders_projection_control SET maintenance_enabled=true WHERE singleton;INSERT INTO private.orders_projection_write_measurements VALUES(''write-0852-on-2'',-1,jsonb_build_object(''max_active_sessions'',mx,''overlap_samples'',overlap,''lock_wait_samples'',waits,''advisory_wait_samples'',advisory,''samples'',samples,''started'',started,''restored_at'',clock_timestamp()),''observer'',clock_timestamp());END $watch$;');
SELECT cron.schedule('write-0853-off-2-0','53 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0853-off-2-0''); UPDATE private.orders_projection_control SET maintenance_enabled=false WHERE singleton; COMMIT;
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_prepared_statements WHERE name=''projection_benchmark_receipt'') THEN DEALLOCATE projection_benchmark_receipt;END IF;END$$;
SET LOCAL statement_timeout=''15s'';
SET LOCAL lock_timeout=''25ms'';
SET LOCAL application_name=''orders-projection-write-benchmark'';
CREATE TEMP TABLE projection_write_cohort ON COMMIT DROP AS
WITH groups AS MATERIALIZED (
 SELECT DISTINCT ON(owner_id,private.orders_dashboard_group_key(source_channel,order_number,id)) id,owner_id,
 private.orders_dashboard_group_key(source_channel,order_number,id) group_key
 FROM public.fulfillment_orders WHERE source_channel=''amazon'' AND pii_purged_at IS NULL AND order_action_lease IS NULL
 ORDER BY owner_id,private.orders_dashboard_group_key(source_channel,order_number,id),id
)
SELECT id,row_number() OVER(ORDER BY owner_id,group_key,id) rn FROM groups ORDER BY owner_id,group_key,id LIMIT 200;
CREATE TEMP TABLE projection_write_times(row_n bigint,ms double precision,ok boolean,error_code text) ON COMMIT DROP;
DO $bench$
DECLARE r record; started timestamptz; phase boolean; before_q bigint; after_q bigint; n integer:=0; failures_before bigint; errors integer:=0; receipt jsonb; wall_start timestamptz; wall_end timestamptz; cohort_hash text;
BEGIN
 SELECT maintenance_enabled INTO STRICT phase FROM private.orders_projection_control WHERE singleton;
 IF phase IS DISTINCT FROM false THEN RAISE EXCEPTION ''BENCHMARK_SWITCH_MISMATCH'';END IF;
 PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:53:03.000Z''::timestamptz-clock_timestamp())));
 SELECT count(*) INTO before_q FROM private.orders_projection_dirty;
 SELECT count(*) INTO failures_before FROM private.orders_projection_failures;
 wall_start:=clock_timestamp();
 SELECT md5(string_agg(id::text,'','' ORDER BY rn)) INTO cohort_hash FROM projection_write_cohort;
 IF (SELECT count(*) FROM projection_write_cohort)<>200 THEN RAISE EXCEPTION ''INCOMPLETE_COHORT'';END IF;
 FOR r IN SELECT id,rn FROM projection_write_cohort WHERE (rn-1)%2=0 ORDER BY rn LOOP
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
 SELECT jsonb_build_object(''cohort_hash'',cohort_hash,''maintenance_enabled'',phase,''lane'',0,''lanes'',2,''pid'',pg_backend_pid(),
  ''transaction_id'',pg_current_xact_id()::text,''wall_start'',wall_start,''wall_end'',wall_end,''successful_updates'',n,''lock_timeouts'',errors,''queued_delta'',after_q-before_q,
  ''failure_delta'',(SELECT count(*)-failures_before FROM private.orders_projection_failures),
  ''p50_ms'',percentile_cont(.5)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),''p95_ms'',percentile_cont(.95)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),
  ''max_ms'',max(ms)FILTER(WHERE ok),''paired_samples'',jsonb_agg(jsonb_build_object(''row'',row_n,''ms'',ms)ORDER BY row_n)FILTER(WHERE ok),''samples_ms'',jsonb_agg(ms ORDER BY ms)FILTER(WHERE ok)) INTO receipt FROM projection_write_times;
 IF n<>200/2 OR errors<>0 THEN RAISE EXCEPTION ''INCOMPLETE_OR_FAILED_UPDATES'';END IF;
 IF phase AND after_q-before_q<>2*n THEN RAISE EXCEPTION ''ENQUEUE_NOT_EXERCISED'';END IF;
 IF NOT phase AND after_q-before_q<>0 THEN RAISE EXCEPTION ''DISABLED_TRIGGER_ENQUEUED'';END IF;
 EXECUTE format(''PREPARE projection_benchmark_receipt AS INSERT INTO private.orders_projection_write_measurements(batch,lane,receipt,rollback_status) VALUES (''''write-0853-off-2'''',0,%L::jsonb,pg_xact_status(%L::xid8)) RETURNING rollback_status'',receipt::text,pg_current_xact_id()::text);
END $bench$;
ROLLBACK;
EXECUTE projection_benchmark_receipt;
');
SELECT cron.schedule('write-0853-off-2-1','53 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0853-off-2-1''); UPDATE private.orders_projection_control SET maintenance_enabled=false WHERE singleton; COMMIT;
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_prepared_statements WHERE name=''projection_benchmark_receipt'') THEN DEALLOCATE projection_benchmark_receipt;END IF;END$$;
SET LOCAL statement_timeout=''15s'';
SET LOCAL lock_timeout=''25ms'';
SET LOCAL application_name=''orders-projection-write-benchmark'';
CREATE TEMP TABLE projection_write_cohort ON COMMIT DROP AS
WITH groups AS MATERIALIZED (
 SELECT DISTINCT ON(owner_id,private.orders_dashboard_group_key(source_channel,order_number,id)) id,owner_id,
 private.orders_dashboard_group_key(source_channel,order_number,id) group_key
 FROM public.fulfillment_orders WHERE source_channel=''amazon'' AND pii_purged_at IS NULL AND order_action_lease IS NULL
 ORDER BY owner_id,private.orders_dashboard_group_key(source_channel,order_number,id),id
)
SELECT id,row_number() OVER(ORDER BY owner_id,group_key,id) rn FROM groups ORDER BY owner_id,group_key,id LIMIT 200;
CREATE TEMP TABLE projection_write_times(row_n bigint,ms double precision,ok boolean,error_code text) ON COMMIT DROP;
DO $bench$
DECLARE r record; started timestamptz; phase boolean; before_q bigint; after_q bigint; n integer:=0; failures_before bigint; errors integer:=0; receipt jsonb; wall_start timestamptz; wall_end timestamptz; cohort_hash text;
BEGIN
 SELECT maintenance_enabled INTO STRICT phase FROM private.orders_projection_control WHERE singleton;
 IF phase IS DISTINCT FROM false THEN RAISE EXCEPTION ''BENCHMARK_SWITCH_MISMATCH'';END IF;
 PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:53:03.000Z''::timestamptz-clock_timestamp())));
 SELECT count(*) INTO before_q FROM private.orders_projection_dirty;
 SELECT count(*) INTO failures_before FROM private.orders_projection_failures;
 wall_start:=clock_timestamp();
 SELECT md5(string_agg(id::text,'','' ORDER BY rn)) INTO cohort_hash FROM projection_write_cohort;
 IF (SELECT count(*) FROM projection_write_cohort)<>200 THEN RAISE EXCEPTION ''INCOMPLETE_COHORT'';END IF;
 FOR r IN SELECT id,rn FROM projection_write_cohort WHERE (rn-1)%2=1 ORDER BY rn LOOP
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
 SELECT jsonb_build_object(''cohort_hash'',cohort_hash,''maintenance_enabled'',phase,''lane'',1,''lanes'',2,''pid'',pg_backend_pid(),
  ''transaction_id'',pg_current_xact_id()::text,''wall_start'',wall_start,''wall_end'',wall_end,''successful_updates'',n,''lock_timeouts'',errors,''queued_delta'',after_q-before_q,
  ''failure_delta'',(SELECT count(*)-failures_before FROM private.orders_projection_failures),
  ''p50_ms'',percentile_cont(.5)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),''p95_ms'',percentile_cont(.95)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),
  ''max_ms'',max(ms)FILTER(WHERE ok),''paired_samples'',jsonb_agg(jsonb_build_object(''row'',row_n,''ms'',ms)ORDER BY row_n)FILTER(WHERE ok),''samples_ms'',jsonb_agg(ms ORDER BY ms)FILTER(WHERE ok)) INTO receipt FROM projection_write_times;
 IF n<>200/2 OR errors<>0 THEN RAISE EXCEPTION ''INCOMPLETE_OR_FAILED_UPDATES'';END IF;
 IF phase AND after_q-before_q<>2*n THEN RAISE EXCEPTION ''ENQUEUE_NOT_EXERCISED'';END IF;
 IF NOT phase AND after_q-before_q<>0 THEN RAISE EXCEPTION ''DISABLED_TRIGGER_ENQUEUED'';END IF;
 EXECUTE format(''PREPARE projection_benchmark_receipt AS INSERT INTO private.orders_projection_write_measurements(batch,lane,receipt,rollback_status) VALUES (''''write-0853-off-2'''',1,%L::jsonb,pg_xact_status(%L::xid8)) RETURNING rollback_status'',receipt::text,pg_current_xact_id()::text);
END $bench$;
ROLLBACK;
EXECUTE projection_benchmark_receipt;
');
SELECT cron.schedule('write-0853-off-2-watch','53 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0853-off-2-watch'');COMMIT; SET application_name=''projection-lock-watch''; DO $watch$ DECLARE n int; w int; mx int:=0; waits int:=0; overlap int:=0; advisory int:=0; samples int:=0; started timestamptz; BEGIN PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:53:03.000Z''::timestamptz-clock_timestamp())-.05));started:=clock_timestamp();FOR i IN 1..300 LOOP PERFORM pg_stat_clear_snapshot(); SELECT count(*),count(*) FILTER(WHERE wait_event_type=''Lock'') INTO n,w FROM pg_stat_activity WHERE application_name=''orders-projection-write-benchmark'' AND state=''active'';mx:=greatest(mx,n);waits:=waits+w;IF n>=2 THEN overlap:=overlap+1;END IF;SELECT count(*) INTO w FROM pg_locks l JOIN pg_stat_activity a USING(pid) WHERE a.application_name=''orders-projection-write-benchmark'' AND NOT l.granted AND l.locktype=''advisory'';advisory:=advisory+w;samples:=samples+1;PERFORM pg_sleep(.01);END LOOP;UPDATE private.orders_projection_control SET maintenance_enabled=true WHERE singleton;INSERT INTO private.orders_projection_write_measurements VALUES(''write-0853-off-2'',-1,jsonb_build_object(''max_active_sessions'',mx,''overlap_samples'',overlap,''lock_wait_samples'',waits,''advisory_wait_samples'',advisory,''samples'',samples,''started'',started,''restored_at'',clock_timestamp()),''observer'',clock_timestamp());END $watch$;');
SELECT cron.schedule('write-0854-on-1-0','54 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0854-on-1-0''); UPDATE private.orders_projection_control SET maintenance_enabled=true WHERE singleton; COMMIT;
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_prepared_statements WHERE name=''projection_benchmark_receipt'') THEN DEALLOCATE projection_benchmark_receipt;END IF;END$$;
SET LOCAL statement_timeout=''15s'';
SET LOCAL lock_timeout=''25ms'';
SET LOCAL application_name=''orders-projection-write-benchmark'';
CREATE TEMP TABLE projection_write_cohort ON COMMIT DROP AS
WITH groups AS MATERIALIZED (
 SELECT DISTINCT ON(owner_id,private.orders_dashboard_group_key(source_channel,order_number,id)) id,owner_id,
 private.orders_dashboard_group_key(source_channel,order_number,id) group_key
 FROM public.fulfillment_orders WHERE source_channel=''amazon'' AND pii_purged_at IS NULL AND order_action_lease IS NULL
 ORDER BY owner_id,private.orders_dashboard_group_key(source_channel,order_number,id),id
)
SELECT id,row_number() OVER(ORDER BY owner_id,group_key,id) rn FROM groups ORDER BY owner_id,group_key,id LIMIT 200;
CREATE TEMP TABLE projection_write_times(row_n bigint,ms double precision,ok boolean,error_code text) ON COMMIT DROP;
DO $bench$
DECLARE r record; started timestamptz; phase boolean; before_q bigint; after_q bigint; n integer:=0; failures_before bigint; errors integer:=0; receipt jsonb; wall_start timestamptz; wall_end timestamptz; cohort_hash text;
BEGIN
 SELECT maintenance_enabled INTO STRICT phase FROM private.orders_projection_control WHERE singleton;
 IF phase IS DISTINCT FROM true THEN RAISE EXCEPTION ''BENCHMARK_SWITCH_MISMATCH'';END IF;
 PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:54:03.000Z''::timestamptz-clock_timestamp())));
 SELECT count(*) INTO before_q FROM private.orders_projection_dirty;
 SELECT count(*) INTO failures_before FROM private.orders_projection_failures;
 wall_start:=clock_timestamp();
 SELECT md5(string_agg(id::text,'','' ORDER BY rn)) INTO cohort_hash FROM projection_write_cohort;
 IF (SELECT count(*) FROM projection_write_cohort)<>200 THEN RAISE EXCEPTION ''INCOMPLETE_COHORT'';END IF;
 FOR r IN SELECT id,rn FROM projection_write_cohort WHERE (rn-1)%1=0 ORDER BY rn LOOP
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
 SELECT jsonb_build_object(''cohort_hash'',cohort_hash,''maintenance_enabled'',phase,''lane'',0,''lanes'',1,''pid'',pg_backend_pid(),
  ''transaction_id'',pg_current_xact_id()::text,''wall_start'',wall_start,''wall_end'',wall_end,''successful_updates'',n,''lock_timeouts'',errors,''queued_delta'',after_q-before_q,
  ''failure_delta'',(SELECT count(*)-failures_before FROM private.orders_projection_failures),
  ''p50_ms'',percentile_cont(.5)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),''p95_ms'',percentile_cont(.95)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),
  ''max_ms'',max(ms)FILTER(WHERE ok),''paired_samples'',jsonb_agg(jsonb_build_object(''row'',row_n,''ms'',ms)ORDER BY row_n)FILTER(WHERE ok),''samples_ms'',jsonb_agg(ms ORDER BY ms)FILTER(WHERE ok)) INTO receipt FROM projection_write_times;
 IF n<>200/1 OR errors<>0 THEN RAISE EXCEPTION ''INCOMPLETE_OR_FAILED_UPDATES'';END IF;
 IF phase AND after_q-before_q<>2*n THEN RAISE EXCEPTION ''ENQUEUE_NOT_EXERCISED'';END IF;
 IF NOT phase AND after_q-before_q<>0 THEN RAISE EXCEPTION ''DISABLED_TRIGGER_ENQUEUED'';END IF;
 EXECUTE format(''PREPARE projection_benchmark_receipt AS INSERT INTO private.orders_projection_write_measurements(batch,lane,receipt,rollback_status) VALUES (''''write-0854-on-1'''',0,%L::jsonb,pg_xact_status(%L::xid8)) RETURNING rollback_status'',receipt::text,pg_current_xact_id()::text);
END $bench$;
ROLLBACK;
EXECUTE projection_benchmark_receipt;
');
SELECT cron.schedule('write-0854-on-1-watch','54 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0854-on-1-watch'');COMMIT; SET application_name=''projection-lock-watch''; DO $watch$ DECLARE n int; w int; mx int:=0; waits int:=0; overlap int:=0; advisory int:=0; samples int:=0; started timestamptz; BEGIN PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:54:03.000Z''::timestamptz-clock_timestamp())-.05));started:=clock_timestamp();FOR i IN 1..300 LOOP PERFORM pg_stat_clear_snapshot(); SELECT count(*),count(*) FILTER(WHERE wait_event_type=''Lock'') INTO n,w FROM pg_stat_activity WHERE application_name=''orders-projection-write-benchmark'' AND state=''active'';mx:=greatest(mx,n);waits:=waits+w;IF n>=2 THEN overlap:=overlap+1;END IF;SELECT count(*) INTO w FROM pg_locks l JOIN pg_stat_activity a USING(pid) WHERE a.application_name=''orders-projection-write-benchmark'' AND NOT l.granted AND l.locktype=''advisory'';advisory:=advisory+w;samples:=samples+1;PERFORM pg_sleep(.01);END LOOP;UPDATE private.orders_projection_control SET maintenance_enabled=true WHERE singleton;INSERT INTO private.orders_projection_write_measurements VALUES(''write-0854-on-1'',-1,jsonb_build_object(''max_active_sessions'',mx,''overlap_samples'',overlap,''lock_wait_samples'',waits,''advisory_wait_samples'',advisory,''samples'',samples,''started'',started,''restored_at'',clock_timestamp()),''observer'',clock_timestamp());END $watch$;');
SELECT cron.schedule('write-0855-off-1-0','55 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0855-off-1-0''); UPDATE private.orders_projection_control SET maintenance_enabled=false WHERE singleton; COMMIT;
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_prepared_statements WHERE name=''projection_benchmark_receipt'') THEN DEALLOCATE projection_benchmark_receipt;END IF;END$$;
SET LOCAL statement_timeout=''15s'';
SET LOCAL lock_timeout=''25ms'';
SET LOCAL application_name=''orders-projection-write-benchmark'';
CREATE TEMP TABLE projection_write_cohort ON COMMIT DROP AS
WITH groups AS MATERIALIZED (
 SELECT DISTINCT ON(owner_id,private.orders_dashboard_group_key(source_channel,order_number,id)) id,owner_id,
 private.orders_dashboard_group_key(source_channel,order_number,id) group_key
 FROM public.fulfillment_orders WHERE source_channel=''amazon'' AND pii_purged_at IS NULL AND order_action_lease IS NULL
 ORDER BY owner_id,private.orders_dashboard_group_key(source_channel,order_number,id),id
)
SELECT id,row_number() OVER(ORDER BY owner_id,group_key,id) rn FROM groups ORDER BY owner_id,group_key,id LIMIT 200;
CREATE TEMP TABLE projection_write_times(row_n bigint,ms double precision,ok boolean,error_code text) ON COMMIT DROP;
DO $bench$
DECLARE r record; started timestamptz; phase boolean; before_q bigint; after_q bigint; n integer:=0; failures_before bigint; errors integer:=0; receipt jsonb; wall_start timestamptz; wall_end timestamptz; cohort_hash text;
BEGIN
 SELECT maintenance_enabled INTO STRICT phase FROM private.orders_projection_control WHERE singleton;
 IF phase IS DISTINCT FROM false THEN RAISE EXCEPTION ''BENCHMARK_SWITCH_MISMATCH'';END IF;
 PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:55:03.000Z''::timestamptz-clock_timestamp())));
 SELECT count(*) INTO before_q FROM private.orders_projection_dirty;
 SELECT count(*) INTO failures_before FROM private.orders_projection_failures;
 wall_start:=clock_timestamp();
 SELECT md5(string_agg(id::text,'','' ORDER BY rn)) INTO cohort_hash FROM projection_write_cohort;
 IF (SELECT count(*) FROM projection_write_cohort)<>200 THEN RAISE EXCEPTION ''INCOMPLETE_COHORT'';END IF;
 FOR r IN SELECT id,rn FROM projection_write_cohort WHERE (rn-1)%1=0 ORDER BY rn LOOP
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
 SELECT jsonb_build_object(''cohort_hash'',cohort_hash,''maintenance_enabled'',phase,''lane'',0,''lanes'',1,''pid'',pg_backend_pid(),
  ''transaction_id'',pg_current_xact_id()::text,''wall_start'',wall_start,''wall_end'',wall_end,''successful_updates'',n,''lock_timeouts'',errors,''queued_delta'',after_q-before_q,
  ''failure_delta'',(SELECT count(*)-failures_before FROM private.orders_projection_failures),
  ''p50_ms'',percentile_cont(.5)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),''p95_ms'',percentile_cont(.95)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),
  ''max_ms'',max(ms)FILTER(WHERE ok),''paired_samples'',jsonb_agg(jsonb_build_object(''row'',row_n,''ms'',ms)ORDER BY row_n)FILTER(WHERE ok),''samples_ms'',jsonb_agg(ms ORDER BY ms)FILTER(WHERE ok)) INTO receipt FROM projection_write_times;
 IF n<>200/1 OR errors<>0 THEN RAISE EXCEPTION ''INCOMPLETE_OR_FAILED_UPDATES'';END IF;
 IF phase AND after_q-before_q<>2*n THEN RAISE EXCEPTION ''ENQUEUE_NOT_EXERCISED'';END IF;
 IF NOT phase AND after_q-before_q<>0 THEN RAISE EXCEPTION ''DISABLED_TRIGGER_ENQUEUED'';END IF;
 EXECUTE format(''PREPARE projection_benchmark_receipt AS INSERT INTO private.orders_projection_write_measurements(batch,lane,receipt,rollback_status) VALUES (''''write-0855-off-1'''',0,%L::jsonb,pg_xact_status(%L::xid8)) RETURNING rollback_status'',receipt::text,pg_current_xact_id()::text);
END $bench$;
ROLLBACK;
EXECUTE projection_benchmark_receipt;
');
SELECT cron.schedule('write-0855-off-1-watch','55 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0855-off-1-watch'');COMMIT; SET application_name=''projection-lock-watch''; DO $watch$ DECLARE n int; w int; mx int:=0; waits int:=0; overlap int:=0; advisory int:=0; samples int:=0; started timestamptz; BEGIN PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:55:03.000Z''::timestamptz-clock_timestamp())-.05));started:=clock_timestamp();FOR i IN 1..300 LOOP PERFORM pg_stat_clear_snapshot(); SELECT count(*),count(*) FILTER(WHERE wait_event_type=''Lock'') INTO n,w FROM pg_stat_activity WHERE application_name=''orders-projection-write-benchmark'' AND state=''active'';mx:=greatest(mx,n);waits:=waits+w;IF n>=2 THEN overlap:=overlap+1;END IF;SELECT count(*) INTO w FROM pg_locks l JOIN pg_stat_activity a USING(pid) WHERE a.application_name=''orders-projection-write-benchmark'' AND NOT l.granted AND l.locktype=''advisory'';advisory:=advisory+w;samples:=samples+1;PERFORM pg_sleep(.01);END LOOP;UPDATE private.orders_projection_control SET maintenance_enabled=true WHERE singleton;INSERT INTO private.orders_projection_write_measurements VALUES(''write-0855-off-1'',-1,jsonb_build_object(''max_active_sessions'',mx,''overlap_samples'',overlap,''lock_wait_samples'',waits,''advisory_wait_samples'',advisory,''samples'',samples,''started'',started,''restored_at'',clock_timestamp()),''observer'',clock_timestamp());END $watch$;');
SELECT cron.schedule('write-0856-on-4-0','56 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0856-on-4-0''); UPDATE private.orders_projection_control SET maintenance_enabled=true WHERE singleton; COMMIT;
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_prepared_statements WHERE name=''projection_benchmark_receipt'') THEN DEALLOCATE projection_benchmark_receipt;END IF;END$$;
SET LOCAL statement_timeout=''15s'';
SET LOCAL lock_timeout=''25ms'';
SET LOCAL application_name=''orders-projection-write-benchmark'';
CREATE TEMP TABLE projection_write_cohort ON COMMIT DROP AS
WITH groups AS MATERIALIZED (
 SELECT DISTINCT ON(owner_id,private.orders_dashboard_group_key(source_channel,order_number,id)) id,owner_id,
 private.orders_dashboard_group_key(source_channel,order_number,id) group_key
 FROM public.fulfillment_orders WHERE source_channel=''amazon'' AND pii_purged_at IS NULL AND order_action_lease IS NULL
 ORDER BY owner_id,private.orders_dashboard_group_key(source_channel,order_number,id),id
)
SELECT id,row_number() OVER(ORDER BY owner_id,group_key,id) rn FROM groups ORDER BY owner_id,group_key,id LIMIT 200;
CREATE TEMP TABLE projection_write_times(row_n bigint,ms double precision,ok boolean,error_code text) ON COMMIT DROP;
DO $bench$
DECLARE r record; started timestamptz; phase boolean; before_q bigint; after_q bigint; n integer:=0; failures_before bigint; errors integer:=0; receipt jsonb; wall_start timestamptz; wall_end timestamptz; cohort_hash text;
BEGIN
 SELECT maintenance_enabled INTO STRICT phase FROM private.orders_projection_control WHERE singleton;
 IF phase IS DISTINCT FROM true THEN RAISE EXCEPTION ''BENCHMARK_SWITCH_MISMATCH'';END IF;
 PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:56:03.000Z''::timestamptz-clock_timestamp())));
 SELECT count(*) INTO before_q FROM private.orders_projection_dirty;
 SELECT count(*) INTO failures_before FROM private.orders_projection_failures;
 wall_start:=clock_timestamp();
 SELECT md5(string_agg(id::text,'','' ORDER BY rn)) INTO cohort_hash FROM projection_write_cohort;
 IF (SELECT count(*) FROM projection_write_cohort)<>200 THEN RAISE EXCEPTION ''INCOMPLETE_COHORT'';END IF;
 FOR r IN SELECT id,rn FROM projection_write_cohort WHERE (rn-1)%4=0 ORDER BY rn LOOP
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
 SELECT jsonb_build_object(''cohort_hash'',cohort_hash,''maintenance_enabled'',phase,''lane'',0,''lanes'',4,''pid'',pg_backend_pid(),
  ''transaction_id'',pg_current_xact_id()::text,''wall_start'',wall_start,''wall_end'',wall_end,''successful_updates'',n,''lock_timeouts'',errors,''queued_delta'',after_q-before_q,
  ''failure_delta'',(SELECT count(*)-failures_before FROM private.orders_projection_failures),
  ''p50_ms'',percentile_cont(.5)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),''p95_ms'',percentile_cont(.95)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),
  ''max_ms'',max(ms)FILTER(WHERE ok),''paired_samples'',jsonb_agg(jsonb_build_object(''row'',row_n,''ms'',ms)ORDER BY row_n)FILTER(WHERE ok),''samples_ms'',jsonb_agg(ms ORDER BY ms)FILTER(WHERE ok)) INTO receipt FROM projection_write_times;
 IF n<>200/4 OR errors<>0 THEN RAISE EXCEPTION ''INCOMPLETE_OR_FAILED_UPDATES'';END IF;
 IF phase AND after_q-before_q<>2*n THEN RAISE EXCEPTION ''ENQUEUE_NOT_EXERCISED'';END IF;
 IF NOT phase AND after_q-before_q<>0 THEN RAISE EXCEPTION ''DISABLED_TRIGGER_ENQUEUED'';END IF;
 EXECUTE format(''PREPARE projection_benchmark_receipt AS INSERT INTO private.orders_projection_write_measurements(batch,lane,receipt,rollback_status) VALUES (''''write-0856-on-4'''',0,%L::jsonb,pg_xact_status(%L::xid8)) RETURNING rollback_status'',receipt::text,pg_current_xact_id()::text);
END $bench$;
ROLLBACK;
EXECUTE projection_benchmark_receipt;
');
SELECT cron.schedule('write-0856-on-4-1','56 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0856-on-4-1''); UPDATE private.orders_projection_control SET maintenance_enabled=true WHERE singleton; COMMIT;
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_prepared_statements WHERE name=''projection_benchmark_receipt'') THEN DEALLOCATE projection_benchmark_receipt;END IF;END$$;
SET LOCAL statement_timeout=''15s'';
SET LOCAL lock_timeout=''25ms'';
SET LOCAL application_name=''orders-projection-write-benchmark'';
CREATE TEMP TABLE projection_write_cohort ON COMMIT DROP AS
WITH groups AS MATERIALIZED (
 SELECT DISTINCT ON(owner_id,private.orders_dashboard_group_key(source_channel,order_number,id)) id,owner_id,
 private.orders_dashboard_group_key(source_channel,order_number,id) group_key
 FROM public.fulfillment_orders WHERE source_channel=''amazon'' AND pii_purged_at IS NULL AND order_action_lease IS NULL
 ORDER BY owner_id,private.orders_dashboard_group_key(source_channel,order_number,id),id
)
SELECT id,row_number() OVER(ORDER BY owner_id,group_key,id) rn FROM groups ORDER BY owner_id,group_key,id LIMIT 200;
CREATE TEMP TABLE projection_write_times(row_n bigint,ms double precision,ok boolean,error_code text) ON COMMIT DROP;
DO $bench$
DECLARE r record; started timestamptz; phase boolean; before_q bigint; after_q bigint; n integer:=0; failures_before bigint; errors integer:=0; receipt jsonb; wall_start timestamptz; wall_end timestamptz; cohort_hash text;
BEGIN
 SELECT maintenance_enabled INTO STRICT phase FROM private.orders_projection_control WHERE singleton;
 IF phase IS DISTINCT FROM true THEN RAISE EXCEPTION ''BENCHMARK_SWITCH_MISMATCH'';END IF;
 PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:56:03.000Z''::timestamptz-clock_timestamp())));
 SELECT count(*) INTO before_q FROM private.orders_projection_dirty;
 SELECT count(*) INTO failures_before FROM private.orders_projection_failures;
 wall_start:=clock_timestamp();
 SELECT md5(string_agg(id::text,'','' ORDER BY rn)) INTO cohort_hash FROM projection_write_cohort;
 IF (SELECT count(*) FROM projection_write_cohort)<>200 THEN RAISE EXCEPTION ''INCOMPLETE_COHORT'';END IF;
 FOR r IN SELECT id,rn FROM projection_write_cohort WHERE (rn-1)%4=1 ORDER BY rn LOOP
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
 SELECT jsonb_build_object(''cohort_hash'',cohort_hash,''maintenance_enabled'',phase,''lane'',1,''lanes'',4,''pid'',pg_backend_pid(),
  ''transaction_id'',pg_current_xact_id()::text,''wall_start'',wall_start,''wall_end'',wall_end,''successful_updates'',n,''lock_timeouts'',errors,''queued_delta'',after_q-before_q,
  ''failure_delta'',(SELECT count(*)-failures_before FROM private.orders_projection_failures),
  ''p50_ms'',percentile_cont(.5)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),''p95_ms'',percentile_cont(.95)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),
  ''max_ms'',max(ms)FILTER(WHERE ok),''paired_samples'',jsonb_agg(jsonb_build_object(''row'',row_n,''ms'',ms)ORDER BY row_n)FILTER(WHERE ok),''samples_ms'',jsonb_agg(ms ORDER BY ms)FILTER(WHERE ok)) INTO receipt FROM projection_write_times;
 IF n<>200/4 OR errors<>0 THEN RAISE EXCEPTION ''INCOMPLETE_OR_FAILED_UPDATES'';END IF;
 IF phase AND after_q-before_q<>2*n THEN RAISE EXCEPTION ''ENQUEUE_NOT_EXERCISED'';END IF;
 IF NOT phase AND after_q-before_q<>0 THEN RAISE EXCEPTION ''DISABLED_TRIGGER_ENQUEUED'';END IF;
 EXECUTE format(''PREPARE projection_benchmark_receipt AS INSERT INTO private.orders_projection_write_measurements(batch,lane,receipt,rollback_status) VALUES (''''write-0856-on-4'''',1,%L::jsonb,pg_xact_status(%L::xid8)) RETURNING rollback_status'',receipt::text,pg_current_xact_id()::text);
END $bench$;
ROLLBACK;
EXECUTE projection_benchmark_receipt;
');
SELECT cron.schedule('write-0856-on-4-2','56 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0856-on-4-2''); UPDATE private.orders_projection_control SET maintenance_enabled=true WHERE singleton; COMMIT;
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_prepared_statements WHERE name=''projection_benchmark_receipt'') THEN DEALLOCATE projection_benchmark_receipt;END IF;END$$;
SET LOCAL statement_timeout=''15s'';
SET LOCAL lock_timeout=''25ms'';
SET LOCAL application_name=''orders-projection-write-benchmark'';
CREATE TEMP TABLE projection_write_cohort ON COMMIT DROP AS
WITH groups AS MATERIALIZED (
 SELECT DISTINCT ON(owner_id,private.orders_dashboard_group_key(source_channel,order_number,id)) id,owner_id,
 private.orders_dashboard_group_key(source_channel,order_number,id) group_key
 FROM public.fulfillment_orders WHERE source_channel=''amazon'' AND pii_purged_at IS NULL AND order_action_lease IS NULL
 ORDER BY owner_id,private.orders_dashboard_group_key(source_channel,order_number,id),id
)
SELECT id,row_number() OVER(ORDER BY owner_id,group_key,id) rn FROM groups ORDER BY owner_id,group_key,id LIMIT 200;
CREATE TEMP TABLE projection_write_times(row_n bigint,ms double precision,ok boolean,error_code text) ON COMMIT DROP;
DO $bench$
DECLARE r record; started timestamptz; phase boolean; before_q bigint; after_q bigint; n integer:=0; failures_before bigint; errors integer:=0; receipt jsonb; wall_start timestamptz; wall_end timestamptz; cohort_hash text;
BEGIN
 SELECT maintenance_enabled INTO STRICT phase FROM private.orders_projection_control WHERE singleton;
 IF phase IS DISTINCT FROM true THEN RAISE EXCEPTION ''BENCHMARK_SWITCH_MISMATCH'';END IF;
 PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:56:03.000Z''::timestamptz-clock_timestamp())));
 SELECT count(*) INTO before_q FROM private.orders_projection_dirty;
 SELECT count(*) INTO failures_before FROM private.orders_projection_failures;
 wall_start:=clock_timestamp();
 SELECT md5(string_agg(id::text,'','' ORDER BY rn)) INTO cohort_hash FROM projection_write_cohort;
 IF (SELECT count(*) FROM projection_write_cohort)<>200 THEN RAISE EXCEPTION ''INCOMPLETE_COHORT'';END IF;
 FOR r IN SELECT id,rn FROM projection_write_cohort WHERE (rn-1)%4=2 ORDER BY rn LOOP
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
 SELECT jsonb_build_object(''cohort_hash'',cohort_hash,''maintenance_enabled'',phase,''lane'',2,''lanes'',4,''pid'',pg_backend_pid(),
  ''transaction_id'',pg_current_xact_id()::text,''wall_start'',wall_start,''wall_end'',wall_end,''successful_updates'',n,''lock_timeouts'',errors,''queued_delta'',after_q-before_q,
  ''failure_delta'',(SELECT count(*)-failures_before FROM private.orders_projection_failures),
  ''p50_ms'',percentile_cont(.5)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),''p95_ms'',percentile_cont(.95)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),
  ''max_ms'',max(ms)FILTER(WHERE ok),''paired_samples'',jsonb_agg(jsonb_build_object(''row'',row_n,''ms'',ms)ORDER BY row_n)FILTER(WHERE ok),''samples_ms'',jsonb_agg(ms ORDER BY ms)FILTER(WHERE ok)) INTO receipt FROM projection_write_times;
 IF n<>200/4 OR errors<>0 THEN RAISE EXCEPTION ''INCOMPLETE_OR_FAILED_UPDATES'';END IF;
 IF phase AND after_q-before_q<>2*n THEN RAISE EXCEPTION ''ENQUEUE_NOT_EXERCISED'';END IF;
 IF NOT phase AND after_q-before_q<>0 THEN RAISE EXCEPTION ''DISABLED_TRIGGER_ENQUEUED'';END IF;
 EXECUTE format(''PREPARE projection_benchmark_receipt AS INSERT INTO private.orders_projection_write_measurements(batch,lane,receipt,rollback_status) VALUES (''''write-0856-on-4'''',2,%L::jsonb,pg_xact_status(%L::xid8)) RETURNING rollback_status'',receipt::text,pg_current_xact_id()::text);
END $bench$;
ROLLBACK;
EXECUTE projection_benchmark_receipt;
');
SELECT cron.schedule('write-0856-on-4-3','56 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0856-on-4-3''); UPDATE private.orders_projection_control SET maintenance_enabled=true WHERE singleton; COMMIT;
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_prepared_statements WHERE name=''projection_benchmark_receipt'') THEN DEALLOCATE projection_benchmark_receipt;END IF;END$$;
SET LOCAL statement_timeout=''15s'';
SET LOCAL lock_timeout=''25ms'';
SET LOCAL application_name=''orders-projection-write-benchmark'';
CREATE TEMP TABLE projection_write_cohort ON COMMIT DROP AS
WITH groups AS MATERIALIZED (
 SELECT DISTINCT ON(owner_id,private.orders_dashboard_group_key(source_channel,order_number,id)) id,owner_id,
 private.orders_dashboard_group_key(source_channel,order_number,id) group_key
 FROM public.fulfillment_orders WHERE source_channel=''amazon'' AND pii_purged_at IS NULL AND order_action_lease IS NULL
 ORDER BY owner_id,private.orders_dashboard_group_key(source_channel,order_number,id),id
)
SELECT id,row_number() OVER(ORDER BY owner_id,group_key,id) rn FROM groups ORDER BY owner_id,group_key,id LIMIT 200;
CREATE TEMP TABLE projection_write_times(row_n bigint,ms double precision,ok boolean,error_code text) ON COMMIT DROP;
DO $bench$
DECLARE r record; started timestamptz; phase boolean; before_q bigint; after_q bigint; n integer:=0; failures_before bigint; errors integer:=0; receipt jsonb; wall_start timestamptz; wall_end timestamptz; cohort_hash text;
BEGIN
 SELECT maintenance_enabled INTO STRICT phase FROM private.orders_projection_control WHERE singleton;
 IF phase IS DISTINCT FROM true THEN RAISE EXCEPTION ''BENCHMARK_SWITCH_MISMATCH'';END IF;
 PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:56:03.000Z''::timestamptz-clock_timestamp())));
 SELECT count(*) INTO before_q FROM private.orders_projection_dirty;
 SELECT count(*) INTO failures_before FROM private.orders_projection_failures;
 wall_start:=clock_timestamp();
 SELECT md5(string_agg(id::text,'','' ORDER BY rn)) INTO cohort_hash FROM projection_write_cohort;
 IF (SELECT count(*) FROM projection_write_cohort)<>200 THEN RAISE EXCEPTION ''INCOMPLETE_COHORT'';END IF;
 FOR r IN SELECT id,rn FROM projection_write_cohort WHERE (rn-1)%4=3 ORDER BY rn LOOP
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
 SELECT jsonb_build_object(''cohort_hash'',cohort_hash,''maintenance_enabled'',phase,''lane'',3,''lanes'',4,''pid'',pg_backend_pid(),
  ''transaction_id'',pg_current_xact_id()::text,''wall_start'',wall_start,''wall_end'',wall_end,''successful_updates'',n,''lock_timeouts'',errors,''queued_delta'',after_q-before_q,
  ''failure_delta'',(SELECT count(*)-failures_before FROM private.orders_projection_failures),
  ''p50_ms'',percentile_cont(.5)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),''p95_ms'',percentile_cont(.95)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),
  ''max_ms'',max(ms)FILTER(WHERE ok),''paired_samples'',jsonb_agg(jsonb_build_object(''row'',row_n,''ms'',ms)ORDER BY row_n)FILTER(WHERE ok),''samples_ms'',jsonb_agg(ms ORDER BY ms)FILTER(WHERE ok)) INTO receipt FROM projection_write_times;
 IF n<>200/4 OR errors<>0 THEN RAISE EXCEPTION ''INCOMPLETE_OR_FAILED_UPDATES'';END IF;
 IF phase AND after_q-before_q<>2*n THEN RAISE EXCEPTION ''ENQUEUE_NOT_EXERCISED'';END IF;
 IF NOT phase AND after_q-before_q<>0 THEN RAISE EXCEPTION ''DISABLED_TRIGGER_ENQUEUED'';END IF;
 EXECUTE format(''PREPARE projection_benchmark_receipt AS INSERT INTO private.orders_projection_write_measurements(batch,lane,receipt,rollback_status) VALUES (''''write-0856-on-4'''',3,%L::jsonb,pg_xact_status(%L::xid8)) RETURNING rollback_status'',receipt::text,pg_current_xact_id()::text);
END $bench$;
ROLLBACK;
EXECUTE projection_benchmark_receipt;
');
SELECT cron.schedule('write-0856-on-4-watch','56 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0856-on-4-watch'');COMMIT; SET application_name=''projection-lock-watch''; DO $watch$ DECLARE n int; w int; mx int:=0; waits int:=0; overlap int:=0; advisory int:=0; samples int:=0; started timestamptz; BEGIN PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:56:03.000Z''::timestamptz-clock_timestamp())-.05));started:=clock_timestamp();FOR i IN 1..300 LOOP PERFORM pg_stat_clear_snapshot(); SELECT count(*),count(*) FILTER(WHERE wait_event_type=''Lock'') INTO n,w FROM pg_stat_activity WHERE application_name=''orders-projection-write-benchmark'' AND state=''active'';mx:=greatest(mx,n);waits:=waits+w;IF n>=2 THEN overlap:=overlap+1;END IF;SELECT count(*) INTO w FROM pg_locks l JOIN pg_stat_activity a USING(pid) WHERE a.application_name=''orders-projection-write-benchmark'' AND NOT l.granted AND l.locktype=''advisory'';advisory:=advisory+w;samples:=samples+1;PERFORM pg_sleep(.01);END LOOP;UPDATE private.orders_projection_control SET maintenance_enabled=true WHERE singleton;INSERT INTO private.orders_projection_write_measurements VALUES(''write-0856-on-4'',-1,jsonb_build_object(''max_active_sessions'',mx,''overlap_samples'',overlap,''lock_wait_samples'',waits,''advisory_wait_samples'',advisory,''samples'',samples,''started'',started,''restored_at'',clock_timestamp()),''observer'',clock_timestamp());END $watch$;');
SELECT cron.schedule('write-0857-off-4-0','57 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0857-off-4-0''); UPDATE private.orders_projection_control SET maintenance_enabled=false WHERE singleton; COMMIT;
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_prepared_statements WHERE name=''projection_benchmark_receipt'') THEN DEALLOCATE projection_benchmark_receipt;END IF;END$$;
SET LOCAL statement_timeout=''15s'';
SET LOCAL lock_timeout=''25ms'';
SET LOCAL application_name=''orders-projection-write-benchmark'';
CREATE TEMP TABLE projection_write_cohort ON COMMIT DROP AS
WITH groups AS MATERIALIZED (
 SELECT DISTINCT ON(owner_id,private.orders_dashboard_group_key(source_channel,order_number,id)) id,owner_id,
 private.orders_dashboard_group_key(source_channel,order_number,id) group_key
 FROM public.fulfillment_orders WHERE source_channel=''amazon'' AND pii_purged_at IS NULL AND order_action_lease IS NULL
 ORDER BY owner_id,private.orders_dashboard_group_key(source_channel,order_number,id),id
)
SELECT id,row_number() OVER(ORDER BY owner_id,group_key,id) rn FROM groups ORDER BY owner_id,group_key,id LIMIT 200;
CREATE TEMP TABLE projection_write_times(row_n bigint,ms double precision,ok boolean,error_code text) ON COMMIT DROP;
DO $bench$
DECLARE r record; started timestamptz; phase boolean; before_q bigint; after_q bigint; n integer:=0; failures_before bigint; errors integer:=0; receipt jsonb; wall_start timestamptz; wall_end timestamptz; cohort_hash text;
BEGIN
 SELECT maintenance_enabled INTO STRICT phase FROM private.orders_projection_control WHERE singleton;
 IF phase IS DISTINCT FROM false THEN RAISE EXCEPTION ''BENCHMARK_SWITCH_MISMATCH'';END IF;
 PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:57:03.000Z''::timestamptz-clock_timestamp())));
 SELECT count(*) INTO before_q FROM private.orders_projection_dirty;
 SELECT count(*) INTO failures_before FROM private.orders_projection_failures;
 wall_start:=clock_timestamp();
 SELECT md5(string_agg(id::text,'','' ORDER BY rn)) INTO cohort_hash FROM projection_write_cohort;
 IF (SELECT count(*) FROM projection_write_cohort)<>200 THEN RAISE EXCEPTION ''INCOMPLETE_COHORT'';END IF;
 FOR r IN SELECT id,rn FROM projection_write_cohort WHERE (rn-1)%4=0 ORDER BY rn LOOP
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
 SELECT jsonb_build_object(''cohort_hash'',cohort_hash,''maintenance_enabled'',phase,''lane'',0,''lanes'',4,''pid'',pg_backend_pid(),
  ''transaction_id'',pg_current_xact_id()::text,''wall_start'',wall_start,''wall_end'',wall_end,''successful_updates'',n,''lock_timeouts'',errors,''queued_delta'',after_q-before_q,
  ''failure_delta'',(SELECT count(*)-failures_before FROM private.orders_projection_failures),
  ''p50_ms'',percentile_cont(.5)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),''p95_ms'',percentile_cont(.95)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),
  ''max_ms'',max(ms)FILTER(WHERE ok),''paired_samples'',jsonb_agg(jsonb_build_object(''row'',row_n,''ms'',ms)ORDER BY row_n)FILTER(WHERE ok),''samples_ms'',jsonb_agg(ms ORDER BY ms)FILTER(WHERE ok)) INTO receipt FROM projection_write_times;
 IF n<>200/4 OR errors<>0 THEN RAISE EXCEPTION ''INCOMPLETE_OR_FAILED_UPDATES'';END IF;
 IF phase AND after_q-before_q<>2*n THEN RAISE EXCEPTION ''ENQUEUE_NOT_EXERCISED'';END IF;
 IF NOT phase AND after_q-before_q<>0 THEN RAISE EXCEPTION ''DISABLED_TRIGGER_ENQUEUED'';END IF;
 EXECUTE format(''PREPARE projection_benchmark_receipt AS INSERT INTO private.orders_projection_write_measurements(batch,lane,receipt,rollback_status) VALUES (''''write-0857-off-4'''',0,%L::jsonb,pg_xact_status(%L::xid8)) RETURNING rollback_status'',receipt::text,pg_current_xact_id()::text);
END $bench$;
ROLLBACK;
EXECUTE projection_benchmark_receipt;
');
SELECT cron.schedule('write-0857-off-4-1','57 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0857-off-4-1''); UPDATE private.orders_projection_control SET maintenance_enabled=false WHERE singleton; COMMIT;
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_prepared_statements WHERE name=''projection_benchmark_receipt'') THEN DEALLOCATE projection_benchmark_receipt;END IF;END$$;
SET LOCAL statement_timeout=''15s'';
SET LOCAL lock_timeout=''25ms'';
SET LOCAL application_name=''orders-projection-write-benchmark'';
CREATE TEMP TABLE projection_write_cohort ON COMMIT DROP AS
WITH groups AS MATERIALIZED (
 SELECT DISTINCT ON(owner_id,private.orders_dashboard_group_key(source_channel,order_number,id)) id,owner_id,
 private.orders_dashboard_group_key(source_channel,order_number,id) group_key
 FROM public.fulfillment_orders WHERE source_channel=''amazon'' AND pii_purged_at IS NULL AND order_action_lease IS NULL
 ORDER BY owner_id,private.orders_dashboard_group_key(source_channel,order_number,id),id
)
SELECT id,row_number() OVER(ORDER BY owner_id,group_key,id) rn FROM groups ORDER BY owner_id,group_key,id LIMIT 200;
CREATE TEMP TABLE projection_write_times(row_n bigint,ms double precision,ok boolean,error_code text) ON COMMIT DROP;
DO $bench$
DECLARE r record; started timestamptz; phase boolean; before_q bigint; after_q bigint; n integer:=0; failures_before bigint; errors integer:=0; receipt jsonb; wall_start timestamptz; wall_end timestamptz; cohort_hash text;
BEGIN
 SELECT maintenance_enabled INTO STRICT phase FROM private.orders_projection_control WHERE singleton;
 IF phase IS DISTINCT FROM false THEN RAISE EXCEPTION ''BENCHMARK_SWITCH_MISMATCH'';END IF;
 PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:57:03.000Z''::timestamptz-clock_timestamp())));
 SELECT count(*) INTO before_q FROM private.orders_projection_dirty;
 SELECT count(*) INTO failures_before FROM private.orders_projection_failures;
 wall_start:=clock_timestamp();
 SELECT md5(string_agg(id::text,'','' ORDER BY rn)) INTO cohort_hash FROM projection_write_cohort;
 IF (SELECT count(*) FROM projection_write_cohort)<>200 THEN RAISE EXCEPTION ''INCOMPLETE_COHORT'';END IF;
 FOR r IN SELECT id,rn FROM projection_write_cohort WHERE (rn-1)%4=1 ORDER BY rn LOOP
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
 SELECT jsonb_build_object(''cohort_hash'',cohort_hash,''maintenance_enabled'',phase,''lane'',1,''lanes'',4,''pid'',pg_backend_pid(),
  ''transaction_id'',pg_current_xact_id()::text,''wall_start'',wall_start,''wall_end'',wall_end,''successful_updates'',n,''lock_timeouts'',errors,''queued_delta'',after_q-before_q,
  ''failure_delta'',(SELECT count(*)-failures_before FROM private.orders_projection_failures),
  ''p50_ms'',percentile_cont(.5)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),''p95_ms'',percentile_cont(.95)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),
  ''max_ms'',max(ms)FILTER(WHERE ok),''paired_samples'',jsonb_agg(jsonb_build_object(''row'',row_n,''ms'',ms)ORDER BY row_n)FILTER(WHERE ok),''samples_ms'',jsonb_agg(ms ORDER BY ms)FILTER(WHERE ok)) INTO receipt FROM projection_write_times;
 IF n<>200/4 OR errors<>0 THEN RAISE EXCEPTION ''INCOMPLETE_OR_FAILED_UPDATES'';END IF;
 IF phase AND after_q-before_q<>2*n THEN RAISE EXCEPTION ''ENQUEUE_NOT_EXERCISED'';END IF;
 IF NOT phase AND after_q-before_q<>0 THEN RAISE EXCEPTION ''DISABLED_TRIGGER_ENQUEUED'';END IF;
 EXECUTE format(''PREPARE projection_benchmark_receipt AS INSERT INTO private.orders_projection_write_measurements(batch,lane,receipt,rollback_status) VALUES (''''write-0857-off-4'''',1,%L::jsonb,pg_xact_status(%L::xid8)) RETURNING rollback_status'',receipt::text,pg_current_xact_id()::text);
END $bench$;
ROLLBACK;
EXECUTE projection_benchmark_receipt;
');
SELECT cron.schedule('write-0857-off-4-2','57 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0857-off-4-2''); UPDATE private.orders_projection_control SET maintenance_enabled=false WHERE singleton; COMMIT;
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_prepared_statements WHERE name=''projection_benchmark_receipt'') THEN DEALLOCATE projection_benchmark_receipt;END IF;END$$;
SET LOCAL statement_timeout=''15s'';
SET LOCAL lock_timeout=''25ms'';
SET LOCAL application_name=''orders-projection-write-benchmark'';
CREATE TEMP TABLE projection_write_cohort ON COMMIT DROP AS
WITH groups AS MATERIALIZED (
 SELECT DISTINCT ON(owner_id,private.orders_dashboard_group_key(source_channel,order_number,id)) id,owner_id,
 private.orders_dashboard_group_key(source_channel,order_number,id) group_key
 FROM public.fulfillment_orders WHERE source_channel=''amazon'' AND pii_purged_at IS NULL AND order_action_lease IS NULL
 ORDER BY owner_id,private.orders_dashboard_group_key(source_channel,order_number,id),id
)
SELECT id,row_number() OVER(ORDER BY owner_id,group_key,id) rn FROM groups ORDER BY owner_id,group_key,id LIMIT 200;
CREATE TEMP TABLE projection_write_times(row_n bigint,ms double precision,ok boolean,error_code text) ON COMMIT DROP;
DO $bench$
DECLARE r record; started timestamptz; phase boolean; before_q bigint; after_q bigint; n integer:=0; failures_before bigint; errors integer:=0; receipt jsonb; wall_start timestamptz; wall_end timestamptz; cohort_hash text;
BEGIN
 SELECT maintenance_enabled INTO STRICT phase FROM private.orders_projection_control WHERE singleton;
 IF phase IS DISTINCT FROM false THEN RAISE EXCEPTION ''BENCHMARK_SWITCH_MISMATCH'';END IF;
 PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:57:03.000Z''::timestamptz-clock_timestamp())));
 SELECT count(*) INTO before_q FROM private.orders_projection_dirty;
 SELECT count(*) INTO failures_before FROM private.orders_projection_failures;
 wall_start:=clock_timestamp();
 SELECT md5(string_agg(id::text,'','' ORDER BY rn)) INTO cohort_hash FROM projection_write_cohort;
 IF (SELECT count(*) FROM projection_write_cohort)<>200 THEN RAISE EXCEPTION ''INCOMPLETE_COHORT'';END IF;
 FOR r IN SELECT id,rn FROM projection_write_cohort WHERE (rn-1)%4=2 ORDER BY rn LOOP
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
 SELECT jsonb_build_object(''cohort_hash'',cohort_hash,''maintenance_enabled'',phase,''lane'',2,''lanes'',4,''pid'',pg_backend_pid(),
  ''transaction_id'',pg_current_xact_id()::text,''wall_start'',wall_start,''wall_end'',wall_end,''successful_updates'',n,''lock_timeouts'',errors,''queued_delta'',after_q-before_q,
  ''failure_delta'',(SELECT count(*)-failures_before FROM private.orders_projection_failures),
  ''p50_ms'',percentile_cont(.5)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),''p95_ms'',percentile_cont(.95)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),
  ''max_ms'',max(ms)FILTER(WHERE ok),''paired_samples'',jsonb_agg(jsonb_build_object(''row'',row_n,''ms'',ms)ORDER BY row_n)FILTER(WHERE ok),''samples_ms'',jsonb_agg(ms ORDER BY ms)FILTER(WHERE ok)) INTO receipt FROM projection_write_times;
 IF n<>200/4 OR errors<>0 THEN RAISE EXCEPTION ''INCOMPLETE_OR_FAILED_UPDATES'';END IF;
 IF phase AND after_q-before_q<>2*n THEN RAISE EXCEPTION ''ENQUEUE_NOT_EXERCISED'';END IF;
 IF NOT phase AND after_q-before_q<>0 THEN RAISE EXCEPTION ''DISABLED_TRIGGER_ENQUEUED'';END IF;
 EXECUTE format(''PREPARE projection_benchmark_receipt AS INSERT INTO private.orders_projection_write_measurements(batch,lane,receipt,rollback_status) VALUES (''''write-0857-off-4'''',2,%L::jsonb,pg_xact_status(%L::xid8)) RETURNING rollback_status'',receipt::text,pg_current_xact_id()::text);
END $bench$;
ROLLBACK;
EXECUTE projection_benchmark_receipt;
');
SELECT cron.schedule('write-0857-off-4-3','57 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0857-off-4-3''); UPDATE private.orders_projection_control SET maintenance_enabled=false WHERE singleton; COMMIT;
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_prepared_statements WHERE name=''projection_benchmark_receipt'') THEN DEALLOCATE projection_benchmark_receipt;END IF;END$$;
SET LOCAL statement_timeout=''15s'';
SET LOCAL lock_timeout=''25ms'';
SET LOCAL application_name=''orders-projection-write-benchmark'';
CREATE TEMP TABLE projection_write_cohort ON COMMIT DROP AS
WITH groups AS MATERIALIZED (
 SELECT DISTINCT ON(owner_id,private.orders_dashboard_group_key(source_channel,order_number,id)) id,owner_id,
 private.orders_dashboard_group_key(source_channel,order_number,id) group_key
 FROM public.fulfillment_orders WHERE source_channel=''amazon'' AND pii_purged_at IS NULL AND order_action_lease IS NULL
 ORDER BY owner_id,private.orders_dashboard_group_key(source_channel,order_number,id),id
)
SELECT id,row_number() OVER(ORDER BY owner_id,group_key,id) rn FROM groups ORDER BY owner_id,group_key,id LIMIT 200;
CREATE TEMP TABLE projection_write_times(row_n bigint,ms double precision,ok boolean,error_code text) ON COMMIT DROP;
DO $bench$
DECLARE r record; started timestamptz; phase boolean; before_q bigint; after_q bigint; n integer:=0; failures_before bigint; errors integer:=0; receipt jsonb; wall_start timestamptz; wall_end timestamptz; cohort_hash text;
BEGIN
 SELECT maintenance_enabled INTO STRICT phase FROM private.orders_projection_control WHERE singleton;
 IF phase IS DISTINCT FROM false THEN RAISE EXCEPTION ''BENCHMARK_SWITCH_MISMATCH'';END IF;
 PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:57:03.000Z''::timestamptz-clock_timestamp())));
 SELECT count(*) INTO before_q FROM private.orders_projection_dirty;
 SELECT count(*) INTO failures_before FROM private.orders_projection_failures;
 wall_start:=clock_timestamp();
 SELECT md5(string_agg(id::text,'','' ORDER BY rn)) INTO cohort_hash FROM projection_write_cohort;
 IF (SELECT count(*) FROM projection_write_cohort)<>200 THEN RAISE EXCEPTION ''INCOMPLETE_COHORT'';END IF;
 FOR r IN SELECT id,rn FROM projection_write_cohort WHERE (rn-1)%4=3 ORDER BY rn LOOP
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
 SELECT jsonb_build_object(''cohort_hash'',cohort_hash,''maintenance_enabled'',phase,''lane'',3,''lanes'',4,''pid'',pg_backend_pid(),
  ''transaction_id'',pg_current_xact_id()::text,''wall_start'',wall_start,''wall_end'',wall_end,''successful_updates'',n,''lock_timeouts'',errors,''queued_delta'',after_q-before_q,
  ''failure_delta'',(SELECT count(*)-failures_before FROM private.orders_projection_failures),
  ''p50_ms'',percentile_cont(.5)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),''p95_ms'',percentile_cont(.95)WITHIN GROUP(ORDER BY ms)FILTER(WHERE ok),
  ''max_ms'',max(ms)FILTER(WHERE ok),''paired_samples'',jsonb_agg(jsonb_build_object(''row'',row_n,''ms'',ms)ORDER BY row_n)FILTER(WHERE ok),''samples_ms'',jsonb_agg(ms ORDER BY ms)FILTER(WHERE ok)) INTO receipt FROM projection_write_times;
 IF n<>200/4 OR errors<>0 THEN RAISE EXCEPTION ''INCOMPLETE_OR_FAILED_UPDATES'';END IF;
 IF phase AND after_q-before_q<>2*n THEN RAISE EXCEPTION ''ENQUEUE_NOT_EXERCISED'';END IF;
 IF NOT phase AND after_q-before_q<>0 THEN RAISE EXCEPTION ''DISABLED_TRIGGER_ENQUEUED'';END IF;
 EXECUTE format(''PREPARE projection_benchmark_receipt AS INSERT INTO private.orders_projection_write_measurements(batch,lane,receipt,rollback_status) VALUES (''''write-0857-off-4'''',3,%L::jsonb,pg_xact_status(%L::xid8)) RETURNING rollback_status'',receipt::text,pg_current_xact_id()::text);
END $bench$;
ROLLBACK;
EXECUTE projection_benchmark_receipt;
');
SELECT cron.schedule('write-0857-off-4-watch','57 8 22 10 *','BEGIN; SELECT cron.unschedule(''write-0857-off-4-watch'');COMMIT; SET application_name=''projection-lock-watch''; DO $watch$ DECLARE n int; w int; mx int:=0; waits int:=0; overlap int:=0; advisory int:=0; samples int:=0; started timestamptz; BEGIN PERFORM pg_sleep(greatest(0,extract(epoch from ''2026-10-22T08:57:03.000Z''::timestamptz-clock_timestamp())-.05));started:=clock_timestamp();FOR i IN 1..300 LOOP PERFORM pg_stat_clear_snapshot(); SELECT count(*),count(*) FILTER(WHERE wait_event_type=''Lock'') INTO n,w FROM pg_stat_activity WHERE application_name=''orders-projection-write-benchmark'' AND state=''active'';mx:=greatest(mx,n);waits:=waits+w;IF n>=2 THEN overlap:=overlap+1;END IF;SELECT count(*) INTO w FROM pg_locks l JOIN pg_stat_activity a USING(pid) WHERE a.application_name=''orders-projection-write-benchmark'' AND NOT l.granted AND l.locktype=''advisory'';advisory:=advisory+w;samples:=samples+1;PERFORM pg_sleep(.01);END LOOP;UPDATE private.orders_projection_control SET maintenance_enabled=true WHERE singleton;INSERT INTO private.orders_projection_write_measurements VALUES(''write-0857-off-4'',-1,jsonb_build_object(''max_active_sessions'',mx,''overlap_samples'',overlap,''lock_wait_samples'',waits,''advisory_wait_samples'',advisory,''samples'',samples,''started'',started,''restored_at'',clock_timestamp()),''observer'',clock_timestamp());END $watch$;');
