-- Nullable by design: no product weight is invented and no historical orders change.
alter table public.products add column if not exists unit_weight_kg numeric;
alter table public.products add constraint products_unit_weight_positive check (unit_weight_kg is null or unit_weight_kg > 0);
comment on column public.products.unit_weight_kg is 'Weight in kg per internal base unit; marketplace mapping consumption_factor converts sold SKU units.';
-- Existing shipping.fallbackWeightKg remains configurable; optional
-- shipping.skuFallbackWeightsKg is a SKU -> positive kg/unit map.

-- Retain all manual/shipped protections; allow verified calculator payloads
-- to refresh a pending Shopify order that previously carried a fallback.
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
 if measurement is not null and not (
   nullif(old_marker,'') is null
   and old.fulfilled_at is null
   and old.label_created_at is null
   and lower(coalesce(old.source_status,'')) in ('pending','unshipped','unfulfilled','open')
   and new.raw_payload#>>'{_zenvia_weight,source}'='line_items'
 ) then
  new.raw_payload:=jsonb_set(coalesce(new.raw_payload,'{}'::jsonb),'{shipping_details}',
    coalesce(new.raw_payload->'shipping_details','{}'::jsonb)||jsonb_build_object('measurement',measurement));
 end if;
 return new;
end;
$$;
