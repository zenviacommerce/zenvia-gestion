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
 s.normalized_state,s.event_at,s.observed_at,s.last_checked_at,
 coalesce(s.normalized_state,case when o.shipping_provider='mrw' then null else private.tracking_legacy_state(o.shipping_provider,o.tracking_status_code) end) carrier_state
 from public.fulfillment_orders o left join public.shipment_tracking_state s
 on s.order_id=o.id and s.owner_id=o.owner_id and s.identity_key=private.shipment_tracking_identity(o)
), proofs as (
 select o.owner_id,o.id order_id,o.identity_key,'tracking'::text cause,
 coalesce(e.event_at,e.observed_at) evidence_at,'normalized_history'::text basis from orders o
 join public.shipment_tracking_events e on e.owner_id=o.owner_id and e.identity_key=o.identity_key
 where e.normalized_state in ('in_transit','out_for_delivery','delivered')
 union all
 select o.owner_id,o.id,o.identity_key,'tracking',coalesce(o.event_at,o.observed_at,o.last_checked_at,o.tracking_updated_at),
 case when o.normalized_state is null then 'legacy_carrier_status' else 'normalized_current' end
 from orders o where o.carrier_state in ('in_transit','out_for_delivery','delivered','returned')
 union all
 select o.owner_id,o.id,o.identity_key,'signed_report',sig.created_at,'signed_report'
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
select o.owner_id,o.id order_id,o.identity_key,'dispatch'::text candidate_type,e.evidence_at,e.cause,e.basis,o.source_channel
from orders o join earliest e on e.owner_id=o.owner_id and e.order_id=o.id
where o.has_label and o.label_cancelled_at is null and o.pii_purged_at is null
and lower(trim(coalesce(o.source_status,''))) not in ('cancelled','canceled','cancelled_by_customer','cancelled_by_seller')
and coalesce(o.carrier_state,'')<>'cancelled'
union all
select o.owner_id,o.id,o.identity_key,'historical',coalesce(o.fulfilled_at,o.tracking_updated_at,o.order_updated_at,o.order_created_at),null,'pre_cutover_channel_history',o.source_channel
from orders o where not o.has_label and o.label_cancelled_at is null
and lower(trim(coalesce(o.source_status,''))) in ('fulfilled','shipped','delivered')
and coalesce(o.carrier_state,'')<>'cancelled'
), proposed AS (select e.*,case when is_cancelled or label_cancelled_at is not null then 'cancelled' when has_label and exists(select 1 from candidates x where x.candidate_type='dispatch' and x.owner_id=e.owner_id and x.identity_key=md5(jsonb_build_array(e.owner_id,e.shipping_integration_account_id,e.shipping_provider,e.tracking_number,e.shipping_remote_id,e.sendcloud_parcel_id,e.label_created_at,e.label_cancelled_at)::text)) then 'shipped' when has_label then 'labelled' when exists(select 1 from candidates x where x.candidate_type='historical' and x.owner_id=e.owner_id and x.order_id=e.id) then 'shipped' else 'pending' end proposed_state from evidence e) select source_channel,order_state before_state,proposed_state after_state,count(*) orders from proposed group by 1,2,3 order by 1,2,3;
