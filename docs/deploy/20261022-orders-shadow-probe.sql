BEGIN;
SET LOCAL statement_timeout='8000ms';
SELECT set_config('request.jwt.claims','{"sub":"fd6395e8-8c8d-4d37-b297-48e771e3f3f7","role":"authenticated","aal":"aal2"}',true);
SELECT private.pickup_report_owner();
EXPLAIN (ANALYZE,BUFFERS,SETTINGS,FORMAT JSON)
WITH classified AS MATERIALIZED (SELECT p."id",p."owner_id",p."sendcloud_id",p."order_id",p."order_number",p."integration_id",p."integration_name",p."integration_type",p."source_channel",p."source_status",p."order_created_at",p."order_updated_at",p."customer_name",p."customer_email",p."customer_phone",p."shipping_address",p."billing_address",p."items",p."total_amount",p."currency",p."raw_payload",p."sendcloud_parcel_id",p."sendcloud_shipment_id",p."tracking_number",p."tracking_url",p."shipping_option_code",p."contract_id",p."label_created_at",p."fulfilled_at",p."last_synced_at",p."created_at",p."updated_at",p."carrier_code",p."carrier_name",p."shipping_service_name",p."tracking_status_code",p."tracking_status_message",p."tracking_updated_at",p."amazon_tracking_synced_at",p."amazon_tracking_last_attempt_at",p."amazon_tracking_sync_error",p."amazon_tracking_sync_attempts",p."shipping_cost_amount",p."shipping_cost_currency",p."shipping_cost_source",p."shipping_cost_net_amount",p."shipping_cost_tax_amount",p."shipping_cost_recorded_at",p."source_integration_account_id",p."shipping_integration_account_id",p."sendcloud_remote_id",p."shipping_provider",p."shipping_remote_id",p."shipping_label_url",p."package_length_cm",p."package_width_cm",p."package_height_cm",p."label_printed_at",p."label_print_count",p."label_print_state_known",p."shopify_tracking_synced_at",p."shopify_tracking_synced_number",p."shopify_tracking_sync_error",p."shopify_tracking_last_attempt_at",p."shopify_tracking_lease",p."shopify_tracking_lease_until",p."label_cancelled_at",p."order_action_lease",p."order_action_lease_until",p."pii_purged_at",p."destination_country_code",p."pii_policy_version",p."marketplace_carrier",p."source_code",p."tracking_text",p."has_label",p."country_code",p."carrier_label",p."is_cancelled",p."has_progress",p."tracking_class",p."weight_sort",p."units_sort",p."print_sort",p."order_state",p."created_day",p."dispatched_day",p."shipping_cost_day",p."vat_percent" FROM private.orders_dashboard_projection p WHERE p.owner_id=(SELECT private.app_workspace_owner_id())),
matched AS (
 SELECT c.*,
  (('all'::text='all' OR c.source_channel='all'::text)
   AND ('all'::text='all' OR c.tracking_class='all'::text)
   AND ('all'::text='all' OR c.country_code=upper('all'::text))
   AND ('all'::text='all' OR c.carrier_label=lower('all'::text))
   AND (trim(coalesce(''::text,''))='' OR position(lower(trim(''::text)) IN lower(concat_ws(' ',
      c.order_number,c.order_id,c.customer_name,c.tracking_number,
      c.tracking_status_message,c.carrier_label,c.items::text,c.country_code)))>0)
   AND ('all'::text='all' OR ('all'::text='in' AND EXISTS (SELECT 1 FROM public.pickup_report_items pi WHERE pi.owner_id=c.owner_id AND (pi.order_id=c.id OR pi.order_key=CASE WHEN c.source_channel IN ('amazon','shopify') AND nullif(trim(c.order_number),'') IS NOT NULL THEN c.source_channel||':'||coalesce(c.source_integration_account_id::text,'legacy')||':'||trim(c.order_number) ELSE c.id::text END))) OR ('all'::text='none' AND NOT EXISTS (SELECT 1 FROM public.pickup_report_items pi WHERE pi.owner_id=c.owner_id AND (pi.order_id=c.id OR pi.order_key=CASE WHEN c.source_channel IN ('amazon','shopify') AND nullif(trim(c.order_number),'') IS NOT NULL THEN c.source_channel||':'||coalesce(c.source_integration_account_id::text,'legacy')||':'||trim(c.order_number) ELSE c.id::text END))))) AS context_match,
  ((NULL::date IS NULL OR c.created_day>=NULL::date) AND (NULL::date IS NULL OR c.created_day<=NULL::date)) AS in_order_period,
  ((NULL::date IS NULL OR c.dispatched_day>=NULL::date) AND (NULL::date IS NULL OR c.dispatched_day<=NULL::date)) AS in_shipped_period,
  ((NULL::date IS NULL OR c.shipping_cost_day>=NULL::date) AND (NULL::date IS NULL OR c.shipping_cost_day<=NULL::date)) AS in_cost_period
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
  count(*) FILTER (WHERE order_state='pending' AND order_created_at < now()-make_interval(hours=>greatest(24,1))) overdue
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
   ('pending'::text='pending' AND order_state='pending')
   OR ('pending'::text='labelled' AND order_state='labelled')
   OR ('pending'::text='shipped' AND order_state='shipped' AND in_shipped_period)
   OR ('pending'::text='cancelled' AND is_cancelled AND in_order_period)
   OR ('pending'::text='all' AND in_order_period)
),
-- Selection and row retrieval reuse the exact deduped, classified filter scope.
eligible AS (
 SELECT * FROM eligible_scope WHERE NULL::uuid[] IS NULL
   OR id=ANY(NULL::uuid[])
),
selectable AS (
 SELECT id FROM eligible WHERE false OR (order_state='pending' AND pii_purged_at IS NULL)
),
numbered AS (
 SELECT e.*,row_number() OVER (ORDER BY
  CASE WHEN 'orderDate'::text='pickupReport' AND 'desc'::text='asc' THEN (SELECT max(split_part(pr.number,'-',2)::numeric*1000000000000+split_part(pr.number,'-',3)::numeric) FROM public.pickup_report_items pi JOIN public.pickup_reports pr ON pr.id=pi.report_id AND pr.owner_id=pi.owner_id WHERE pi.owner_id=e.owner_id AND (pi.order_id=e.id OR pi.order_key=CASE WHEN e.source_channel IN ('amazon','shopify') AND nullif(trim(e.order_number),'') IS NOT NULL THEN e.source_channel||':'||coalesce(e.source_integration_account_id::text,'legacy')||':'||trim(e.order_number) ELSE e.id::text END)) END ASC NULLS LAST,
  CASE WHEN 'orderDate'::text='pickupReport' AND 'desc'::text='desc' THEN (SELECT max(split_part(pr.number,'-',2)::numeric*1000000000000+split_part(pr.number,'-',3)::numeric) FROM public.pickup_report_items pi JOIN public.pickup_reports pr ON pr.id=pi.report_id AND pr.owner_id=pi.owner_id WHERE pi.owner_id=e.owner_id AND (pi.order_id=e.id OR pi.order_key=CASE WHEN e.source_channel IN ('amazon','shopify') AND nullif(trim(e.order_number),'') IS NOT NULL THEN e.source_channel||':'||coalesce(e.source_integration_account_id::text,'legacy')||':'||trim(e.order_number) ELSE e.id::text END)) END DESC NULLS LAST,
  CASE WHEN 'orderDate'::text='weight' AND 'desc'::text='asc' THEN weight_sort END ASC NULLS LAST,
  CASE WHEN 'orderDate'::text='weight' AND 'desc'::text='desc' THEN weight_sort END DESC NULLS LAST,
  CASE WHEN 'orderDate'::text='units' AND 'desc'::text='asc' THEN units_sort END ASC NULLS LAST,
  CASE WHEN 'orderDate'::text='units' AND 'desc'::text='desc' THEN units_sort END DESC NULLS LAST,
  CASE WHEN 'orderDate'::text='printStatus' AND 'desc'::text='asc' THEN print_sort END ASC NULLS LAST,
  CASE WHEN 'orderDate'::text='printStatus' AND 'desc'::text='desc' THEN print_sort END DESC NULLS LAST,
  CASE WHEN 'orderDate'::text='orderDate' AND 'desc'::text='asc' THEN order_created_at END ASC NULLS LAST,
  CASE WHEN 'orderDate'::text='orderDate' AND 'desc'::text<>'asc' THEN order_created_at END DESC NULLS LAST,
  CASE WHEN 'orderDate'::text='total' AND 'desc'::text='asc' THEN total_amount END ASC NULLS LAST,
  CASE WHEN 'orderDate'::text='total' AND 'desc'::text='desc' THEN total_amount END DESC NULLS LAST,
  CASE WHEN 'orderDate'::text='order' AND 'desc'::text='asc' THEN coalesce(order_number,order_id,sendcloud_id) END ASC NULLS LAST,
  CASE WHEN 'orderDate'::text='order' AND 'desc'::text='desc' THEN coalesce(order_number,order_id,sendcloud_id) END DESC NULLS LAST,
  CASE WHEN 'orderDate'::text='customer' AND 'desc'::text='asc' THEN customer_name END ASC NULLS LAST,
  CASE WHEN 'orderDate'::text='customer' AND 'desc'::text='desc' THEN customer_name END DESC NULLS LAST,
  CASE WHEN 'orderDate'::text='channel' AND 'desc'::text='asc' THEN source_channel END ASC NULLS LAST,
  CASE WHEN 'orderDate'::text='channel' AND 'desc'::text='desc' THEN source_channel END DESC NULLS LAST,
  CASE WHEN 'orderDate'::text='carrier' AND 'desc'::text='asc' THEN carrier_label END ASC NULLS LAST,
  CASE WHEN 'orderDate'::text='carrier' AND 'desc'::text='desc' THEN carrier_label END DESC NULLS LAST,
  CASE WHEN 'orderDate'::text='state' AND 'desc'::text='asc' THEN order_state END ASC NULLS LAST,
  CASE WHEN 'orderDate'::text='state' AND 'desc'::text='desc' THEN order_state END DESC NULLS LAST,
  CASE WHEN 'orderDate'::text='shipping' AND 'desc'::text='asc' THEN shipping_cost_amount END ASC NULLS LAST,
  CASE WHEN 'orderDate'::text='shipping' AND 'desc'::text='desc' THEN shipping_cost_amount END DESC NULLS LAST,
  CASE WHEN 'orderDate'::text='tracking' AND 'desc'::text='asc' THEN tracking_class END ASC NULLS LAST,
  CASE WHEN 'orderDate'::text='tracking' AND 'desc'::text='desc' THEN tracking_class END DESC NULLS LAST,
  CASE WHEN 'orderDate'::text='labelDate' AND 'desc'::text='asc' THEN coalesce(label_created_at,fulfilled_at,tracking_updated_at) END ASC NULLS LAST,
  CASE WHEN 'orderDate'::text='labelDate' AND 'desc'::text='desc' THEN coalesce(label_created_at,fulfilled_at,tracking_updated_at) END DESC NULLS LAST,
  CASE WHEN 'orderDate'::text='products' AND 'desc'::text='asc' THEN items::text END ASC NULLS LAST,
  CASE WHEN 'orderDate'::text='products' AND 'desc'::text='desc' THEN items::text END DESC NULLS LAST,
  CASE WHEN 'orderDate'::text='destination' AND 'desc'::text='asc' THEN concat_ws(' ',country_code,shipping_address->>'postal_code') END ASC NULLS LAST,
  CASE WHEN 'orderDate'::text='destination' AND 'desc'::text='desc' THEN concat_ws(' ',country_code,shipping_address->>'postal_code') END DESC NULLS LAST,
  order_created_at DESC NULLS LAST,id DESC) AS ordinal
 FROM eligible e
),
paged AS (
 SELECT * FROM numbered
 WHERE ordinal>greatest(0,0)::bigint*least(greatest(25,1),100)
   AND ordinal<= (greatest(0,0)::bigint+1)*least(greatest(25,1),100)
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
 WHEN cardinality(NULL::uuid[])>2000 THEN
   (SELECT '{}'::jsonb LIMIT (0-cardinality(NULL::uuid[])))
 WHEN false THEN jsonb_build_object(
   'ids',CASE WHEN (SELECT count(*) FROM selectable)>least(greatest(coalesce(2000,2000),1),2000)
     THEN '[]'::jsonb ELSE coalesce((SELECT jsonb_agg(id ORDER BY id) FROM selectable),'[]'::jsonb) END,
   'total',(SELECT count(*) FROM selectable),
   'limit',least(greatest(coalesce(2000,2000),1),2000),
   'exceeded',(SELECT count(*) FROM selectable)>least(greatest(coalesce(2000,2000),1),2000)
 ) ELSE jsonb_build_object(
 'total',(SELECT count(*) FROM eligible),
 'selectableTotal',(SELECT count(*) FROM selectable),
 'page',greatest(0,0),
 'pageSize',least(greatest(25,1),100),
 'rows',coalesce((
  SELECT jsonb_agg((to_jsonb(p) - 'raw_payload' - 'dedupe_rank' - 'source_code' - 'tracking_text'
    - 'has_label' - 'country_code' - 'carrier_label' - 'is_cancelled' - 'has_progress'
    - 'tracking_class' - 'order_state' - 'created_day' - 'dispatched_day' - 'shipping_cost_day'
    - 'weight_sort' - 'units_sort' - 'print_sort' - 'vat_percent' - 'context_match' - 'in_order_period' - 'in_shipped_period'
    - 'in_cost_period' - 'ordinal')
    || jsonb_build_object('pickup_reports',coalesce((SELECT jsonb_agg(jsonb_build_object('id',pr.id,'number',pr.number) ORDER BY pr.created_at DESC,pr.id DESC) FROM public.pickup_report_items pi JOIN public.pickup_reports pr ON pr.id=pi.report_id AND pr.owner_id=pi.owner_id WHERE pi.owner_id=p.owner_id AND (pi.order_id=p.id OR pi.order_key=CASE WHEN p.source_channel IN ('amazon','shopify') AND nullif(trim(p.order_number),'') IS NOT NULL THEN p.source_channel||':'||coalesce(p.source_integration_account_id::text,'legacy')||':'||trim(p.order_number) ELSE p.id::text END)),'[]'::jsonb),'shipping_measurement',p.raw_payload#>'{shipping_details,measurement}',
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
ROLLBACK;

