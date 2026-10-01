alter table public.fulfillment_orders
  add column if not exists package_length_cm numeric(10,2),
  add column if not exists package_width_cm numeric(10,2),
  add column if not exists package_height_cm numeric(10,2),
  add column if not exists label_printed_at timestamptz,
  add column if not exists label_print_count integer not null default 0;

alter table public.fulfillment_orders
  drop constraint if exists fulfillment_orders_package_dimensions_check;
alter table public.fulfillment_orders
  add constraint fulfillment_orders_package_dimensions_check check (
    (package_length_cm is null or package_length_cm > 0)
    and (package_width_cm is null or package_width_cm > 0)
    and (package_height_cm is null or package_height_cm > 0)
    and label_print_count >= 0
  );

create index if not exists fulfillment_orders_owner_label_printed_idx
  on public.fulfillment_orders(owner_id,label_printed_at desc)
  where label_printed_at is not null;
