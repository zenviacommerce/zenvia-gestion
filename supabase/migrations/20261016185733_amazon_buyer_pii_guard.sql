-- Preparation only. Does not purge existing orders, schedule cron, or delete binaries.
alter table public.fulfillment_orders add column if not exists pii_purged_at timestamptz;
alter table public.fulfillment_orders add column if not exists destination_country_code text;
alter table public.fulfillment_orders add column if not exists pii_policy_version text;

create table private.amazon_pii_tombstones(
 owner_id uuid not null,
 amazon_order_ref text not null check(amazon_order_ref ~ '^[0-9]{3}-[0-9]{7}-[0-9]{7}$'),
 purged_at timestamptz not null,
 policy_version text not null,
 primary key(owner_id,amazon_order_ref)
);
alter table private.amazon_pii_tombstones enable row level security;
revoke all on private.amazon_pii_tombstones from public,anon,authenticated;
grant select,insert,update,delete on private.amazon_pii_tombstones to service_role;

create function private.amazon_pii_deadline(p_purchase_at timestamptz,p_delivered_at timestamptz)
returns timestamptz language sql immutable set search_path='' as $$
 select case when p_delivered_at is not null then p_delivered_at+interval '720 hours'
             when p_purchase_at is not null then p_purchase_at+interval '1440 hours' end
$$;
revoke all on function private.amazon_pii_deadline(timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function private.amazon_pii_deadline(timestamptz,timestamptz) to service_role;

create function private.amazon_pii_safe_money(p_money jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select case
 when jsonb_typeof(p_money)='number' then p_money
 when jsonb_typeof(p_money)='object' then jsonb_strip_nulls(jsonb_build_object(
   'value',case when p_money->>'value' ~ '^-?[0-9]+([.][0-9]+)?$' then (p_money->>'value')::numeric end,
   'currency',case when p_money->>'currency' ~ '^[A-Z]{3}$' then p_money->>'currency' end))
 else null end
$$;
create function private.amazon_pii_safe_items(p_items jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
   'item_id',case when jsonb_typeof(e->'item_id') in ('string','number') then e->'item_id' end,
   'sku',case when jsonb_typeof(e->'sku')='string' then e->'sku' end,
   'product_id',case when jsonb_typeof(e->'product_id')='string' then e->'product_id' end,
   'quantity',case when jsonb_typeof(e->'quantity')='number' then e->'quantity' end,
   'unit_price',private.amazon_pii_safe_money(e->'unit_price'),
   'total_price',private.amazon_pii_safe_money(e->'total_price')
  )) order by n),'[]'::jsonb)
 from jsonb_array_elements(case when jsonb_typeof(p_items)='array' then p_items else '[]' end)
 with ordinality a(e,n)
$$;
revoke all on function private.amazon_pii_safe_money(jsonb),private.amazon_pii_safe_items(jsonb) from public,anon,authenticated;
grant execute on function private.amazon_pii_safe_money(jsonb),private.amazon_pii_safe_items(jsonb) to service_role;

create function private.guard_amazon_purged_pii() returns trigger
language plpgsql security definer set search_path='' set statement_timeout='3s' set lock_timeout='500ms' as $$
declare v_ref text; v_old_ref text; v_purged timestamptz; v_policy text;
begin
 v_ref:=coalesce(case when new.order_number ~ '^[0-9]{3}-[0-9]{7}-[0-9]{7}$' then new.order_number end,
                 case when new.order_id ~ '^[0-9]{3}-[0-9]{7}-[0-9]{7}$' then new.order_id end);
 if tg_op='UPDATE' and old.pii_purged_at is not null then
   v_old_ref:=coalesce(case when old.order_number ~ '^[0-9]{3}-[0-9]{7}-[0-9]{7}$' then old.order_number end,
                     case when old.order_id ~ '^[0-9]{3}-[0-9]{7}-[0-9]{7}$' then old.order_id end);
   if new.owner_id is distinct from old.owner_id or new.source_channel is distinct from old.source_channel
      or v_ref is distinct from v_old_ref then
     raise exception using errcode='22023',message='A purged Amazon order identity cannot be changed';
   end if;
   new.pii_purged_at:=old.pii_purged_at;
   new.pii_policy_version:=old.pii_policy_version;
   new.destination_country_code:=old.destination_country_code;
 end if;
 if new.source_channel is distinct from 'amazon' then return new; end if;
 v_ref:=coalesce(case when new.order_number ~ '^[0-9]{3}-[0-9]{7}-[0-9]{7}$' then new.order_number end,
                 case when new.order_id ~ '^[0-9]{3}-[0-9]{7}-[0-9]{7}$' then new.order_id end);
 select purged_at,policy_version into v_purged,v_policy from private.amazon_pii_tombstones
   where owner_id=new.owner_id and amazon_order_ref=v_ref;
 if v_purged is not null then
   new.pii_purged_at:=v_purged;new.pii_policy_version:=v_policy;
 end if;
 if new.pii_purged_at is null then return new; end if;
 if new.order_number ~ '^[0-9]{3}-[0-9]{7}-[0-9]{7}$' and new.order_id ~ '^[0-9]{3}-[0-9]{7}-[0-9]{7}$'
    and new.order_number<>new.order_id then
   raise exception using errcode='22023',message='Conflicting Amazon order references';
 end if;
 if v_ref is null then raise exception using errcode='22023',message='A stable Amazon order reference is required before purging'; end if;
 if new.pii_purged_at>statement_timestamp() then raise exception using errcode='22023',message='Invalid purge timestamp'; end if;
 new.pii_policy_version:='amazon-pii-v2-purchase60';
 insert into private.amazon_pii_tombstones(owner_id,amazon_order_ref,purged_at,policy_version)
 values(new.owner_id,v_ref,new.pii_purged_at,new.pii_policy_version)
 on conflict(owner_id,amazon_order_ref) do nothing;
 new.destination_country_code:=coalesce(case when new.destination_country_code ~ '^[A-Z]{2}$' then new.destination_country_code end,
   case when new.shipping_address->>'country_code' ~ '^[A-Z]{2}$' then new.shipping_address->>'country_code' end);
 new.customer_name:=null;new.customer_email:=null;new.customer_phone:=null;
 new.shipping_address:='{}'::jsonb;new.billing_address:='{}'::jsonb;new.raw_payload:='{}'::jsonb;
 new.items:=private.amazon_pii_safe_items(new.items);
 new.tracking_number:=null;new.tracking_url:=null;new.shipping_label_url:=null;
 new.shipping_remote_id:=null;new.sendcloud_parcel_id:=null;new.sendcloud_shipment_id:=null;new.sendcloud_remote_id:=null;
 new.tracking_status_message:=null;new.amazon_tracking_sync_error:=null;new.shopify_tracking_sync_error:=null;
 return new;
end
$$;
revoke all on function private.guard_amazon_purged_pii() from public,anon,authenticated;
grant execute on function private.guard_amazon_purged_pii() to service_role;
-- Final guard must run after existing preservation/normalization triggers.
create trigger zzzz_amazon_pii_guard before insert or update on public.fulfillment_orders
for each row execute function private.guard_amazon_purged_pii();
