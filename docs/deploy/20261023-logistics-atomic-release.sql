-- REVIEW CANDIDATE ONLY. No production execution authorized.
-- Atomic schema + counted backfill: either everything commits or nothing does.
-- Apply this complete body as ONE migration transaction; never apply the schema alone.
begin;
set local timezone='UTC';
set local lock_timeout='3s';
set local zenvia.logistics_release_bundle='atomic';
lock table public.fulfillment_orders,public.shipment_tracking_state,public.shipment_tracking_events,
 public.pickup_reports,public.pickup_report_items,private.pickup_document_signatures,private.pickup_report_exclusions in share mode;
-- Guard the exact canonical five-order proposal before changing any definition.
create temporary table logistics_approved_reclassifications on commit drop as
WITH ranked AS (
 SELECT o.*, o.owner_id::text||':'||CASE WHEN o.source_channel IN ('amazon','shopify') AND trim(coalesce(o.order_number,''))<>'' THEN o.source_channel||':'||trim(o.order_number) ELSE o.id::text END AS dedupe_key,
  row_number() OVER (
   PARTITION BY CASE
      WHEN o.source_channel IN ('amazon','shopify') AND trim(coalesce(o.order_number,''))<>''
        THEN o.source_channel||':'||trim(o.order_number)
      ELSE o.id::text
   END
   ORDER BY
    ((CASE WHEN coalesce(nullif(o.sendcloud_remote_id,''),o.sendcloud_id,'')<>'' AND coalesce(nullif(o.sendcloud_remote_id,''),o.sendcloud_id) NOT LIKE 'amazon:%' THEN 40 ELSE 0 END)
    +(CASE WHEN o.shipping_integration_account_id IS NOT NULL THEN 20 ELSE 0 END)
    +(CASE WHEN nullif(o.customer_name,'') IS NOT NULL THEN 8 ELSE 0 END)
    +(CASE WHEN nullif(o.customer_phone,'') IS NOT NULL THEN 4 ELSE 0 END)
    +(CASE WHEN nullif(o.customer_email,'') IS NOT NULL THEN 2 ELSE 0 END)
    +(CASE WHEN nullif(o.shipping_address->>'address_line_1','') IS NOT NULL THEN 8 ELSE 0 END)
    +(CASE WHEN nullif(o.shipping_address->>'postal_code','') IS NOT NULL THEN 4 ELSE 0 END)
    +(CASE WHEN o.raw_payload#>>'{shipping_details,measurement,weight,value}' ~ '^[0-9]+([.][0-9]+)?$' THEN CASE WHEN (o.raw_payload#>>'{shipping_details,measurement,weight,value}')::numeric>0 THEN 4 ELSE 0 END ELSE 0 END)
    +(CASE WHEN jsonb_typeof(o.items)='array' AND jsonb_array_length(o.items)>0 THEN 2 ELSE 0 END)
    +(CASE WHEN o.sendcloud_parcel_id IS NOT NULL OR o.shipping_remote_id IS NOT NULL OR o.label_created_at IS NOT NULL THEN 50 ELSE 0 END)
    ) DESC,
    o.order_created_at DESC NULLS LAST,o.id DESC
  ) AS dedupe_rank
 FROM public.fulfillment_orders o WHERE o.owner_id='7461b2b7-f383-460d-b1c7-6ccbb52e42b2'::uuid
),
grouped AS MATERIALIZED (
 SELECT dedupe_key,jsonb_agg(to_jsonb(r) ORDER BY dedupe_rank) copies FROM ranked r GROUP BY dedupe_key
),
merged_json AS MATERIALIZED (
 SELECT copies->0||jsonb_build_object(
'source_integration_account_id',(SELECT v->'source_integration_account_id' FROM jsonb_array_elements(copies) WITH ORDINALITY a(v,n) WHERE v->'source_integration_account_id' IS NOT NULL AND v->'source_integration_account_id'<>'null'::jsonb AND coalesce(v->>'source_integration_account_id','')<>'' ORDER BY n LIMIT 1),
'customer_name',(SELECT v->'customer_name' FROM jsonb_array_elements(copies) WITH ORDINALITY a(v,n) WHERE v->'customer_name' IS NOT NULL AND v->'customer_name'<>'null'::jsonb AND coalesce(v->>'customer_name','')<>'' ORDER BY n LIMIT 1),
'customer_email',(SELECT v->'customer_email' FROM jsonb_array_elements(copies) WITH ORDINALITY a(v,n) WHERE v->'customer_email' IS NOT NULL AND v->'customer_email'<>'null'::jsonb AND coalesce(v->>'customer_email','')<>'' ORDER BY n LIMIT 1),
'customer_phone',(SELECT v->'customer_phone' FROM jsonb_array_elements(copies) WITH ORDINALITY a(v,n) WHERE v->'customer_phone' IS NOT NULL AND v->'customer_phone'<>'null'::jsonb AND coalesce(v->>'customer_phone','')<>'' ORDER BY n LIMIT 1),
'currency',(SELECT v->'currency' FROM jsonb_array_elements(copies) WITH ORDINALITY a(v,n) WHERE v->'currency' IS NOT NULL AND v->'currency'<>'null'::jsonb AND coalesce(v->>'currency','')<>'' ORDER BY n LIMIT 1),
'pii_purged_at',(SELECT v->'pii_purged_at' FROM jsonb_array_elements(copies) WITH ORDINALITY a(v,n) WHERE v->'pii_purged_at' IS NOT NULL AND v->'pii_purged_at'<>'null'::jsonb AND coalesce(v->>'pii_purged_at','')<>'' ORDER BY n LIMIT 1),
'destination_country_code',(SELECT v->'destination_country_code' FROM jsonb_array_elements(copies) WITH ORDINALITY a(v,n) WHERE v->'destination_country_code' IS NOT NULL AND v->'destination_country_code'<>'null'::jsonb AND coalesce(v->>'destination_country_code','')<>'' ORDER BY n LIMIT 1),
'package_length_cm',(SELECT v->'package_length_cm' FROM jsonb_array_elements(copies) WITH ORDINALITY a(v,n) WHERE v->'package_length_cm' IS NOT NULL AND v->'package_length_cm'<>'null'::jsonb AND coalesce(v->>'package_length_cm','')<>'' ORDER BY n LIMIT 1),
'package_width_cm',(SELECT v->'package_width_cm' FROM jsonb_array_elements(copies) WITH ORDINALITY a(v,n) WHERE v->'package_width_cm' IS NOT NULL AND v->'package_width_cm'<>'null'::jsonb AND coalesce(v->>'package_width_cm','')<>'' ORDER BY n LIMIT 1),
'package_height_cm',(SELECT v->'package_height_cm' FROM jsonb_array_elements(copies) WITH ORDINALITY a(v,n) WHERE v->'package_height_cm' IS NOT NULL AND v->'package_height_cm'<>'null'::jsonb AND coalesce(v->>'package_height_cm','')<>'' ORDER BY n LIMIT 1),
'total_amount',(SELECT v->'total_amount' FROM jsonb_array_elements(copies) WITH ORDINALITY a(v,n) WHERE v->'total_amount' IS NOT NULL AND v->'total_amount'<>'null'::jsonb AND coalesce(v->>'total_amount','')<>'' ORDER BY n LIMIT 1),
'shipping_address',coalesce((SELECT v->'shipping_address' FROM jsonb_array_elements(copies) WITH ORDINALITY a(v,n) WHERE jsonb_typeof(v->'shipping_address')='object' AND v->'shipping_address'<>'{}'::jsonb ORDER BY n LIMIT 1),'{}'::jsonb),
'billing_address',coalesce((SELECT v->'billing_address' FROM jsonb_array_elements(copies) WITH ORDINALITY a(v,n) WHERE jsonb_typeof(v->'billing_address')='object' AND v->'billing_address'<>'{}'::jsonb ORDER BY n LIMIT 1),'{}'::jsonb),
'items',coalesce((SELECT v->'items' FROM jsonb_array_elements(copies) WITH ORDINALITY a(v,n) WHERE jsonb_typeof(v->'items')='array' AND v->'items'<>'[]'::jsonb ORDER BY n LIMIT 1),'[]'::jsonb),
'raw_payload',coalesce(nullif(copies->0->'raw_payload','null'::jsonb),'{}'::jsonb)||jsonb_build_object('shipping_details',coalesce(nullif(copies->0#>'{raw_payload,shipping_details}','null'::jsonb),'{}'::jsonb)||jsonb_build_object('measurement',coalesce(nullif(copies->0#>'{raw_payload,shipping_details,measurement}','null'::jsonb),'{}'::jsonb)||jsonb_build_object('weight',(SELECT v#>'{raw_payload,shipping_details,measurement,weight}' FROM jsonb_array_elements(copies) WITH ORDINALITY a(v,n) WHERE v#>>'{raw_payload,shipping_details,measurement,weight,value}' ~ '^[0-9]+([.][0-9]+)?$' ORDER BY n LIMIT 1))))
) AS data FROM grouped
),
merged AS MATERIALIZED (
 SELECT populated.* FROM merged_json CROSS JOIN LATERAL
   jsonb_populate_record(NULL::public.fulfillment_orders,
   CASE WHEN data->>'pii_purged_at' IS NOT NULL THEN data||jsonb_build_object(
     'customer_name',NULL,'customer_email',NULL,'customer_phone',NULL,
     'shipping_address','{}'::jsonb,'billing_address','{}'::jsonb,'raw_payload','{}'::jsonb,
     'tracking_number',NULL,'tracking_url',NULL,'shipping_label_url',NULL,'tracking_status_message',NULL,'amazon_tracking_sync_error',NULL,'shopify_tracking_sync_error',NULL,'shopify_tracking_synced_number',NULL,'sendcloud_id','amazon-purged:'||(data->>'id'),
     'shipping_remote_id',NULL,'sendcloud_parcel_id',NULL,'sendcloud_shipment_id',NULL,'sendcloud_remote_id',NULL,
     'items',coalesce((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('item_id',CASE WHEN jsonb_typeof(item->'item_id') IN ('string','number') THEN item->'item_id' END,'sku',CASE WHEN jsonb_typeof(item->'sku') IN ('string') THEN item->'sku' END,'product_id',CASE WHEN jsonb_typeof(item->'product_id') IN ('string') THEN item->'product_id' END,'quantity',CASE WHEN jsonb_typeof(item->'quantity') IN ('number') THEN item->'quantity' END,'unit_price',CASE WHEN jsonb_typeof(item->'unit_price')='number' THEN item->'unit_price' WHEN jsonb_typeof(item->'unit_price')='object' THEN jsonb_strip_nulls(jsonb_build_object('value',CASE WHEN item->'unit_price'->>'value' ~ '^-?[0-9]+([.][0-9]+)?$' THEN (item->'unit_price'->>'value')::numeric END,'currency',CASE WHEN item->'unit_price'->>'currency' ~ '^[A-Z]{3}$' THEN item->'unit_price'->>'currency' END)) END,'total_price',CASE WHEN jsonb_typeof(item->'total_price')='number' THEN item->'total_price' WHEN jsonb_typeof(item->'total_price')='object' THEN jsonb_strip_nulls(jsonb_build_object('value',CASE WHEN item->'total_price'->>'value' ~ '^-?[0-9]+([.][0-9]+)?$' THEN (item->'total_price'->>'value')::numeric END,'currency',CASE WHEN item->'total_price'->>'currency' ~ '^[A-Z]{3}$' THEN item->'total_price'->>'currency' END)) END))) FROM jsonb_array_elements(coalesce(data->'items','[]'::jsonb)) item),'[]'::jsonb)
   ) ELSE data END) AS populated
),
normalized AS (
 SELECT r.*, st.normalized_state as tracking_normalized_state,st.raw_code as tracking_raw_code,st.raw_message as tracking_raw_message,st.event_at as tracking_event_at,st.raw_event_time as tracking_event_time_raw,st.observed_at as tracking_observed_at,st.movement_at as tracking_movement_at,st.last_checked_at as tracking_checked_at,st.last_error as tracking_error,
   lower(trim(coalesce(r.source_status,''))) AS source_code,
   lower(regexp_replace(concat_ws(' ',r.tracking_status_code,r.tracking_status_message),'[_-]+',' ','g')) AS tracking_text,
   (r.sendcloud_parcel_id IS NOT NULL OR nullif(r.shipping_remote_id,'') IS NOT NULL OR r.label_created_at IS NOT NULL) AS has_label,
   upper(coalesce(nullif(r.destination_country_code,''),nullif(r.shipping_address->>'country_code',''),'XX')) AS country_code,
   CASE
     WHEN regexp_replace(lower(coalesce(r.carrier_code,r.carrier_name,'')),'[^a-z0-9]','','g')='correosexpress' THEN 'correos express'
     WHEN regexp_replace(lower(coalesce(r.carrier_code,r.carrier_name,'')),'[^a-z0-9]','','g')='correos' THEN 'correos'
     WHEN regexp_replace(lower(coalesce(r.carrier_code,r.carrier_name,'')),'[^a-z0-9]','','g')='mrw' THEN 'mrw'
     WHEN nullif(r.carrier_name,'') IS NOT NULL THEN lower(r.carrier_name)
     WHEN lower(coalesce(r.carrier_code,split_part(r.shipping_option_code,':',1),'')) LIKE '%correos%' THEN 'correos'
     WHEN lower(coalesce(r.carrier_code,split_part(r.shipping_option_code,':',1),'')) LIKE '%mrw%' THEN 'mrw'
     ELSE lower(coalesce(nullif(r.carrier_code,''),split_part(r.shipping_option_code,':',1),'—'))
   END AS carrier_label
 FROM merged r LEFT JOIN public.shipment_tracking_state st ON st.order_id=r.id AND st.owner_id=r.owner_id AND r.pii_purged_at IS NULL AND st.account_id=r.shipping_integration_account_id AND st.identity_key=md5(jsonb_build_array(r.owner_id,r.shipping_integration_account_id,r.shipping_provider,r.tracking_number,r.shipping_remote_id,r.sendcloud_parcel_id,r.label_created_at,r.label_cancelled_at)::text)
 WHERE NOT (r.source_channel='amazon' AND
     regexp_replace(lower(coalesce(r.source_status,'')),'[^a-z]','','g')
       IN ('pending','pendingavailability','invoiceunconfirmed'))
),
flags AS (
 SELECT n.*,
  (n.source_code IN ('cancelled','canceled','cancelled_by_customer','cancelled_by_seller') OR coalesce(n.tracking_normalized_state,private.tracking_legacy_state(n.shipping_provider,n.tracking_status_code))='cancelled') AS is_cancelled,
  (n.source_code IN ('fulfilled','shipped','delivered') OR
    (n.has_label AND n.tracking_text<>'' AND
      NOT (n.tracking_text LIKE ANY(ARRAY[
        '%created%','%pending%','%ready to send%','%ready for shipment%',
        '%announced%','%being announced%','%no label%',
        '%announcement failed%','%error collecting%'])))) AS has_progress,
  CASE coalesce(n.tracking_normalized_state,CASE WHEN n.shipping_provider='mrw' THEN NULL ELSE private.tracking_legacy_state(n.shipping_provider,n.tracking_status_code) END)
 WHEN 'pre_transit' THEN 'ready' WHEN 'in_transit' THEN 'transit' WHEN 'out_for_delivery' THEN 'route'
 WHEN 'delivered' THEN 'delivered' WHEN 'exception' THEN 'issue' WHEN 'returned' THEN 'returned' WHEN 'cancelled' THEN 'cancelled' ELSE 'none' END AS tracking_class
 FROM normalized n
),
classified AS (
 SELECT f.*,
  CASE WHEN f.raw_payload#>>'{shipping_details,measurement,weight,value}' ~ '^[0-9]+([.][0-9]+)?$'
    THEN (f.raw_payload#>>'{shipping_details,measurement,weight,value}')::numeric * CASE lower(f.raw_payload#>>'{shipping_details,measurement,weight,unit}') WHEN 'g' THEN 0.001 WHEN 'lb' THEN 0.45359237 WHEN 'lbs' THEN 0.45359237 ELSE 1 END END AS weight_sort,
  (SELECT coalesce(sum(CASE WHEN item->>'quantity' ~ '^-?[0-9]+([.][0-9]+)?$' AND (item->>'quantity')::numeric<>0 THEN (item->>'quantity')::numeric ELSE 1 END),0) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(f.items)='array' THEN f.items ELSE '[]'::jsonb END) item) AS units_sort,
  CASE WHEN NOT f.has_label THEN '' WHEN f.label_printed_at IS NOT NULL THEN '2-'||f.label_printed_at::text WHEN f.label_print_state_known THEN '1' ELSE '0' END AS print_sort,
  CASE
   WHEN f.is_cancelled THEN 'cancelled'
   WHEN f.has_progress THEN 'shipped'
   WHEN f.has_label THEN 'labelled'
   ELSE 'pending'
  END AS order_state,
  (f.order_created_at AT TIME ZONE 'Europe/Madrid')::date AS created_day,
  (coalesce(f.fulfilled_at,f.tracking_updated_at,f.label_created_at,f.order_updated_at,f.order_created_at) AT TIME ZONE 'Europe/Madrid')::date AS dispatched_day,
  (coalesce(f.shipping_cost_recorded_at,f.fulfilled_at,f.label_created_at,f.tracking_updated_at,f.order_created_at) AT TIME ZONE 'Europe/Madrid')::date AS shipping_cost_day,
  coalesce((('{"ES":21,"PT":23,"FR":20,"DE":19,"IT":22,"NL":21,"BE":21,"AT":20,"IE":23,"PL":23,"CZ":21,"GR":24,"HU":27,"RO":21,"FI":25.5,"SE":25,"DK":25,"HR":25,"SI":22,"SK":23,"LT":21,"LV":21,"EE":24,"BG":20,"CY":19,"MT":18,"LU":17,"GB":20}'::jsonb)->>
    upper(coalesce(nullif(f.destination_country_code,''),nullif(f.shipping_address->>'country_code',''),'XX')))::numeric,0) AS vat_percent
 FROM flags f
)
, evidence as (
 select c.*,(c.tracking_class in ('transit','route','delivered','pickup') or exists(
 select 1 from public.shipment_tracking_events e where e.owner_id=c.owner_id and e.identity_key=md5(jsonb_build_array(c.owner_id,c.shipping_integration_account_id,c.shipping_provider,c.tracking_number,c.shipping_remote_id,c.sendcloud_parcel_id,c.label_created_at,c.label_cancelled_at)::text)
 and e.normalized_state in ('picked_up','in_transit','out_for_delivery','delivered'))) as movement_proof
 from classified c
), candidates AS (-- READ ONLY. Same candidate query used by the guarded backfill, with no customer data.
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
), proposed AS (select e.*,case when is_cancelled or label_cancelled_at is not null then 'cancelled' when has_label and exists(select 1 from candidates x where x.candidate_type='dispatch' and x.owner_id=e.owner_id and x.identity_key=md5(jsonb_build_array(e.owner_id,e.shipping_integration_account_id,e.shipping_provider,e.tracking_number,e.shipping_remote_id,e.sendcloud_parcel_id,e.label_created_at,e.label_cancelled_at)::text)) then 'shipped' when exists(select 1 from candidates x where x.candidate_type='historical' and x.owner_id=e.owner_id and x.order_id=e.id) then 'shipped' when has_label then 'labelled' else 'pending' end proposed_state from evidence e) select id,order_number,source_channel,tracking_number,shipping_provider,label_created_at,tracking_status_code,order_state before_state,proposed_state after_state from proposed where order_state<>proposed_state order by source_channel,order_number;

do $$begin
 if (select count(*) from logistics_approved_reclassifications)<>5 or
 (select md5(string_agg(id::text||'/'||coalesce(tracking_number,'')||'/'||coalesce(label_created_at::text,'')||'/'||before_state||'/'||after_state,',' order by id)) from logistics_approved_reclassifications)<>'2bf159987fcade696a4dfdaa77c94ede'
 then raise exception 'LOGISTICS_BACKFILL_CHANGED_RECOUNT_REQUIRED';end if;
end$$;
-- Definition-only installation: historical evidence is populated separately after an approved count.
set local lock_timeout='3s';
do $$begin if current_setting('zenvia.logistics_release_bundle',true) is distinct from 'atomic' and exists(select 1 from public.fulfillment_orders) then raise exception 'LOGISTICS_ATOMIC_RELEASE_REQUIRED';end if;end$$;
create table private.order_dispatch_evidence(
 owner_id uuid not null references public.workspaces(id), identity_key text not null,
 order_id uuid not null, dispatched_at timestamptz not null,
 cause text not null check(cause in ('tracking','signed_report','manual')),
 evidence_basis text not null default 'live',actor_id uuid, report_id uuid references public.pickup_reports(id),
 recorded_at timestamptz not null default now(),primary key(owner_id,identity_key)
);
alter table private.order_dispatch_evidence enable row level security;
revoke all on private.order_dispatch_evidence from public,anon,authenticated;
create trigger order_dispatch_immutable before update or delete on private.order_dispatch_evidence for each row execute function private.pickup_report_immutable();

-- Imported completed orders with no local label remain read-only history after cutover.
-- This is deliberately not physical dispatch evidence.
create table private.order_logistics_legacy(
 owner_id uuid not null references public.workspaces(id),identity_key text not null,
 order_id uuid not null,historical_date timestamptz,basis text not null default 'pre_cutover_channel_history' check(basis in ('pre_cutover_channel_history','pre_cutover_label_without_evidence')),recorded_at timestamptz not null default now(),primary key(owner_id,order_id)
);
alter table private.order_logistics_legacy enable row level security;
revoke all on private.order_logistics_legacy from public,anon,authenticated;
create trigger order_logistics_legacy_immutable before update or delete on private.order_logistics_legacy for each row execute function private.pickup_report_immutable();

-- Evidence-only events/manual actions must invalidate cached classification too.
create function private.order_logistics_projection_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if to_regclass('private.orders_projection_dirty') is not null then
 insert into private.orders_projection_dirty(owner_id,group_key)
 select new.owner_id,private.orders_dashboard_group_key(o.source_channel,o.order_number,o.id) from public.fulfillment_orders o where o.id=new.order_id and o.owner_id=new.owner_id;
 end if;
 return new;
end$$;
create trigger order_dispatch_projection_changed after insert on private.order_dispatch_evidence for each row execute function private.order_logistics_projection_changed();
create trigger order_legacy_projection_changed after insert on private.order_logistics_legacy for each row execute function private.order_logistics_projection_changed();
revoke all on function private.order_logistics_projection_changed() from public,anon,authenticated;

create function private.order_logistics_identity(p_row jsonb) returns text language sql immutable set search_path='' as $$
 select private.shipment_tracking_identity(jsonb_populate_record(null::public.fulfillment_orders,p_row));
$$;
create function private.order_logistics_evidence(p_row jsonb) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('dispatchedAt',d.dispatched_at,'cause',d.cause,'actorId',d.actor_id,'reportId',d.report_id,'basis',d.evidence_basis,'observedOnly',d.evidence_basis like '%_observed')
 from private.order_dispatch_evidence d where d.owner_id=(p_row->>'owner_id')::uuid
 and d.identity_key=private.order_logistics_identity(p_row)
 and p_row->>'label_cancelled_at' is null and p_row->>'pii_purged_at' is null
 and (p_row->>'label_created_at' is not null or p_row->>'sendcloud_parcel_id' is not null or nullif(p_row->>'shipping_remote_id','') is not null)
 union all
 select jsonb_build_object('historical',true,'historicalDate',h.historical_date,'basis',h.basis) from private.order_logistics_legacy h
 where h.owner_id=(p_row->>'owner_id')::uuid and h.order_id=(p_row->>'id')::uuid and h.identity_key=private.order_logistics_identity(p_row)
 and (h.basis='pre_cutover_label_without_evidence' or (p_row->>'label_created_at' is null and p_row->>'sendcloud_parcel_id' is null and nullif(p_row->>'shipping_remote_id','') is null))
 and not exists(select 1 from private.order_dispatch_evidence d where d.owner_id=h.owner_id and d.identity_key=h.identity_key);
$$;
create function private.order_logistics_state(p_row jsonb) returns text language sql stable security definer set search_path='' as $$
 select case
 when lower(trim(coalesce(p_row->>'source_status',''))) in ('cancelled','canceled','cancelled_by_customer','cancelled_by_seller')
 or p_row->>'label_cancelled_at' is not null or coalesce(p_row->>'tracking_normalized_state',
 (select s.normalized_state from public.shipment_tracking_state s where s.owner_id=(p_row->>'owner_id')::uuid and s.order_id=(p_row->>'id')::uuid and s.identity_key=private.order_logistics_identity(p_row)),
 private.tracking_legacy_state(p_row->>'shipping_provider',p_row->>'tracking_status_code'))='cancelled' then 'cancelled'
 when private.order_logistics_evidence(p_row)->>'historical'='true' then 'shipped'
 when not (p_row->>'label_created_at' is not null or p_row->>'sendcloud_parcel_id' is not null or nullif(p_row->>'shipping_remote_id','') is not null) then 'pending'
 when private.order_logistics_evidence(p_row) is not null then 'shipped'
 else 'labelled' end;
$$;

-- Select the exact label-bearing sibling, using the report's existing canonical scope.
create function private.order_report_identity(p_owner uuid,p_order uuid,p_tracking text) returns text language sql stable security definer set search_path='' as $$
 select private.shipment_tracking_identity(o) from public.fulfillment_orders requested
 join public.fulfillment_orders o on o.owner_id=requested.owner_id and (o.id=requested.id or (
 requested.source_channel in ('amazon','shopify') and nullif(trim(requested.order_number),'') is not null
 and o.source_channel=requested.source_channel and o.source_integration_account_id is not distinct from requested.source_integration_account_id
 and trim(o.order_number)=trim(requested.order_number)))
 where requested.id=p_order and requested.owner_id=p_owner and o.tracking_number=p_tracking and o.label_cancelled_at is null
 order by o.label_created_at desc nulls last,o.id limit 1;
$$;

-- An identity-scoped physical event proves carrier possession, including exceptions/returns.
-- Raw SHIPPED is ambiguous at label creation: require a later movement timestamp.
create function private.order_tracking_possession(p_state text,p_provider text,p_code text,p_label timestamptz,p_tracking timestamptz,p_carrier_event boolean default false)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(case when p_state is not null then p_state in ('in_transit','out_for_delivery','delivered','exception','returned')
 when p_label is not null and p_tracking<p_label then false
 when lower(trim(coalesce(p_code,'')))='shipped' and (not p_carrier_event or p_label is null or p_tracking is null or p_tracking<=p_label) then false
 else private.tracking_legacy_state(p_provider,p_code) in ('in_transit','out_for_delivery','delivered','exception','returned') end,false);
$$;
create function private.order_dispatch_from_tracking() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.fulfillment_orders;v_at timestamptz;v_basis text;begin
 select * into o from public.fulfillment_orders where id=new.order_id and owner_id=new.owner_id for update;
 if not found or (o.label_created_at is null and o.sendcloud_parcel_id is null and nullif(o.shipping_remote_id,'') is null) or o.label_cancelled_at is not null or o.pii_purged_at is not null or private.shipment_tracking_identity(o)<>new.identity_key then return new;end if;
 if not private.order_tracking_possession(new.normalized_state,o.shipping_provider,coalesce(nullif(new.raw_code,''),o.tracking_status_code),o.label_created_at,case when nullif(new.raw_code,'') is null then o.tracking_updated_at else new.event_at end,nullif(new.raw_code,'') is not null) then return new;end if;
 v_at:=case when new.normalized_state is null and nullif(new.raw_code,'') is null then o.tracking_updated_at else new.event_at end;
 v_basis:=case when new.normalized_state is null then 'legacy_carrier_status' when TG_TABLE_NAME='shipment_tracking_events' then 'normalized_history' else 'normalized_current' end;
 if v_at is null or (new.normalized_state is null and nullif(new.raw_code,'') is null) then v_basis:=v_basis||'_observed';end if;
 insert into private.order_dispatch_evidence(owner_id,identity_key,order_id,dispatched_at,cause,evidence_basis)
 values(o.owner_id,new.identity_key,o.id,coalesce(v_at,new.observed_at,now()),'tracking',v_basis) on conflict do nothing;
 return new;
end$$;
create trigger order_dispatch_tracking after insert or update on public.shipment_tracking_state for each row execute function private.order_dispatch_from_tracking();
create trigger order_dispatch_tracking_event after insert on public.shipment_tracking_events for each row execute function private.order_dispatch_from_tracking();

-- Legacy imports/terminal MRW updates may have no normalized row yet.
create function private.order_dispatch_from_legacy_tracking() returns trigger language plpgsql security definer set search_path='' as $$
declare normalized text;begin
 if (new.label_created_at is null and new.sendcloud_parcel_id is null and nullif(new.shipping_remote_id,'') is null) or new.label_cancelled_at is not null or new.pii_purged_at is not null then return new;end if;
 if TG_OP='UPDATE' and private.shipment_tracking_identity(new) is distinct from private.shipment_tracking_identity(old)
 and new.tracking_status_code is not distinct from old.tracking_status_code and new.tracking_updated_at is not distinct from old.tracking_updated_at then return new;end if;
 select normalized_state into normalized from public.shipment_tracking_state where order_id=new.id and owner_id=new.owner_id and identity_key=private.shipment_tracking_identity(new);
 if normalized is not null or not private.order_tracking_possession(null,new.shipping_provider,new.tracking_status_code,new.label_created_at,new.tracking_updated_at) then return new;end if;
 insert into private.order_dispatch_evidence(owner_id,identity_key,order_id,dispatched_at,cause,evidence_basis)
 values(new.owner_id,private.shipment_tracking_identity(new),new.id,coalesce(new.tracking_updated_at,now()),'tracking','legacy_carrier_status_observed') on conflict do nothing;
 return new;
end$$;
create trigger order_dispatch_legacy_tracking after insert or update of tracking_status_code,tracking_updated_at,label_created_at,label_cancelled_at,shipping_remote_id,sendcloud_parcel_id,shipping_provider,shipping_integration_account_id,tracking_number on public.fulfillment_orders for each row execute function private.order_dispatch_from_legacy_tracking();
revoke all on function private.order_tracking_possession(text,text,text,timestamptz,timestamptz,boolean),private.order_dispatch_from_legacy_tracking() from public,anon,authenticated;

create function private.order_dispatch_from_signature() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.fulfillment_orders;item jsonb;v_expected jsonb;begin
 select op.input->'_logisticsIdentities' into v_expected from private.pickup_document_operations op
 where op.owner_id=new.owner_id and op.request_id=new.request_id and op.report_id=new.report_id;
 -- Same order lock order as report creation and manual dispatch. Compare again after locking.
 perform f.id from public.fulfillment_orders f where f.owner_id=new.owner_id and exists(
 select 1 from jsonb_array_elements(private.pickup_report_effective(new.report_id)->'items') i
 where i->>'carrier'=new.carrier and (f.id=(i->>'orderId')::uuid or private.shipment_tracking_identity(f)=v_expected->>(i->>'orderId')))
 order by f.id for update;
 for item in select i from jsonb_array_elements(private.pickup_report_effective(new.report_id)->'items') i where i->>'carrier'=new.carrier loop
 if v_expected->>(item->>'orderId') is null or v_expected->>(item->>'orderId') is distinct from private.order_report_identity(new.owner_id,(item->>'orderId')::uuid,item->>'trackingNumber') then raise exception 'LOGISTICS_REPORT_LABEL_CHANGED';end if;
 select * into o from public.fulfillment_orders f where f.owner_id=new.owner_id and private.shipment_tracking_identity(f)=v_expected->>(item->>'orderId') and f.label_cancelled_at is null and f.pii_purged_at is null order by f.id limit 1;
 if not found then raise exception 'LOGISTICS_REPORT_LABEL_CHANGED';end if;
 insert into private.order_dispatch_evidence(owner_id,identity_key,order_id,dispatched_at,cause,actor_id,report_id)
 values(o.owner_id,private.shipment_tracking_identity(o),o.id,new.created_at,'signed_report',new.created_by,new.report_id) on conflict do nothing;
 end loop;return new;
end$$;
create trigger order_dispatch_signature after insert on private.pickup_document_signatures for each row execute function private.order_dispatch_from_signature();

create function public.order_logistics_mark_sent(p_items jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=private.pickup_report_owner();o public.fulfillment_orders;v_count integer:=0;v_total integer;begin
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'LOGISTICS_INVALID_SELECTION';end if;
 v_total:=jsonb_array_length(p_items);
 if v_total not between 1 and 2000 or (select count(distinct i->>'id') from jsonb_array_elements(p_items)i)<>v_total then raise exception 'LOGISTICS_INVALID_SELECTION';end if;
 perform f.id from public.fulfillment_orders f where f.owner_id=v_owner and f.id in (select (i->>'id')::uuid from jsonb_array_elements(p_items)i) order by f.id for update;
 if (select count(*) from public.fulfillment_orders f where f.owner_id=v_owner and f.id in (select (i->>'id')::uuid from jsonb_array_elements(p_items)i))<>v_total then raise exception 'LOGISTICS_SELECTION_CHANGED';end if;
 for o in select f.* from public.fulfillment_orders f where f.owner_id=v_owner and f.id in (select (i->>'id')::uuid from jsonb_array_elements(p_items)i) order by f.id loop
 if not exists(select 1 from jsonb_array_elements(p_items)i where i->>'id'=o.id::text and i->>'identity'=private.shipment_tracking_identity(o)) then raise exception 'LOGISTICS_LABEL_CHANGED';end if;
 if (o.label_created_at is null and o.sendcloud_parcel_id is null and nullif(o.shipping_remote_id,'') is null) or private.order_logistics_state(to_jsonb(o)) not in ('labelled','shipped') or o.pii_purged_at is not null then raise exception 'LOGISTICS_LABEL_INACTIVE';end if;
 insert into private.order_dispatch_evidence(owner_id,identity_key,order_id,dispatched_at,cause,actor_id)
 values(v_owner,private.shipment_tracking_identity(o),o.id,now(),'manual',auth.uid()) on conflict do nothing;
 if found then
 v_count:=v_count+1;
 insert into public.audit_logs(workspace_owner_id,actor_user_id,module,action,entity_type,entity_id,entity_label,summary,details)
 values(v_owner,auth.uid(),'orders','mark_shipped','fulfillment_order',o.id::text,o.order_number,'Pedido marcado como enviado',jsonb_build_object('identity',private.shipment_tracking_identity(o),'cause','manual','dispatchedAt',now()));
 end if;end loop;
 return jsonb_build_object('marked',v_count,'selected',v_total);
end$$;
revoke all on function public.order_logistics_mark_sent(jsonb) from public,anon;
grant execute on function public.order_logistics_mark_sent(jsonb) to authenticated;

-- Scope the direct Summary/list read to the same server evidence as workbench RPCs.
create function public.order_logistics_read(p_ids uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_owner uuid:=private.pickup_report_owner();begin
 if p_ids is null or cardinality(p_ids)>10000 then raise exception 'LOGISTICS_INVALID_SELECTION';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'logistics_identity',private.shipment_tracking_identity(o),
 'logistics',private.order_logistics_evidence(to_jsonb(o)),'logistics_state',private.order_logistics_state(to_jsonb(o))))
 from public.fulfillment_orders o where o.owner_id=v_owner and o.id=any(p_ids)),'[]'::jsonb);
