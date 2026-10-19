-- Pool-pressure remediation; all order reads retain existing invoker RLS.
-- The status endpoint is internal, service-role only. It replaces FOUR parallel
-- exact COUNT(*) PostgREST calls with ONE filtered aggregate.
CREATE OR REPLACE FUNCTION public.amazon_sync_job_counts(
  p_owner_id uuid, p_account_id uuid
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $fn$
  SELECT jsonb_build_object(
    'queued', count(*) FILTER (WHERE j.status='queued'),
    'running', count(*) FILTER (WHERE j.status='running'),
    'success', count(*) FILTER (WHERE j.status='success'),
    'failed', count(*) FILTER (WHERE j.status='failed'))
  FROM public.amazon_sync_jobs j
  WHERE j.owner_id=p_owner_id AND j.amazon_account_id=p_account_id;
$fn$;
REVOKE ALL ON FUNCTION public.amazon_sync_job_counts(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.amazon_sync_job_counts(uuid,uuid) TO service_role;

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
  p_sort_direction text DEFAULT 'desc'
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $fn$
WITH ranked AS (
 SELECT o.*,
  row_number() OVER (
   PARTITION BY CASE
      WHEN o.source_channel IN ('amazon','shopify') AND trim(coalesce(o.order_number,''))<>''
        THEN o.source_channel||':'||trim(o.order_number)
      ELSE o.id::text
   END
   ORDER BY
    ((CASE WHEN coalesce(o.sendcloud_id,'')<>'' AND o.sendcloud_id NOT LIKE 'amazon:%' THEN 40 ELSE 0 END)
    +(CASE WHEN o.shipping_integration_account_id IS NOT NULL THEN 20 ELSE 0 END)
    +(CASE WHEN nullif(o.customer_name,'') IS NOT NULL THEN 8 ELSE 0 END)
    +(CASE WHEN nullif(o.customer_phone,'') IS NOT NULL THEN 4 ELSE 0 END)
    +(CASE WHEN nullif(o.customer_email,'') IS NOT NULL THEN 2 ELSE 0 END)
    +(CASE WHEN nullif(o.shipping_address->>'address_line_1','') IS NOT NULL THEN 8 ELSE 0 END)
    +(CASE WHEN nullif(o.shipping_address->>'postal_code','') IS NOT NULL THEN 4 ELSE 0 END)
    +(CASE WHEN jsonb_typeof(o.items)='array' AND jsonb_array_length(o.items)>0 THEN 2 ELSE 0 END)
    +(CASE WHEN o.sendcloud_parcel_id IS NOT NULL OR o.shipping_remote_id IS NOT NULL OR o.label_created_at IS NOT NULL THEN 50 ELSE 0 END)
    ) DESC,
    o.order_created_at DESC NULLS LAST,o.id DESC
  ) AS dedupe_rank
 FROM public.fulfillment_orders o
),
normalized AS (
 SELECT r.*,
   lower(trim(coalesce(r.source_status,''))) AS source_code,
   lower(regexp_replace(concat_ws(' ',r.tracking_status_code,r.tracking_status_message),'[_-]+',' ','g')) AS tracking_text,
   (r.sendcloud_parcel_id IS NOT NULL OR nullif(r.shipping_remote_id,'') IS NOT NULL OR r.label_created_at IS NOT NULL) AS has_label,
   upper(coalesce(nullif(r.shipping_address->>'country_code',''),'XX')) AS country_code,
   CASE
     WHEN regexp_replace(lower(coalesce(r.carrier_code,r.carrier_name,'')),'[^a-z0-9]','','g')='correosexpress' THEN 'correos express'
     WHEN regexp_replace(lower(coalesce(r.carrier_code,r.carrier_name,'')),'[^a-z0-9]','','g')='correos' THEN 'correos'
     WHEN regexp_replace(lower(coalesce(r.carrier_code,r.carrier_name,'')),'[^a-z0-9]','','g')='mrw' THEN 'mrw'
     WHEN nullif(r.carrier_name,'') IS NOT NULL THEN lower(r.carrier_name)
     WHEN lower(coalesce(r.carrier_code,split_part(r.shipping_option_code,':',1),'')) LIKE '%correos%' THEN 'correos'
     WHEN lower(coalesce(r.carrier_code,split_part(r.shipping_option_code,':',1),'')) LIKE '%mrw%' THEN 'mrw'
     ELSE lower(coalesce(nullif(r.carrier_code,''),split_part(r.shipping_option_code,':',1),'—'))
   END AS carrier_label
 FROM ranked r
 WHERE r.dedupe_rank=1
   AND NOT (r.source_channel='amazon' AND
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
   WHEN n.tracking_text LIKE ANY(ARRAY['%sorting centre%','%sorting center%','%being sorted%','% sorted%','%parcel en route%','%in transit%','%picked up by driver%','%shipment picked up%','%shipped%']) THEN 'transit'
   WHEN n.tracking_text LIKE ANY(ARRAY['%address invalid%','%attempt failed%','%announcement failed%','%unable to deliver%','%exception%','%error collecting%','%refused%','%returned to sender%','%delivery delayed%']) THEN 'issue'
   WHEN n.tracking_text LIKE '%cancel%' THEN 'cancelled'
   WHEN n.tracking_text LIKE ANY(ARRAY['%created%','%ready to send%','%ready for shipment%','%announced%','%being announced%','%no label%']) THEN 'ready'
   ELSE 'none'
  END AS tracking_class
 FROM normalized n
),
classified AS (
 SELECT f.*,
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
  coalesce(sum(shipping_cost_net_amount) FILTER (WHERE has_label AND in_cost_period AND coalesce(shipping_cost_currency,'EUR')='EUR'),0) AS net,
  coalesce(sum(shipping_cost_tax_amount) FILTER (WHERE has_label AND in_cost_period AND coalesce(shipping_cost_currency,'EUR')='EUR'),0) AS tax,
  coalesce(sum(shipping_cost_amount) FILTER (WHERE has_label AND in_cost_period AND carrier_label LIKE '%mrw%' AND coalesce(shipping_cost_currency,'EUR')='EUR'),0) AS mrw,
  coalesce(sum(shipping_cost_amount) FILTER (WHERE has_label AND in_cost_period AND carrier_label LIKE '%correos%' AND coalesce(shipping_cost_currency,'EUR')='EUR'),0) AS correos
 FROM scope
),
kpis AS (
 SELECT jsonb_build_object(
  'pending',count(*) FILTER (WHERE order_state='pending'),
  'amazon',count(*) FILTER (WHERE order_state='pending' AND source_channel='amazon'),
  'shopify',count(*) FILTER (WHERE order_state='pending' AND source_channel='shopify'),
  'manual',count(*) FILTER (WHERE order_state='pending' AND source_channel NOT IN ('amazon','shopify')),
  'labelled',count(*) FILTER (WHERE order_state='labelled'),
  'shipped',count(*) FILTER (WHERE order_state='shipped' AND in_shipped_period),
  'cancelled',count(*) FILTER (WHERE is_cancelled AND in_order_period),
  'overduePending',count(*) FILTER (WHERE order_state='pending' AND order_created_at < now()-make_interval(hours=>greatest(p_overdue_hours,1))),
  'sales',jsonb_build_object('gross',s.gross,'net',s.net,'vat',s.gross-s.net,'count',s.count,
    'average',CASE WHEN s.count>0 THEN s.gross/s.count ELSE 0 END),
  'transport',jsonb_build_object('total',t.total,'net',t.net,'tax',t.tax,'mrw',t.mrw,'correos',t.correos,
    'other',t.total-t.mrw-t.correos,'shipments',t.shipments,'valued',t.valued,'missing',t.missing,
    'basis','recorded_only')
 ) AS data
 FROM scope CROSS JOIN sales s CROSS JOIN shipping t
 GROUP BY s.gross,s.net,s.count,t.total,t.net,t.tax,t.mrw,t.correos,t.shipments,t.valued,t.missing
),
eligible AS (
 SELECT * FROM scope WHERE
   (p_state='pending' AND order_state='pending')
   OR (p_state='labelled' AND order_state='labelled')
   OR (p_state='shipped' AND order_state='shipped' AND in_shipped_period)
   OR (p_state='cancelled' AND is_cancelled AND in_order_period)
   OR (p_state='all' AND in_order_period)
),
numbered AS (
 SELECT e.*,row_number() OVER (ORDER BY
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
SELECT jsonb_build_object(
 'total',(SELECT count(*) FROM eligible),
 'page',greatest(p_page,0),
 'pageSize',least(greatest(p_page_size,1),100),
 'rows',coalesce((
  SELECT jsonb_agg((to_jsonb(p) - 'raw_payload' - 'dedupe_rank' - 'source_code' - 'tracking_text'
    - 'has_label' - 'country_code' - 'carrier_label' - 'is_cancelled' - 'has_progress'
    - 'tracking_class' - 'order_state' - 'created_day' - 'dispatched_day' - 'shipping_cost_day'
    - 'vat_percent' - 'context_match' - 'in_order_period' - 'in_shipped_period'
    - 'in_cost_period' - 'ordinal')
    || jsonb_build_object('shipping_measurement',p.raw_payload#>'{shipping_details,measurement}',
                           'tracking_metadata',p.raw_payload->'_zenvia_tracking')
    ORDER BY p.ordinal) FROM paged p), '[]'::jsonb),
 'kpis',(SELECT data FROM kpis),
 'facets',(SELECT data FROM facets)
);
$fn$;
REVOKE ALL ON FUNCTION public.orders_dashboard_page_v1(date,date,text,text,text,text,text,text,integer,integer,integer,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.orders_dashboard_page_v1(date,date,text,text,text,text,text,text,integer,integer,integer,text,text) TO authenticated;
