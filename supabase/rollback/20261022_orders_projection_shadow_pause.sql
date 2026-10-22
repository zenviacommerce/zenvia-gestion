-- Operational rollback of the approved SHADOW installation only.
-- Public/private RPC definitions were never changed. Keep independent derived
-- PII cleanup scheduled; do not remove its job or disable all source triggers.
-- Exactly one new private configuration row is updated; no business rows.
BEGIN;
UPDATE private.orders_projection_control
SET read_enabled=false,maintenance_enabled=false WHERE singleton;
COMMIT;