end$$;
revoke all on function public.order_logistics_read(uuid[]) from public,anon;
grant execute on function public.order_logistics_read(uuid[]) to authenticated;

-- Existing signed pending reports cannot adopt a replacement label on completion.
-- New snapshots carry identity; unchanged legacy snapshots are checked against report creation time.
do $$declare src text;f record;before_src text;begin
 src:=pg_get_functiondef('private.pickup_report_preview_items(uuid,uuid[])'::regprocedure);
 if position('''trackingNumber'',CASE' in src)=0 then raise exception 'LOGISTICS_REPORT_PREVIEW_CHANGED';end if;
 execute replace(src,'''trackingNumber'',CASE','''shipmentIdentity'',private.order_report_identity(p_owner,id,tracking_number),''trackingNumber'',CASE');
 src:=pg_get_functiondef('public.pickup_document_prepare(uuid,uuid,uuid,uuid,uuid,jsonb)'::regprocedure);
 if position('v_report:=private.pickup_report_effective(p_report);' in src)=0 then raise exception 'LOGISTICS_SIGNATURE_PREPARE_CHANGED';end if;
 execute replace(src,'v_report:=private.pickup_report_effective(p_report);',
 $guard$v_report:=private.pickup_report_effective(p_report);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_report->'items') i
 WHERE private.order_report_identity(p_owner,(i->>'orderId')::uuid,i->>'trackingNumber') IS NULL
 OR (i->>'shipmentIdentity' IS NOT NULL AND i->>'shipmentIdentity' IS DISTINCT FROM private.order_report_identity(p_owner,(i->>'orderId')::uuid,i->>'trackingNumber'))
 OR (i->>'shipmentIdentity' IS NULL AND NOT EXISTS(SELECT 1 FROM public.fulfillment_orders f WHERE f.owner_id=p_owner
 AND private.shipment_tracking_identity(f)=private.order_report_identity(p_owner,(i->>'orderId')::uuid,i->>'trackingNumber')
 AND f.label_created_at <= (v_report->>'createdAt')::timestamptz))) THEN RAISE EXCEPTION 'LOGISTICS_REPORT_LABEL_CHANGED';END IF;
 p_input:=p_input||jsonb_build_object('_logisticsIdentities',(SELECT jsonb_object_agg(i->>'orderId',private.order_report_identity(p_owner,(i->>'orderId')::uuid,i->>'trackingNumber')) FROM jsonb_array_elements(v_report->'items') i));
 $guard$);
 -- Both cached reads and fallback classify the exact same current label evidence.
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('mfa_impl_orders_dashboard_pickup_v1','mfa_impl_orders_workbench_v1','pickup_report_dashboard_scope','orders_dashboard_projection_refresh') loop
 src:=pg_get_functiondef(f.oid);before_src:=src;
 src:=regexp_replace(src,'CASE[[:space:]]+WHEN f.is_cancelled THEN ''cancelled''.*?END AS order_state','private.order_logistics_state(to_jsonb(f)) AS order_state','gs');
 src:=regexp_replace(src,'p.print_sort,CASE WHEN p.has_label.*?END AS order_state,p.created_day','p.print_sort,private.order_logistics_state(to_jsonb(p)) AS order_state,p.created_day','gs');
 src:=regexp_replace(src,'original.print_sort,CASE WHEN original.has_label.*?END AS order_state,original.created_day','original.print_sort,private.order_logistics_state(to_jsonb(original)) AS order_state,original.created_day','gs');
 src:=replace(src,'p.created_day,p.dispatched_day,','p.created_day,(coalesce(nullif(private.order_logistics_evidence(to_jsonb(p))->>''dispatchedAt'',''''),nullif(private.order_logistics_evidence(to_jsonb(p))->>''historicalDate'',''''))::timestamptz AT TIME ZONE ''Europe/Madrid'')::date AS dispatched_day,');
 src:=replace(src,'coalesce(f.fulfilled_at,f.tracking_updated_at,f.label_created_at,f.order_updated_at,f.order_created_at)','coalesce(nullif(private.order_logistics_evidence(to_jsonb(f))->>''dispatchedAt'',''''),nullif(private.order_logistics_evidence(to_jsonb(f))->>''historicalDate'',''''))::timestamptz');
 src:=replace(src,'(to_jsonb(p) -','((to_jsonb(p)||jsonb_build_object(''logistics_state'',private.order_logistics_state(to_jsonb(p)),''logistics'',private.order_logistics_evidence(to_jsonb(p)),''logistics_identity'',private.order_logistics_identity(to_jsonb(p)))) -');
 if src=before_src then raise exception 'LOGISTICS_CLASSIFIER_CHANGED %',f.oid::regprocedure;end if;
 execute src;
 end loop;
