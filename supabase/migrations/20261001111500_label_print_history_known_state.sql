alter table public.fulfillment_orders
  add column if not exists label_print_state_known boolean not null default true;

-- Everything that existed before ZENVIA started tracking print actions is unknown,
-- not "unprinted". We only mark as known the seven labels manually verified against
-- Sendcloud during the rollout.
update public.fulfillment_orders
set label_print_state_known=false
where label_created_at is not null;

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

-- New labels created after this migration keep the DEFAULT true value.
