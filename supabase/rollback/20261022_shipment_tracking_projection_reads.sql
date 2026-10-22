-- Retain normalized tracking UI semantics, MFA wrappers, ACLs and maintenance.
-- Apply transactionally. Drift aborts before any definition is restored.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $rollback$
DECLARE f record;
BEGIN
 IF to_regclass('private.orders_projection_rpc_backup') IS NULL THEN RETURN;END IF;
 FOR f IN SELECT * FROM private.orders_projection_rpc_backup LOOP
  IF to_regprocedure(f.signature) IS NULL OR md5(pg_get_functiondef(to_regprocedure(f.signature)))<>f.optimized_hash THEN
   RAISE EXCEPTION 'ORDERS_PROJECTION_ROLLBACK_FUNCTION_CHANGED: %',f.signature;
  END IF;
  IF position('tracking_normalized_state' IN f.original_definition)=0 THEN
   RAISE EXCEPTION 'TRACKING_ROLLBACK_REQUIRES_NORMALIZED_BACKUP: %',f.signature;
  END IF;
 END LOOP;
 FOR f IN SELECT * FROM private.orders_projection_rpc_backup LOOP EXECUTE f.original_definition;END LOOP;
 UPDATE private.orders_projection_control SET read_enabled=false WHERE singleton;
END $rollback$;
COMMIT;
