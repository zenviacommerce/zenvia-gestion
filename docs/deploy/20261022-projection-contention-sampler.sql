DO $sample$
DECLARE
 started timestamptz:=clock_timestamp(); finished timestamptz; sample_no integer;
 m record; counters jsonb:='[]'::jsonb;
BEGIN
 FOR sample_no IN 1..50 LOOP
  PERFORM pg_stat_clear_snapshot();
  WITH activity AS MATERIALIZED (
   SELECT pid,state,wait_event_type,query FROM pg_stat_activity WHERE pid<>pg_backend_pid()
  ), locks AS MATERIALIZED (
   SELECT pid,locktype,relation,mode,granted FROM pg_locks
  ), source_writers AS MATERIALIZED (
   SELECT DISTINCT a.pid,a.wait_event_type FROM activity a JOIN locks l USING(pid)
   WHERE a.state='active' AND l.relation='public.fulfillment_orders'::regclass
    AND l.mode='RowExclusiveLock'
  )
  SELECT
   (SELECT count(*) FROM locks WHERE locktype='advisory' AND NOT granted)::integer advisory_waiters,
   (SELECT count(DISTINCT s.pid) FROM source_writers s JOIN locks l USING(pid) WHERE l.locktype='advisory' AND NOT l.granted)::integer source_write_advisory_waiters,
   (SELECT count(DISTINCT s.pid) FROM source_writers s JOIN locks l USING(pid) WHERE s.wait_event_type='Lock' AND l.locktype<>'advisory' AND NOT l.granted)::integer source_write_other_lock_waiters,
   (SELECT count(*) FROM source_writers)::integer active_source_writers,
   (SELECT count(*) FROM locks l JOIN activity a USING(pid) WHERE l.locktype='advisory' AND l.granted AND a.query ~ 'orders_dashboard_projection|projection_compute')::integer worker_advisory_locks,
   (SELECT count(*) FROM activity WHERE state='active' AND query ~ 'orders_dashboard_projection|projection_compute')::integer active_worker_sessions,
   (SELECT count(*) FROM activity WHERE state='active' AND query IS NULL)::integer active_sessions_query_unavailable
  INTO m;
  counters:=counters||jsonb_build_object('sample',sample_no,'advisory_waiters',m.advisory_waiters,
   'source_write_advisory_waiters',m.source_write_advisory_waiters,'source_write_other_lock_waiters',m.source_write_other_lock_waiters,
   'active_source_writers',m.active_source_writers,'worker_advisory_locks',m.worker_advisory_locks,
   'active_worker_sessions',m.active_worker_sessions,'active_sessions_query_unavailable',m.active_sessions_query_unavailable);
  IF sample_no<50 THEN PERFORM pg_sleep(0.2); END IF;
 END LOOP;
 finished:=clock_timestamp();
 PERFORM set_config('diagnostics.projection_contention_sample',
  (SELECT jsonb_build_object('started_at',started,'finished_at',finished,'duration_ms',extract(epoch FROM finished-started)*1000,
   'samples',50,'nominal_sample_interval_ms',200,
   'max_advisory_waiters',max((j->>'advisory_waiters')::integer),
   'max_source_write_advisory_waiters',max((j->>'source_write_advisory_waiters')::integer),
   'max_source_write_other_lock_waiters',max((j->>'source_write_other_lock_waiters')::integer),
   'max_active_source_writers',max((j->>'active_source_writers')::integer),
   'max_worker_advisory_locks',max((j->>'worker_advisory_locks')::integer),
   'max_active_worker_sessions',max((j->>'active_worker_sessions')::integer),
   'samples_with_source_writers',count(*) FILTER(WHERE (j->>'active_source_writers')::integer>0),
   'samples_with_worker_locks',count(*) FILTER(WHERE (j->>'worker_advisory_locks')::integer>0),
   'samples_with_source_writers_and_worker_locks',count(*) FILTER(WHERE (j->>'active_source_writers')::integer>0 AND (j->>'worker_advisory_locks')::integer>0),
   'max_active_sessions_query_unavailable',max((j->>'active_sessions_query_unavailable')::integer),
   'limitations','Point sampling may miss sub-200ms writes or waits; zero writer samples means concurrency was unobserved, not a passed load test; no business writes or forced locks were generated.'
  )::text FROM jsonb_array_elements(counters) j),true);
END $sample$;
SELECT current_setting('diagnostics.projection_contention_sample')::jsonb AS contention_sample;
