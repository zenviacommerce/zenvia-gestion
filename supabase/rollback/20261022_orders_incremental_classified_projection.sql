-- Revert reads while preserving refresh triggers so later PII purge/delete
-- continues to update the private derived rows. Decommissioning is separate.
-- No source orders, wrappers, grants, manifest rows or historic statistics change.
DO $rollback$
DECLARE f record;target regprocedure;
BEGIN
 FOR f IN SELECT * FROM private.orders_projection_rpc_backup LOOP
  target:=to_regprocedure(f.signature);
  IF target IS NULL OR md5(pg_get_functiondef(target))<>f.optimized_hash THEN
   RAISE EXCEPTION 'ORDERS_PROJECTION_ROLLBACK_SOURCE_CHANGED: %',f.signature;
  END IF;
  EXECUTE f.original_definition;
 END LOOP;
END $rollback$;
REVOKE ALL ON private.orders_dashboard_projection FROM PUBLIC,anon,authenticated;
