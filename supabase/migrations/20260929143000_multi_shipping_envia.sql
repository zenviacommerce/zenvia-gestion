alter table public.integration_accounts
  drop constraint if exists integration_accounts_provider_check;

alter table public.integration_accounts
  add constraint integration_accounts_provider_check
  check (provider in ('amazon','sendcloud','envia','shopify','gmail'));

alter table public.fulfillment_orders
  add column if not exists shipping_provider text,
  add column if not exists shipping_remote_id text,
  add column if not exists shipping_label_url text;

update public.fulfillment_orders
set shipping_provider='sendcloud'
where shipping_provider is null
  and (
    sendcloud_remote_id is not null
    or sendcloud_parcel_id is not null
    or sendcloud_shipment_id is not null
  );

alter table public.fulfillment_orders
  drop constraint if exists fulfillment_orders_shipping_provider_check;

alter table public.fulfillment_orders
  add constraint fulfillment_orders_shipping_provider_check
  check (shipping_provider is null or shipping_provider in ('sendcloud','envia'));

create index if not exists fulfillment_orders_shipping_provider_idx
  on public.fulfillment_orders(owner_id,shipping_provider,label_created_at desc);

create unique index if not exists fulfillment_orders_provider_remote_uidx
  on public.fulfillment_orders(owner_id,shipping_provider,shipping_remote_id)
  where shipping_provider is not null and shipping_remote_id is not null;
