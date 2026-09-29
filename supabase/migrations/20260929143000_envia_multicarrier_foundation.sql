alter table public.integration_accounts
  drop constraint if exists integration_accounts_provider_check;

alter table public.integration_accounts
  add constraint integration_accounts_provider_check
  check (provider in ('amazon','sendcloud','shopify','gmail','envia'));

alter table public.fulfillment_orders
  add column if not exists shipping_provider text,
  add column if not exists shipping_remote_id text,
  add column if not exists shipping_label_url text,
  add column if not exists shipping_label_mime_type text;

update public.fulfillment_orders
set
  shipping_provider=coalesce(shipping_provider,'sendcloud'),
  shipping_remote_id=coalesce(
    shipping_remote_id,
    nullif(sendcloud_shipment_id,''),
    case when sendcloud_parcel_id is not null then sendcloud_parcel_id::text else null end
  )
where shipping_provider is null
  and (
    sendcloud_parcel_id is not null
    or nullif(sendcloud_shipment_id,'') is not null
    or nullif(sendcloud_remote_id,'') is not null
  );

create index if not exists fulfillment_orders_shipping_provider_idx
  on public.fulfillment_orders(owner_id,shipping_provider,label_created_at desc);

create index if not exists fulfillment_orders_shipping_remote_generic_idx
  on public.fulfillment_orders(owner_id,shipping_provider,shipping_remote_id)
  where shipping_remote_id is not null;