end$$;
revoke all on function private.order_logistics_identity(jsonb),private.order_logistics_evidence(jsonb),private.order_logistics_state(jsonb),private.order_report_identity(uuid,uuid,text),private.order_dispatch_from_tracking(),private.order_dispatch_from_signature() from public,anon,authenticated;

-- Additive RPCs use the existing MFA manifest/wrapper contract. The pilot configuration is unchanged.
DO $wrap$
DECLARE f record; original text; impl_name text; impl_oid regprocedure; args text;
BEGIN
 FOR f IN SELECT p.* FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN
 ('order_logistics_read','order_logistics_mark_sent')
 LOOP
 original:=pg_get_functiondef(f.oid);
 impl_name:='mfa_impl_'||f.proname;
 EXECUTE replace(original,'FUNCTION public.'||f.proname||'(', 'FUNCTION private.'||impl_name||'(');
 impl_oid:=to_regprocedure('private.'||impl_name||'('||oidvectortypes(f.proargtypes)||')');
 SELECT string_agg('$'||i,',' ORDER BY i) INTO args FROM generate_series(1,f.pronargs)i;
 EXECUTE format('CREATE OR REPLACE FUNCTION public.%I(%s) RETURNS jsonb LANGUAGE plpgsql %s SECURITY DEFINER SET search_path=%L AS %L',
 f.proname,pg_get_function_arguments(f.oid),CASE WHEN f.provolatile='s' THEN 'STABLE' ELSE 'VOLATILE' END,'',
 'BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION ''AUTH_REQUIRED'' USING ERRCODE=''42501''; END IF; PERFORM public.security_mfa_assert(false); RETURN private.'||impl_name||'('||args||'); END');
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',impl_oid);
 INSERT INTO private.mfa_function_manifest(signature,function_oid,implementation,original_definition,wrapper_hash)
 VALUES(f.oid::regprocedure::text,f.oid,impl_oid,original,md5(pg_get_functiondef(f.oid)));
 END LOOP;
