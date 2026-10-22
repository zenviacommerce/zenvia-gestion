-- Shopify is a sales channel, not the authority for locally purchased carrier labels.
-- Keep the account of an unchanged local shipment if an older importer sends NULL.
-- A dedicated guard also covers the interval between MRW shipment creation and PDF retrieval.
create or replace function private.preserve_shopify_carrier_account()
returns trigger language plpgsql set search_path = '' as $$
begin
 if old.source_channel = 'shopify' and new.source_channel = 'shopify'
 and new.owner_id = old.owner_id
 and new.source_integration_account_id is not distinct from old.source_integration_account_id
 and old.shipping_integration_account_id is not null
 and new.shipping_integration_account_id is null
 and (old.label_created_at is not null or (old.shipping_provider = 'mrw' and old.shipping_remote_id is not null))
 and (new.last_synced_at is distinct from old.last_synced_at or new.raw_payload is distinct from old.raw_payload)
 and new.shipping_provider is not distinct from old.shipping_provider
 and new.shipping_remote_id is not distinct from old.shipping_remote_id
 and new.sendcloud_parcel_id is not distinct from old.sendcloud_parcel_id
 and new.label_created_at is not distinct from old.label_created_at
 and new.label_cancelled_at is not distinct from old.label_cancelled_at
 then
  new.shipping_integration_account_id := old.shipping_integration_account_id;
 end if;
 return new;
end;
$$;
revoke all on function private.preserve_shopify_carrier_account() from public, anon, authenticated;
create trigger fulfillment_preserve_shopify_carrier_account
before update on public.fulfillment_orders
for each row execute function private.preserve_shopify_carrier_account();
