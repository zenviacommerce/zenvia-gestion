-- Conditional incident rollback ONLY while no subsequent consignment exists.
-- Show this exact SQL and affected-row read before running; NOT executed.
UPDATE public.fulfillment_orders SET tracking_status_code='MRW_CREATING'
WHERE id='e9fe54e4-101b-44ce-aef7-ff3195d149d9'
AND owner_id='7461b2b7-f383-460d-b1c7-6ccbb52e42b2'
AND tracking_status_code IS NULL AND tracking_number IS NULL
AND shipping_remote_id IS NULL AND label_created_at IS NULL
AND shipping_provider IS NULL AND shipping_integration_account_id IS NULL
RETURNING id,tracking_status_code;