END $wrap$;

-- A declared pickup total can differ from the verified line sum. The PDF already
-- prints both totals; keep exact verified IDs/revision and base numeric validation.
do $declared$ declare src text; fn text; needle text; begin
 foreach fn in array array['public.pickup_document_prepare(uuid,uuid,uuid,uuid,uuid,jsonb)','public.pickup_document_complete(uuid,uuid,uuid,uuid,uuid,jsonb)'] loop
 src:=pg_get_functiondef(fn::regprocedure);
 needle:='if (p_input->>''packages'')::integer is distinct from (select sum((i->>''packages'')::integer) from jsonb_array_elements(v_report->''items'')i where trim(i->>''carrier'')=v_carrier) then raise exception ''PICKUP_INVALID_PACKAGES'';end if;';
 if fn like '%complete%' then needle:=replace(replace(needle,'p_input','o.input'),'v_carrier','o.carrier');end if;
 if position(needle in src)=0 then raise exception 'LOGISTICS_DECLARED_PACKAGES_GUARD_CHANGED';end if;
 execute replace(src,needle,'');
 end loop;
end $declared$;

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
;
do $$begin
 if (select count(*) from logistics_backfill_candidates)<>953 or
 (select count(*) from logistics_backfill_candidates where candidate_type='dispatch')<>362 or
 (select count(*) from logistics_backfill_candidates where candidate_type='historical')<>591 or
 (select md5(string_agg(owner_id::text||'/'||order_id::text||'/'||identity_key||'/'||candidate_type||'/'||coalesce(evidence_at::text,'')||'/'||basis,',' order by owner_id,order_id,candidate_type)) from logistics_backfill_candidates)<>'a97d5e1170f91c358cda01e4327a2f46'
 then raise exception 'LOGISTICS_BACKFILL_CHANGED_RECOUNT_REQUIRED';end if;
end$$;
insert into private.order_dispatch_evidence(owner_id,identity_key,order_id,dispatched_at,cause,evidence_basis,report_id,actor_id)
select owner_id,identity_key,order_id,evidence_at,cause,basis,report_id,actor_id from logistics_backfill_candidates where candidate_type='dispatch'
on conflict do nothing;
insert into private.order_logistics_legacy(owner_id,identity_key,order_id,historical_date,basis)
select owner_id,identity_key,order_id,evidence_at,basis from logistics_backfill_candidates where candidate_type='historical'
on conflict do nothing;
select 'dispatch' kind,count(*) rows from private.order_dispatch_evidence union all select 'historical',count(*) from private.order_logistics_legacy;

commit;
