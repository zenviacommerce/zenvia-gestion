-- Scope: only missing Shopify/MRW carrier associations, last 45 days.
-- Abort if the reviewed count changes, if an account is ambiguous, or if it postdates the label.
begin;
create table private.shopify_mrw_account_repair_20261022 as
select o.id,o.owner_id,o.shipping_integration_account_id as previous_account_id,
 o.updated_at as previous_updated_at,a.id as repaired_account_id,
 private.shipment_tracking_identity(o) as previous_identity_key
from public.fulfillment_orders o
join lateral (
 select min(a.id::text)::uuid as id,min(a.created_at) as created_at
 from public.integration_accounts a
 where a.owner_id=o.owner_id and a.provider='mrw' and a.enabled and a.status<>'disabled'
 having count(*)=1
) a on a.created_at<=o.label_created_at
where o.source_channel='shopify' and o.shipping_provider='mrw'
 and o.shipping_integration_account_id is null
 and o.label_created_at>=now()-interval '45 days'
 and o.label_cancelled_at is null and o.pii_purged_at is null
 and nullif(o.tracking_number,'') is not null and o.shipping_remote_id is not null
 and not exists(select 1 from public.shipment_tracking_state s where s.order_id=o.id);
revoke all on private.shopify_mrw_account_repair_20261022 from public,anon,authenticated;
do $$begin
 if (select count(*) from private.shopify_mrw_account_repair_20261022)<>8
 or (select count(distinct owner_id) from private.shopify_mrw_account_repair_20261022)<>1
 then raise exception 'Repair scope changed; review required';end if;
 if (select count(*) from public.fulfillment_orders o join private.shopify_mrw_account_repair_20261022 b on b.id=o.id
 where not private.shipment_tracking_terminal('mrw',o.tracking_status_code))<>7
 then raise exception 'Active scope changed; review required';end if;
end$$;
update public.fulfillment_orders o
set shipping_integration_account_id=b.repaired_account_id
from private.shopify_mrw_account_repair_20261022 b
where o.id=b.id and o.owner_id=b.owner_id and o.shipping_integration_account_id is null;
-- Seed only the reviewed seven non-terminal shipments, using the unchanged identity and owner rules.
insert into public.shipment_tracking_state(order_id,owner_id,account_id,provider,tracking_number,identity_key,label_created_at)
select o.id,o.owner_id,a.id,a.provider,o.tracking_number,private.shipment_tracking_identity(o),o.label_created_at
from public.fulfillment_orders o
join private.shopify_mrw_account_repair_20261022 b on b.id=o.id and b.owner_id=o.owner_id
join public.integration_accounts a on a.id=o.shipping_integration_account_id and a.owner_id=o.owner_id
join public.workspaces w on w.id=o.owner_id and w.status in ('active','trialing')
where a.enabled and a.status<>'disabled' and a.provider='mrw' and o.shipping_provider=a.provider
 and o.label_cancelled_at is null and o.pii_purged_at is null
 and not private.shipment_tracking_terminal(a.provider,o.tracking_status_code)
on conflict(order_id) do nothing;
insert into public.audit_logs(workspace_owner_id,module,action,entity_type,summary,details)
select owner_id,'orders','repair_shopify_carrier_account','fulfillment_orders',
 'Restored 8 Shopify/MRW carrier associations; queued 7 non-terminal shipments',
 jsonb_build_object('repair','shopify_mrw_account_repair_20261022','associations',8,'tracking_candidates',7)
from private.shopify_mrw_account_repair_20261022 group by owner_id;
commit;
