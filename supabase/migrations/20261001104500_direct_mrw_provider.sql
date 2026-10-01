alter table public.integration_accounts
  drop constraint if exists integration_accounts_provider_check;
alter table public.integration_accounts
  add constraint integration_accounts_provider_check
  check (provider in ('amazon','sendcloud','envia','mrw','shopify','gmail'));

alter table public.fulfillment_orders
  drop constraint if exists fulfillment_orders_shipping_provider_check;
alter table public.fulfillment_orders
  add constraint fulfillment_orders_shipping_provider_check
  check (shipping_provider is null or shipping_provider in ('sendcloud','envia','mrw'));
