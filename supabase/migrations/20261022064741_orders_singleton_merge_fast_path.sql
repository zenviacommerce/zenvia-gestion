-- Keep public MFA wrappers, ACLs, signatures and all downstream filtering intact.
-- Only duplicate groups and purged orders need the expensive JSON merge path.
CREATE TABLE IF NOT EXISTS private.orders_rpc_performance_backup (
 signature text PRIMARY KEY,
 original_definition text NOT NULL,
 optimized_hash text NOT NULL
);
ALTER TABLE private.orders_rpc_performance_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.orders_rpc_performance_backup FROM PUBLIC,anon,authenticated;

DO $migration$
DECLARE f record; src text; original text; singleton_columns text; partition_expr text; purge_items text;
BEGIN

 FOR f IN SELECT p.oid,p.oid::regprocedure::text signature
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='public' AND p.proname='orders_dashboard_page_v1' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='sql'))
 OR (n.nspname='private' AND p.proname IN ('mfa_impl_orders_dashboard_page_v1','mfa_impl_orders_dashboard_pickup_v1','pickup_report_dashboard_scope'))
 LOOP
  original:=pg_get_functiondef(f.oid);src:=original;
  IF position('singleton_count' IN src)>0 THEN CONTINUE;END IF;
  IF position('SELECT dedupe_key,jsonb_agg(to_jsonb(r) ORDER BY dedupe_rank) copies FROM ranked r GROUP BY dedupe_key' IN src)=0
    OR position(' SELECT populated.* FROM merged_json CROSS JOIN LATERAL' IN src)=0
  THEN RAISE EXCEPTION 'ORDERS_PERF_SOURCE_CHANGED: %',f.signature;END IF;
  partition_expr:=substring(src FROM 'PARTITION BY (.*?)\s+ORDER BY');
  IF partition_expr IS NULL THEN RAISE EXCEPTION 'ORDERS_PERF_PARTITION_CHANGED: %',f.signature;END IF;
  purge_items:=substring(src FROM $pattern$'items',(coalesce\(\(SELECT jsonb_agg\(jsonb_strip_nulls.*?)\n   \) ELSE data END\) AS populated$pattern$);
  IF purge_items IS NULL THEN RAISE EXCEPTION 'ORDERS_PERF_PURGE_CHANGED: %',f.signature;END IF;
  purge_items:=replace(purge_items,'data->''items''','(CASE WHEN jsonb_typeof(r.items)=''array'' THEN r.items ELSE ''[]''::jsonb END)');
 SELECT string_agg(
 CASE WHEN attname IN ('customer_name','customer_email','customer_phone','tracking_number','tracking_url','shipping_label_url','tracking_status_message','amazon_tracking_sync_error','shopify_tracking_sync_error','shopify_tracking_synced_number','shipping_remote_id','sendcloud_parcel_id','sendcloud_shipment_id','sendcloud_remote_id') THEN 'CASE WHEN r.pii_purged_at IS NOT NULL THEN NULL ELSE '
 WHEN attname IN ('shipping_address','billing_address','raw_payload') THEN 'CASE WHEN r.pii_purged_at IS NOT NULL THEN ''{}''::jsonb ELSE '
 WHEN attname='sendcloud_id' THEN 'CASE WHEN r.pii_purged_at IS NOT NULL THEN ''amazon-purged:''||r.id::text ELSE '
 WHEN attname='items' THEN 'CASE WHEN r.pii_purged_at IS NOT NULL THEN '||purge_items||' ELSE '
 ELSE '' END||CASE
  WHEN attname IN ('customer_name','customer_email','customer_phone','currency','destination_country_code')
    THEN format('nullif(r.%I,'''')',attname)
  WHEN attname IN ('shipping_address','billing_address')
    THEN format('CASE WHEN jsonb_typeof(r.%1$I)=''object'' THEN r.%1$I ELSE ''{}''::jsonb END',attname)
  WHEN attname='items' THEN 'CASE WHEN jsonb_typeof(r.items)=''array'' THEN r.items ELSE ''[]''::jsonb END'
  WHEN attname='raw_payload' THEN $expr$coalesce(r.raw_payload,'{}'::jsonb)||jsonb_build_object('shipping_details',coalesce(nullif(r.raw_payload->'shipping_details','null'::jsonb),'{}'::jsonb)||jsonb_build_object('measurement',coalesce(nullif(r.raw_payload#>'{shipping_details,measurement}','null'::jsonb),'{}'::jsonb)||jsonb_build_object('weight',CASE WHEN r.raw_payload#>>'{shipping_details,measurement,weight,value}' ~ '^[0-9]+([.][0-9]+)?$' THEN r.raw_payload#>'{shipping_details,measurement,weight}' END)))$expr$
  ELSE format('r.%I',attname) END||CASE WHEN attname IN ('customer_name','customer_email','customer_phone','tracking_number','tracking_url','shipping_label_url','tracking_status_message','amazon_tracking_sync_error','shopify_tracking_sync_error','shopify_tracking_synced_number','shipping_remote_id','sendcloud_parcel_id','sendcloud_shipment_id','sendcloud_remote_id','shipping_address','billing_address','raw_payload','sendcloud_id','items') THEN ' END' ELSE '' END||format(' AS %I',attname),',' ORDER BY attnum)
 INTO singleton_columns FROM pg_attribute
 WHERE attrelid='public.fulfillment_orders'::regclass AND attnum>0 AND NOT attisdropped;
  src:=replace(src,'SELECT o.*,','SELECT count(*) OVER (PARTITION BY '||partition_expr||') AS singleton_count,o.*,');
  src:=replace(src,'FROM ranked r GROUP BY dedupe_key','FROM ranked r WHERE singleton_count>1 GROUP BY dedupe_key');
  src:=replace(src,' SELECT populated.* FROM merged_json CROSS JOIN LATERAL',
   ' SELECT '||singleton_columns||' FROM ranked r WHERE singleton_count=1 UNION ALL SELECT populated.* FROM merged_json CROSS JOIN LATERAL');
  EXECUTE src;
  INSERT INTO private.orders_rpc_performance_backup VALUES(f.signature,original,md5(pg_get_functiondef(f.oid)))
  ON CONFLICT(signature) DO NOTHING;
 END LOOP;
END $migration$;
