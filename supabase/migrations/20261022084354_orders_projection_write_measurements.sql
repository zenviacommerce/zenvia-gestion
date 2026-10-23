-- Diagnostic receipts only. No business data changes or deletions.
CREATE TABLE private.orders_projection_write_measurements (
 batch text NOT NULL,
 lane integer NOT NULL,
 receipt jsonb NOT NULL,
 rollback_status text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (batch,lane)
);
ALTER TABLE private.orders_projection_write_measurements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.orders_projection_write_measurements FROM PUBLIC,anon,authenticated;
