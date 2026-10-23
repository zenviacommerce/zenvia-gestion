-- Restore definitions only when they still match this migration; never overwrite
-- a later tracking/privacy implementation. No data, grants or wrappers change.
DO $rollback$
DECLARE f record; target regprocedure;
BEGIN
 FOR f IN SELECT * FROM private.orders_rpc_performance_backup LOOP
  target:=to_regprocedure(f.signature);
  IF target IS NULL OR md5(pg_get_functiondef(target))<>f.optimized_hash THEN
   RAISE EXCEPTION 'ORDERS_PERF_ROLLBACK_SOURCE_CHANGED: %',f.signature;
  END IF;
  EXECUTE f.original_definition;
 END LOOP;
END $rollback$;
