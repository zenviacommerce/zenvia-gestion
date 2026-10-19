-- Expand the merged composite once per record, preserving all dashboard semantics.
-- ONE authenticated, tenant-RLS-protected request returns a page of orders
-- plus KPIs computed from the entire matching scope, never from 25 rows.
-- No SECURITY DEFINER, no RLS bypass, no exposure of raw_payload.
CREATE OR REPLACE FUNCTION public.orders_dashboard_page_v1(
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_state text DEFAULT 'pending',
  p_channel text DEFAULT 'all',
  p_query text DEFAULT '',
  p_tracking text DEFAULT 'all',
  p_country text DEFAULT 'all',
  p_carrier text DEFAULT 'all',
  p_page integer DEFAULT 0,
  p_page_size integer DEFAULT 25,
  p_overdue_hours integer DEFAULT 24,
  p_sort_key text DEFAULT 'orderDate',
  p_sort_direction text DEFAULT 'desc',
  p_selection_ids_only boolean DEFAULT false,
  p_selection_limit integer DEFAULT 2000,
  p_selected_ids uuid[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $fn$
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
 FROM public.fulfillment_orders o
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
 SELECT r.*,
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
 FROM merged r
 WHERE NOT (r.source_channel='amazon' AND
     regexp_replace(lower(coalesce(r.source_status,'')),'[^a-z]','','g')
       IN ('pending','pendingavailability','invoiceunconfirmed'))
),
flags AS (
 SELECT n.*,
  (n.source_code LIKE '%cancel%' OR n.tracking_text LIKE '%cancelled%' OR n.tracking_text LIKE '%canceled%') AS is_cancelled,
  (n.source_code IN ('fulfilled','shipped','delivered') OR
    (n.has_label AND n.tracking_text<>'' AND
      NOT (n.tracking_text LIKE ANY(ARRAY[
        '%created%','%pending%','%ready to send%','%ready for shipment%',
        '%announced%','%being announced%','%no label%',
        '%announcement failed%','%error collecting%'])))) AS has_progress,
  CASE
   WHEN (NOT n.has_label AND nullif(n.tracking_number,'') IS NULL) THEN 'none'
   WHEN n.tracking_text LIKE '%delivered%' OR n.tracking_text LIKE '%shipment collected by customer%' THEN 'delivered'
   WHEN n.tracking_text LIKE '%driver en route%' OR n.tracking_text LIKE '%out for delivery%' THEN 'route'
   WHEN n.tracking_text LIKE '%awaiting customer pickup%' THEN 'pickup'
   WHEN n.tracking_text LIKE ANY(ARRAY['%sorting centre%','%sorting center%','%being sorted%','% sorted%','%parcel en route%','%in transit%','%picked up by driver%','%shipment picked up%']) THEN 'transit'
   WHEN n.tracking_text LIKE ANY(ARRAY['%address invalid%','%attempt failed%','%announcement failed%','%unable to deliver%','%exception%','%error collecting%','%refused%','%returned to sender%','%delivery delayed%']) THEN 'issue'
   WHEN n.tracking_text LIKE '%cancel%' THEN 'cancelled'
   WHEN n.tracking_text LIKE ANY(ARRAY['%created%','%ready to send%','%ready for shipment%','%announced%','%being announced%','%no label%']) THEN 'ready'
   WHEN n.tracking_text LIKE '%shipped%' THEN 'transit'
   ELSE 'none'
  END AS tracking_class
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
),
matched AS (
 SELECT c.*,
  ((p_channel='all' OR c.source_channel=p_channel)
   AND (p_tracking='all' OR c.tracking_class=p_tracking)
   AND (p_country='all' OR c.country_code=upper(p_country))
   AND (p_carrier='all' OR c.carrier_label=lower(p_carrier))
   AND (trim(coalesce(p_query,''))='' OR position(lower(trim(p_query)) IN lower(concat_ws(' ',
      c.order_number,c.order_id,c.customer_name,c.tracking_number,
      c.tracking_status_message,c.carrier_label,c.items::text,c.country_code)))>0)
  ) AS context_match,
  ((p_from IS NULL OR c.created_day>=p_from) AND (p_to IS NULL OR c.created_day<=p_to)) AS in_order_period,
  ((p_from IS NULL OR c.dispatched_day>=p_from) AND (p_to IS NULL OR c.dispatched_day<=p_to)) AS in_shipped_period,
  ((p_from IS NULL OR c.shipping_cost_day>=p_from) AND (p_to IS NULL OR c.shipping_cost_day<=p_to)) AS in_cost_period
 FROM classified c
),
scope AS (SELECT * FROM matched WHERE context_match),
sales AS (
 SELECT
  count(*) FILTER (WHERE in_order_period AND NOT is_cancelled AND total_amount IS NOT NULL AND (currency IS NULL OR currency='EUR')) AS count,
  coalesce(sum(total_amount) FILTER (WHERE in_order_period AND NOT is_cancelled AND total_amount IS NOT NULL AND (currency IS NULL OR currency='EUR')),0) AS gross,
  coalesce(sum(total_amount/(1+vat_percent/100)) FILTER (WHERE in_order_period AND NOT is_cancelled AND total_amount IS NOT NULL AND (currency IS NULL OR currency='EUR')),0) AS net
 FROM scope
),
shipping AS (
 SELECT
  count(*) FILTER (WHERE has_label AND in_cost_period) AS shipments,
  count(*) FILTER (WHERE has_label AND in_cost_period AND shipping_cost_amount IS NOT NULL AND coalesce(shipping_cost_currency,'EUR')='EUR') AS valued,
  count(*) FILTER (WHERE has_label AND in_cost_period AND (shipping_cost_amount IS NULL OR coalesce(shipping_cost_currency,'EUR')<>'EUR')) AS missing,
  coalesce(sum(shipping_cost_amount) FILTER (WHERE has_label AND in_cost_period AND coalesce(shipping_cost_currency,'EUR')='EUR'),0) AS total,
  coalesce(sum(coalesce(shipping_cost_net_amount,shipping_cost_amount)) FILTER (WHERE has_label AND in_cost_period AND shipping_cost_amount IS NOT NULL AND coalesce(shipping_cost_currency,'EUR')='EUR'),0) AS net,
  coalesce(sum(shipping_cost_tax_amount) FILTER (WHERE has_label AND in_cost_period AND shipping_cost_amount IS NOT NULL AND coalesce(shipping_cost_currency,'EUR')='EUR'),0) AS tax,
  coalesce(sum(shipping_cost_amount) FILTER (WHERE has_label AND in_cost_period AND carrier_label LIKE '%mrw%' AND coalesce(shipping_cost_currency,'EUR')='EUR'),0) AS mrw,
  coalesce(sum(shipping_cost_amount) FILTER (WHERE has_label AND in_cost_period AND carrier_label LIKE '%correos%' AND coalesce(shipping_cost_currency,'EUR')='EUR'),0) AS correos
 FROM scope
),
counts AS (
 SELECT
  count(*) FILTER (WHERE order_state='pending') pending,
  count(*) FILTER (WHERE order_state='pending' AND pii_purged_at IS NULL) preparable,
  count(*) FILTER (WHERE order_state='pending' AND source_channel='amazon') amazon,
  count(*) FILTER (WHERE order_state='pending' AND source_channel='shopify') shopify,
  count(*) FILTER (WHERE order_state='pending' AND source_channel NOT IN ('amazon','shopify')) manual,
  count(*) FILTER (WHERE order_state='labelled') labelled,
  count(*) FILTER (WHERE order_state='shipped' AND in_shipped_period) shipped,
  count(*) FILTER (WHERE is_cancelled AND in_order_period) cancelled,
  count(*) FILTER (WHERE order_state='pending' AND order_created_at < now()-make_interval(hours=>greatest(p_overdue_hours,1))) overdue
 FROM scope
),
kpis AS (
 SELECT jsonb_build_object(
  'pending',c.pending,'preparablePending',c.preparable,
  'amazon',c.amazon,'shopify',c.shopify,'manual',c.manual,
  'labelled',c.labelled,'shipped',c.shipped,'cancelled',c.cancelled,
  'overduePending',c.overdue,
  'sales',jsonb_build_object('gross',s.gross,'net',s.net,'vat',s.gross-s.net,'count',s.count,
    'average',CASE WHEN s.count>0 THEN s.gross/s.count ELSE 0 END),
  'transport',jsonb_build_object('total',t.total,'net',t.net,'tax',t.tax,'mrw',t.mrw,'correos',t.correos,
    'other',t.total-t.mrw-t.correos,'shipments',t.shipments,'valued',t.valued,'missing',t.missing,
    'basis','recorded_only')
 ) AS data
 FROM counts c CROSS JOIN sales s CROSS JOIN shipping t
),
eligible_scope AS (
 SELECT * FROM scope WHERE
   (p_state='pending' AND order_state='pending')
   OR (p_state='labelled' AND order_state='labelled')
   OR (p_state='shipped' AND order_state='shipped' AND in_shipped_period)
   OR (p_state='cancelled' AND is_cancelled AND in_order_period)
   OR (p_state='all' AND in_order_period)
),
-- Selection and row retrieval reuse the exact deduped, classified filter scope.
eligible AS (
 SELECT * FROM eligible_scope WHERE p_selected_ids IS NULL
   OR (id=ANY(p_selected_ids) AND order_state='pending' AND pii_purged_at IS NULL)
),
selectable AS (
 SELECT id FROM eligible WHERE order_state='pending' AND pii_purged_at IS NULL
),
numbered AS (
 SELECT e.*,row_number() OVER (ORDER BY
  CASE WHEN p_sort_key='weight' AND p_sort_direction='asc' THEN weight_sort END ASC NULLS LAST,
  CASE WHEN p_sort_key='weight' AND p_sort_direction='desc' THEN weight_sort END DESC NULLS LAST,
  CASE WHEN p_sort_key='units' AND p_sort_direction='asc' THEN units_sort END ASC NULLS LAST,
  CASE WHEN p_sort_key='units' AND p_sort_direction='desc' THEN units_sort END DESC NULLS LAST,
  CASE WHEN p_sort_key='printStatus' AND p_sort_direction='asc' THEN print_sort END ASC NULLS LAST,
  CASE WHEN p_sort_key='printStatus' AND p_sort_direction='desc' THEN print_sort END DESC NULLS LAST,
  CASE WHEN p_sort_key='orderDate' AND p_sort_direction='asc' THEN order_created_at END ASC NULLS LAST,
  CASE WHEN p_sort_key='orderDate' AND p_sort_direction<>'asc' THEN order_created_at END DESC NULLS LAST,
  CASE WHEN p_sort_key='total' AND p_sort_direction='asc' THEN total_amount END ASC NULLS LAST,
  CASE WHEN p_sort_key='total' AND p_sort_direction='desc' THEN total_amount END DESC NULLS LAST,
  CASE WHEN p_sort_key='order' AND p_sort_direction='asc' THEN coalesce(order_number,order_id,sendcloud_id) END ASC NULLS LAST,
  CASE WHEN p_sort_key='order' AND p_sort_direction='desc' THEN coalesce(order_number,order_id,sendcloud_id) END DESC NULLS LAST,
  CASE WHEN p_sort_key='customer' AND p_sort_direction='asc' THEN customer_name END ASC NULLS LAST,
  CASE WHEN p_sort_key='customer' AND p_sort_direction='desc' THEN customer_name END DESC NULLS LAST,
  CASE WHEN p_sort_key='channel' AND p_sort_direction='asc' THEN source_channel END ASC NULLS LAST,
  CASE WHEN p_sort_key='channel' AND p_sort_direction='desc' THEN source_channel END DESC NULLS LAST,
  CASE WHEN p_sort_key='carrier' AND p_sort_direction='asc' THEN carrier_label END ASC NULLS LAST,
  CASE WHEN p_sort_key='carrier' AND p_sort_direction='desc' THEN carrier_label END DESC NULLS LAST,
  CASE WHEN p_sort_key='state' AND p_sort_direction='asc' THEN order_state END ASC NULLS LAST,
  CASE WHEN p_sort_key='state' AND p_sort_direction='desc' THEN order_state END DESC NULLS LAST,
  CASE WHEN p_sort_key='shipping' AND p_sort_direction='asc' THEN shipping_cost_amount END ASC NULLS LAST,
  CASE WHEN p_sort_key='shipping' AND p_sort_direction='desc' THEN shipping_cost_amount END DESC NULLS LAST,
  CASE WHEN p_sort_key='tracking' AND p_sort_direction='asc' THEN tracking_class END ASC NULLS LAST,
  CASE WHEN p_sort_key='tracking' AND p_sort_direction='desc' THEN tracking_class END DESC NULLS LAST,
  CASE WHEN p_sort_key='labelDate' AND p_sort_direction='asc' THEN coalesce(label_created_at,fulfilled_at,tracking_updated_at) END ASC NULLS LAST,
  CASE WHEN p_sort_key='labelDate' AND p_sort_direction='desc' THEN coalesce(label_created_at,fulfilled_at,tracking_updated_at) END DESC NULLS LAST,
  CASE WHEN p_sort_key='products' AND p_sort_direction='asc' THEN items::text END ASC NULLS LAST,
  CASE WHEN p_sort_key='products' AND p_sort_direction='desc' THEN items::text END DESC NULLS LAST,
  CASE WHEN p_sort_key='destination' AND p_sort_direction='asc' THEN concat_ws(' ',country_code,shipping_address->>'postal_code') END ASC NULLS LAST,
  CASE WHEN p_sort_key='destination' AND p_sort_direction='desc' THEN concat_ws(' ',country_code,shipping_address->>'postal_code') END DESC NULLS LAST,
  order_created_at DESC NULLS LAST,id DESC) AS ordinal
 FROM eligible e
),
paged AS (
 SELECT * FROM numbered
 WHERE ordinal>greatest(p_page,0)::bigint*least(greatest(p_page_size,1),100)
   AND ordinal<= (greatest(p_page,0)::bigint+1)*least(greatest(p_page_size,1),100)
),
facets AS (
 SELECT jsonb_build_object(
 'countries',coalesce((SELECT jsonb_agg(country_code ORDER BY country_code) FROM
    (SELECT DISTINCT country_code FROM classified) countries),'[]'::jsonb),
 'carriers',coalesce((SELECT jsonb_agg(carrier_label ORDER BY carrier_label) FROM
    (SELECT DISTINCT carrier_label FROM classified WHERE carrier_label<>'—') carriers),'[]'::jsonb)
 ) AS data
)
SELECT CASE
 -- Reject oversized caller arrays before returning any rows. A negative LIMIT
 -- raises an error, including when the tenant/filter scope contains no rows.
 WHEN cardinality(p_selected_ids)>2000 THEN
   (SELECT '{}'::jsonb LIMIT (0-cardinality(p_selected_ids)))
 WHEN p_selection_ids_only THEN jsonb_build_object(
   'ids',CASE WHEN (SELECT count(*) FROM selectable)>least(greatest(coalesce(p_selection_limit,2000),1),2000)
     THEN '[]'::jsonb ELSE coalesce((SELECT jsonb_agg(id ORDER BY id) FROM selectable),'[]'::jsonb) END,
   'total',(SELECT count(*) FROM selectable),
   'limit',least(greatest(coalesce(p_selection_limit,2000),1),2000),
   'exceeded',(SELECT count(*) FROM selectable)>least(greatest(coalesce(p_selection_limit,2000),1),2000)
 ) ELSE jsonb_build_object(
 'total',(SELECT count(*) FROM eligible),
 'selectableTotal',(SELECT count(*) FROM selectable),
 'page',greatest(p_page,0),
 'pageSize',least(greatest(p_page_size,1),100),
 'rows',coalesce((
  SELECT jsonb_agg((to_jsonb(p) - 'raw_payload' - 'dedupe_rank' - 'source_code' - 'tracking_text'
    - 'has_label' - 'country_code' - 'carrier_label' - 'is_cancelled' - 'has_progress'
    - 'tracking_class' - 'order_state' - 'created_day' - 'dispatched_day' - 'shipping_cost_day'
    - 'weight_sort' - 'units_sort' - 'print_sort' - 'vat_percent' - 'context_match' - 'in_order_period' - 'in_shipped_period'
    - 'in_cost_period' - 'ordinal')
    || jsonb_build_object('shipping_measurement',p.raw_payload#>'{shipping_details,measurement}',
                           'tracking_metadata',p.raw_payload->'_zenvia_tracking')
    ORDER BY p.ordinal) FROM paged p), '[]'::jsonb),
 -- Full cost scope, independent of the selected state and visible page. Only
 -- tariff inputs are returned; addresses and raw provider payloads stay private.
 'tariffCandidates',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',s.id,
    'pii_purged_at',s.pii_purged_at,
    'order_created_at',s.order_created_at,
    'shipping_provider',s.shipping_provider,
    'sendcloud_parcel_id',s.sendcloud_parcel_id,
    'shipping_remote_id',s.shipping_remote_id,
    'fulfilled_at',s.fulfilled_at,
    'label_created_at',s.label_created_at,
    'carrier_code',s.carrier_code,
    'carrier_name',s.carrier_name,
    'shipping_option_code',s.shipping_option_code,
    'shipping_service_name',s.shipping_service_name,
    'shipping_cost_amount',s.shipping_cost_amount,
    'shipping_cost_net_amount',s.shipping_cost_net_amount,
    'shipping_cost_tax_amount',s.shipping_cost_tax_amount,
    'shipping_cost_currency',s.shipping_cost_currency,
    'shipping_cost_source',s.shipping_cost_source,
    'shipping_address',jsonb_strip_nulls(jsonb_build_object('country_code',s.shipping_address->'country_code','postal_code',s.shipping_address->'postal_code')),
    'shipping_measurement',jsonb_build_object('weight',jsonb_build_object('value',s.raw_payload#>'{shipping_details,measurement,weight,value}','unit',s.raw_payload#>'{shipping_details,measurement,weight,unit}')),
    'kpi_carrier_label',s.carrier_label) ORDER BY s.id)
    FROM scope s WHERE s.has_label AND s.in_cost_period
      AND (s.shipping_cost_amount IS NULL OR s.shipping_cost_source='tariff_estimate')),'[]'::jsonb),
 'kpis',(SELECT data FROM kpis),
 'facets',(SELECT data FROM facets)
) END;
$fn$;
