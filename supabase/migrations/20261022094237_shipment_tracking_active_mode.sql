-- Allow the owner-approved release mode; keep the current switch unchanged.
-- This replaces one CHECK constraint, not a table or any row.
SET LOCAL lock_timeout='3s';
ALTER TABLE public.shipment_tracking_settings DROP CONSTRAINT shipment_tracking_settings_mode_check;
ALTER TABLE public.shipment_tracking_settings ADD CONSTRAINT shipment_tracking_settings_mode_check CHECK(mode IN ('shadow','active'));
