UPDATE public.fulfillment_orders
SET tracking_status_code = NULL
WHERE id = 'e9fe54e4-101b-44ce-aef7-ff3195d149d9'
  AND owner_id = '7461b2b7-f383-460d-b1c7-6ccbb52e42b2'
  AND order_number = '406-9615891-5475566'
  AND tracking_status_code = 'MRW_CREATING'
  AND tracking_number IS NULL AND shipping_remote_id IS NULL
  AND shipping_provider IS NULL AND shipping_integration_account_id IS NULL
  AND label_created_at IS NULL
RETURNING id, order_number, tracking_status_code;
