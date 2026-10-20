create or replace function private.preserve_shopify_shipping_edits()
returns trigger language plpgsql set search_path='' as $$
declare
 old_marker text:=old.raw_payload->>'_zenvia_local_shipping_updated_at';
 new_marker text:=new.raw_payload->>'_zenvia_local_shipping_updated_at';
 measurement jsonb:=old.raw_payload->'shipping_details'->'measurement';
begin
 if old.source_channel<>'shopify' or new.source_channel<>'shopify'
    or new.owner_id is distinct from old.owner_id
    or new.source_integration_account_id is distinct from old.source_integration_account_id then return new; end if;
 -- A newly saved local edit is authoritative; never restore the preceding edit.
 if nullif(new_marker,'') is not null and new_marker is distinct from old_marker then return new; end if;
 if nullif(old_marker,'') is not null then
  new.customer_name:=old.customer_name;
  new.customer_email:=old.customer_email;
  new.customer_phone:=old.customer_phone;
  new.shipping_address:=old.shipping_address;
  new.package_length_cm:=old.package_length_cm;
  new.package_width_cm:=old.package_width_cm;
  new.package_height_cm:=old.package_height_cm;
  new.raw_payload:=coalesce(new.raw_payload,'{}'::jsonb)||jsonb_build_object(
    '_zenvia_local_shipping_updated_at',old_marker,
    'shipping_address',old.shipping_address,
    'customer_details',old.raw_payload->'customer_details');
 end if;
 -- Package data belongs to Gestión even for older rows without an edit marker.
 if measurement is not null then
  new.raw_payload:=jsonb_set(coalesce(new.raw_payload,'{}'::jsonb),'{shipping_details}',
    coalesce(new.raw_payload->'shipping_details','{}'::jsonb)||jsonb_build_object('measurement',measurement));
 end if;
 return new;
end;
$$;

-- Roll application functions and frontend back before removing this column.
-- No fulfillment order rows are rewritten by the forward migration.
-- Retain the additive column/constraint and any entered product weights.
-- Old application versions ignore the column; rollback must not erase user data.
