-- Synchronization may have read an order before its carrier label was created.
-- Protect tracking at write time, including the MRW transmit/PDF window.
create or replace function public.integration_preserve_shopify_local_tracking()
returns trigger language plpgsql set search_path=public as $$
begin
 if old.source_channel='shopify'
 and nullif(old.tracking_number,'') is not null
 and (old.label_created_at is not null or (old.shipping_provider='mrw' and old.shipping_remote_id is not null))
 and (new.last_synced_at is distinct from old.last_synced_at or new.raw_payload is distinct from old.raw_payload)
 and new.shipping_provider is not distinct from old.shipping_provider
 and new.shipping_remote_id is not distinct from old.shipping_remote_id
 and new.sendcloud_parcel_id is not distinct from old.sendcloud_parcel_id
 and new.label_cancelled_at is not distinct from old.label_cancelled_at
 and (new.label_created_at is not null or old.label_created_at is null) then
  new.tracking_number=old.tracking_number;
  new.tracking_url=old.tracking_url;
  new.carrier_name=old.carrier_name;
  new.tracking_status_code=old.tracking_status_code;
  new.tracking_status_message=old.tracking_status_message;
  new.tracking_updated_at=old.tracking_updated_at;
  new.fulfilled_at=old.fulfilled_at;
  if old.raw_payload ? '_zenvia_tracking' then
   new.raw_payload=coalesce(new.raw_payload,'{}'::jsonb)||jsonb_build_object('_zenvia_tracking',old.raw_payload->'_zenvia_tracking');
  end if;
 end if;
 return new;
end $$;
