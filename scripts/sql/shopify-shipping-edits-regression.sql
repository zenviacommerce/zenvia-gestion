begin;
do $test$
declare o public.fulfillment_orders%rowtype; current_row public.fulfillment_orders%rowtype;
begin
 select * into o from public.fulfillment_orders where source_channel='shopify' and fulfilled_at is null limit 1 for update;
 if o.id is null then raise exception 'The regression check requires a pending Shopify order.'; end if;
 update public.fulfillment_orders set package_length_cm=35,package_width_cm=45,package_height_cm=10,
  raw_payload=coalesce(raw_payload,'{}'::jsonb)||jsonb_build_object('_zenvia_local_shipping_updated_at','local-test-1','shipping_details',jsonb_build_object('measurement',jsonb_build_object('weight',jsonb_build_object('value',0.89,'unit','kg')))) where id=o.id;
 -- Reproduce the next Shopify sync replacing its entire payload and dimensions.
 update public.fulfillment_orders set raw_payload=jsonb_build_object('id','shopify-sync','lineItems','[]'::jsonb),package_length_cm=null,package_width_cm=null,package_height_cm=null,last_synced_at=now() where id=o.id;
 select * into current_row from public.fulfillment_orders where id=o.id;
 if current_row.package_length_cm is distinct from 35 or current_row.package_width_cm is distinct from 45 or current_row.package_height_cm is distinct from 10 or (current_row.raw_payload->'shipping_details'->'measurement'->'weight'->>'value')::numeric is distinct from 0.89 then raise exception 'Shopify sync removed saved package data.'; end if;
 if (current_row.raw_payload->>'id') is distinct from 'shopify-sync' then raise exception 'Fresh Shopify data must still be applied.'; end if;
 -- A second local edit must not be blocked by preservation of the first one.
 update public.fulfillment_orders set package_length_cm=20,raw_payload=raw_payload||jsonb_build_object('_zenvia_local_shipping_updated_at','local-test-2','shipping_details',jsonb_build_object('measurement',jsonb_build_object('weight',jsonb_build_object('value',2,'unit','kg')))) where id=o.id;
 select * into current_row from public.fulfillment_orders where id=o.id;
 if current_row.package_length_cm is distinct from 20 or (current_row.raw_payload->'shipping_details'->'measurement'->'weight'->>'value')::numeric is distinct from 2 then raise exception 'The second local edit was overwritten.'; end if;
end;
$test$;
rollback;
