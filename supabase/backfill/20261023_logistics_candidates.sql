-- READ ONLY. Same candidate query used by the guarded backfill, with no customer data.
with orders as materialized (
 select o.*,private.shipment_tracking_identity(o) identity_key,
 (o.label_created_at is not null or o.sendcloud_parcel_id is not null or nullif(o.shipping_remote_id,'') is not null) has_label,
 s.normalized_state,s.event_at,s.observed_at,s.last_checked_at,raw.legacy_code,raw.legacy_event_at,raw.has_carrier_event,
 case when s.normalized_state is not null then s.normalized_state
 when o.label_created_at is not null and raw.legacy_event_at<o.label_created_at then null
 when lower(trim(coalesce(raw.legacy_code,'')))='shipped' and (not raw.has_carrier_event or o.label_created_at is null or raw.legacy_event_at is null or raw.legacy_event_at<=o.label_created_at) then null
 else private.tracking_legacy_state(o.shipping_provider,raw.legacy_code) end carrier_state
 from public.fulfillment_orders o left join public.shipment_tracking_state s
 on s.order_id=o.id and s.owner_id=o.owner_id and s.identity_key=private.shipment_tracking_identity(o)
 cross join lateral(select coalesce(nullif(s.raw_code,''),o.tracking_status_code) legacy_code,case when nullif(s.raw_code,'') is not null then s.event_at else o.tracking_updated_at end legacy_event_at,nullif(s.raw_code,'') is not null has_carrier_event) raw
), proofs as (
 select o.owner_id,o.id order_id,o.identity_key,'tracking'::text cause,
 coalesce(e.event_at,e.observed_at) evidence_at,(case when e.normalized_state is null then 'legacy_carrier_status' else 'normalized_history' end||case when e.event_at is null then '_observed' else '' end)::text basis,null::uuid report_id,null::uuid actor_id from orders o
 join public.shipment_tracking_events e on e.owner_id=o.owner_id and e.identity_key=o.identity_key
 where coalesce(e.normalized_state,case when (o.label_created_at is null or e.event_at is null or e.event_at>=o.label_created_at) and (lower(trim(coalesce(e.raw_code,'')))<>'shipped' or e.event_at>o.label_created_at) then private.tracking_legacy_state(o.shipping_provider,e.raw_code) end) in ('in_transit','out_for_delivery','delivered','exception','returned')
 union all
 select o.owner_id,o.id,o.identity_key,'tracking',coalesce(case when o.normalized_state is null then o.legacy_event_at else o.event_at end,o.observed_at,o.last_checked_at,timestamptz '2026-10-23 12:00:00+00'),
 case when o.normalized_state is not null then 'normalized_current' else 'legacy_carrier_status' end||case when (o.normalized_state is null and not o.has_carrier_event) or (case when o.normalized_state is null then o.legacy_event_at else o.event_at end) is null then '_observed' else '' end,null::uuid,null::uuid
 from orders o where o.carrier_state in ('in_transit','out_for_delivery','delivered','exception','returned')
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
select o.owner_id,o.id,o.identity_key,'historical',coalesce(o.fulfilled_at,o.tracking_updated_at,o.order_updated_at,o.order_created_at),null,case when o.has_label then 'pre_cutover_label_without_evidence' else 'pre_cutover_channel_history' end,o.source_channel,null::uuid,null::uuid
from orders o where (not o.has_label or (
 coalesce(o.label_created_at,o.order_created_at)<timestamptz '2026-10-23 12:00:00+00'-interval '7 days'
 and o.carrier_state is null and not exists(select 1 from public.shipment_tracking_events e where e.owner_id=o.owner_id and e.identity_key=o.identity_key and (e.normalized_state is not null or nullif(trim(e.raw_code),'') is not null))
 and not exists(select 1 from earliest e where e.owner_id=o.owner_id and e.order_id=o.id))) and o.label_cancelled_at is null
and lower(trim(coalesce(o.source_status,''))) in ('fulfilled','shipped','delivered')
and coalesce(o.carrier_state,'')<>'cancelled'
