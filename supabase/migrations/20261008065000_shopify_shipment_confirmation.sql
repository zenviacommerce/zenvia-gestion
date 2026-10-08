alter table public.fulfillment_orders
 add column if not exists shopify_tracking_synced_at timestamptz,
 add column if not exists shopify_tracking_synced_number text,
 add column if not exists shopify_tracking_sync_error text,
 add column if not exists shopify_tracking_last_attempt_at timestamptz,
 add column if not exists shopify_tracking_lease uuid,
 add column if not exists shopify_tracking_lease_until timestamptz;

create or replace function public.integration_shopify_claim_shipment(p_order_id uuid,p_owner_id uuid,p_lease uuid)
returns setof public.fulfillment_orders language sql security invoker set search_path=public as $$
 update public.fulfillment_orders set shopify_tracking_lease=p_lease,shopify_tracking_lease_until=now()+interval '5 minutes',shopify_tracking_last_attempt_at=now()
 where id=p_order_id and owner_id=p_owner_id and source_channel='shopify' and label_created_at is not null and nullif(tracking_number,'') is not null
 and (shopify_tracking_lease_until is null or shopify_tracking_lease_until<now())
 returning *;
$$;
revoke all on function public.integration_shopify_claim_shipment(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.integration_shopify_claim_shipment(uuid,uuid,uuid) to service_role;

create or replace function public.integration_shopify_pending_shipments(p_owner_id uuid)
returns setof public.fulfillment_orders language sql security invoker set search_path=public as $$
 select * from public.fulfillment_orders where owner_id=p_owner_id and source_channel='shopify'
 and label_created_at is not null and nullif(tracking_number,'') is not null
 and (shopify_tracking_synced_at is null or shopify_tracking_synced_number is distinct from tracking_number)
 and (shopify_tracking_last_attempt_at is null or shopify_tracking_last_attempt_at<now()-interval '5 minutes')
 order by shopify_tracking_last_attempt_at asc nulls first limit 5;
$$;
revoke all on function public.integration_shopify_pending_shipments(uuid) from public,anon,authenticated;
grant execute on function public.integration_shopify_pending_shipments(uuid) to service_role;
