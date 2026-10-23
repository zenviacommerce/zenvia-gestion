-- NOT EXECUTED. Owner review required. Use in the same transaction as schema installation.
-- Recount and regenerate this guard immediately before any authorized release.
set local timezone='UTC';
lock table public.fulfillment_orders,public.shipment_tracking_state,public.shipment_tracking_events,
 public.pickup_reports,public.pickup_report_items,private.pickup_document_signatures,private.pickup_report_exclusions in share mode;
create temporary table logistics_backfill_candidates on commit drop as
-- READ ONLY. Same candidate query used by the guarded backfill, with no customer data.
with orders as materialized (
 select o.*,private.shipment_tracking_identity(o) identity_key,
 (o.label_created_at is not null or o.sendcloud_parcel_id is not null or nullif(o.shipping_remote_id,'') is not null) has_label,
 s.normalized_state,s.event_at,s.observed_at,s.last_checked_at,
 coalesce(s.normalized_state,case when o.shipping_provider='mrw' then null else private.tracking_legacy_state(o.shipping_provider,o.tracking_status_code) end) carrier_state
 from public.fulfillment_orders o left join public.shipment_tracking_state s
 on s.order_id=o.id and s.owner_id=o.owner_id and s.identity_key=private.shipment_tracking_identity(o)
), proofs as (
 select o.owner_id,o.id order_id,o.identity_key,'tracking'::text cause,
 coalesce(e.event_at,e.observed_at) evidence_at,'normalized_history'::text basis,null::uuid report_id,null::uuid actor_id from orders o
 join public.shipment_tracking_events e on e.owner_id=o.owner_id and e.identity_key=o.identity_key
 where e.normalized_state in ('in_transit','out_for_delivery','delivered')
 union all
 select o.owner_id,o.id,o.identity_key,'tracking',coalesce(o.event_at,o.observed_at,o.last_checked_at,o.tracking_updated_at),
 case when o.normalized_state is null then 'legacy_carrier_status' else 'normalized_current' end,null::uuid,null::uuid
 from orders o where o.carrier_state in ('in_transit','out_for_delivery','delivered','returned')
 union all
 select o.owner_id,o.id,o.identity_key,'signed_report',sig.created_at,'signed_report',sig.report_id,sig.created_by
 from orders o join public.pickup_report_items pi on pi.owner_id=o.owner_id and pi.order_id=o.id
 join public.pickup_reports r on r.id=pi.report_id
 join private.pickup_document_signatures sig on sig.report_id=r.id
 cross join lateral jsonb_array_elements(private.pickup_report_effective(r.id)->'items') item
 where item->>'orderId'=o.id::text and item->>'carrier'=sig.carrier and item->>'trackingNumber'=o.tracking_number
 and ((item->>'shipmentIdentity'=o.identity_key) or (item->>'shipmentIdentity' is null and o.label_created_at<=r.created_at))
), earliest as (
 select distinct on (owner_id,order_id) * from proofs where evidence_at is not null
 order by owner_id,order_id,evidence_at,basis
)
select o.owner_id,o.id order_id,o.identity_key,'dispatch'::text candidate_type,e.evidence_at,e.cause,e.basis,o.source_channel,e.report_id,e.actor_id
from orders o join earliest e on e.owner_id=o.owner_id and e.order_id=o.id
where o.has_label and o.label_cancelled_at is null and o.pii_purged_at is null
and lower(trim(coalesce(o.source_status,''))) not in ('cancelled','canceled','cancelled_by_customer','cancelled_by_seller')
and coalesce(o.carrier_state,'')<>'cancelled'
union all
select o.owner_id,o.id,o.identity_key,'historical',coalesce(o.fulfilled_at,o.tracking_updated_at,o.order_updated_at,o.order_created_at),null,'pre_cutover_channel_history',o.source_channel,null::uuid,null::uuid
from orders o where not o.has_label and o.label_cancelled_at is null
and lower(trim(coalesce(o.source_status,''))) in ('fulfilled','shipped','delivered')
and coalesce(o.carrier_state,'')<>'cancelled'
;
do $$begin
 if (select count(*) from logistics_backfill_candidates)<>947 or
 (select count(*) from logistics_backfill_candidates where candidate_type='dispatch')<>356 or
 (select count(*) from logistics_backfill_candidates where candidate_type='historical')<>591 or
 (select md5(string_agg(owner_id::text||'/'||order_id::text||'/'||identity_key||'/'||candidate_type||'/'||coalesce(evidence_at::text,'')||'/'||basis,',' order by owner_id,order_id,candidate_type)) from logistics_backfill_candidates)<>'f28630ac6598c7f4c37562b2de4f37b9'
 then raise exception 'LOGISTICS_BACKFILL_CHANGED_RECOUNT_REQUIRED';end if;
end$$;
insert into private.order_dispatch_evidence(owner_id,identity_key,order_id,dispatched_at,cause,evidence_basis,report_id,actor_id)
select owner_id,identity_key,order_id,evidence_at,cause,basis,report_id,actor_id from logistics_backfill_candidates where candidate_type='dispatch'
on conflict do nothing;
insert into private.order_logistics_legacy(owner_id,identity_key,order_id,historical_date)
select owner_id,identity_key,order_id,evidence_at from logistics_backfill_candidates where candidate_type='historical'
on conflict do nothing;
select 'dispatch' kind,count(*) rows from private.order_dispatch_evidence union all select 'historical',count(*) from private.order_logistics_legacy;
