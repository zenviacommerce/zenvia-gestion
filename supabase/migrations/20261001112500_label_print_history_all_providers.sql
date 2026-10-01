-- Historical labels may only have a provider parcel/shipment id and no label_created_at.
-- They predate ZENVIA print tracking and must be "Sin información", never "No impreso".
update public.fulfillment_orders
set label_print_state_known=false
where sendcloud_parcel_id is not null
   or shipping_remote_id is not null
   or label_created_at is not null;

-- Seven labels were manually verified against Sendcloud during the print-state rollout.
update public.fulfillment_orders
set label_print_state_known=true
where order_number in (
  '403-5230881-6173918',
  '403-8361979-3472310',
  '406-5034573-6848351',
  '407-1582662-6340342',
  '406-9056815-0930768',
  '405-4189480-0038757',
  '408-8472231-1095547'
);
