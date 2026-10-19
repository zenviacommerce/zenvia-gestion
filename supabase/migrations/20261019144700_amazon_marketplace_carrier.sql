-- Keep marketplace declarations separate from the actual locally owned label.
-- Carrier names contain no recipient/tracking data. Existing tenant RLS applies.
ALTER TABLE public.fulfillment_orders ADD COLUMN IF NOT EXISTS marketplace_carrier text;
COMMENT ON COLUMN public.fulfillment_orders.marketplace_carrier IS 'Carrier declared by the source marketplace; never authoritative over an existing local shipment.';
NOTIFY pgrst, 'reload schema';
