-- Prepared only; NOT executed. Restore Edge v14 first if rolling back the importer.
-- This refuses data rollback after any carrier response; retain those results for review.
begin;
lock table public.fulfillment_orders in share row exclusive mode;
lock table public.shipment_tracking_state in share row exclusive mode;
do $$begin
 if exists(select 1 from public.shipment_tracking_state s join private.shopify_mrw_account_repair_20261022 b on b.id=s.order_id
 where s.last_checked_at is not null or s.lease_id is not null or s.normalized_state is not null)
 then raise exception 'Carrier work started; retain results and review rollback';end if;
 if exists(select 1 from public.fulfillment_orders o join private.shopify_mrw_account_repair_20261022 b on b.id=o.id
 where o.shipping_integration_account_id is distinct from b.repaired_account_id
 or private.shipment_tracking_identity(jsonb_populate_record(null::public.fulfillment_orders,to_jsonb(o)||jsonb_build_object('shipping_integration_account_id',b.previous_account_id)))<>b.previous_identity_key)
 then raise exception 'Shipment identity changed; review rollback';end if;
end$$;
delete from public.shipment_tracking_state s using private.shopify_mrw_account_repair_20261022 b where s.order_id=b.id;
update public.fulfillment_orders o set shipping_integration_account_id=b.previous_account_id
from private.shopify_mrw_account_repair_20261022 b where o.id=b.id and o.owner_id=b.owner_id;
-- Do not remove audit or private rollback evidence.
commit;
-- Guard-only rollback (separate, if needed):
-- drop trigger fulfillment_preserve_shopify_carrier_account on public.fulfillment_orders;
-- drop function private.preserve_shopify_carrier_account();
