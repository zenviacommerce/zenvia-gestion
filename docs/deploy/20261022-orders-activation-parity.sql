BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL statement_timeout='25s';
UPDATE private.orders_projection_control SET read_enabled=false WHERE singleton;
SELECT set_config('request.jwt.claims','{"sub":"fd6395e8-8c8d-4d37-b297-48e771e3f3f7","role":"authenticated","aal":"aal2"}',true);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE projection_activation_parity(name text,sql text,before_value jsonb,after_value jsonb,before_ms double precision,after_ms double precision) ON COMMIT DROP;
DO $parity$
DECLARE endpoint text; state text; query text;t timestamptz;v jsonb;
BEGIN
 FOREACH endpoint IN ARRAY ARRAY['orders_dashboard_page_v1','orders_dashboard_pickup_v1'] LOOP
 FOREACH state IN ARRAY ARRAY['pending','labelled','shipped','cancelled','all'] LOOP
 query:=format('SELECT public.%I(p_state=>%L)',endpoint,state);t:=clock_timestamp();EXECUTE query INTO v;
 INSERT INTO projection_activation_parity VALUES(endpoint||':'||state,query,v,NULL,extract(epoch from clock_timestamp()-t)*1000,NULL);
 END LOOP;
 query:=format('SELECT public.%I(p_state=>%L,p_sort_key=>%L,p_sort_direction=>%L)',endpoint,'all','pickupReport','desc');t:=clock_timestamp();EXECUTE query INTO v;
 INSERT INTO projection_activation_parity VALUES(endpoint||':RECsort',query,v,NULL,extract(epoch from clock_timestamp()-t)*1000,NULL);
 query:=format('SELECT public.%I(p_state=>%L,p_country=>%L)',endpoint,'all','ES');t:=clock_timestamp();EXECUTE query INTO v;
 INSERT INTO projection_activation_parity VALUES(endpoint||':ES',query,v,NULL,extract(epoch from clock_timestamp()-t)*1000,NULL);
 END LOOP;
END $parity$;
RESET ROLE;
UPDATE private.orders_projection_control SET read_enabled=true WHERE singleton;
SET LOCAL ROLE authenticated;
DO $parity$
DECLARE r record;t timestamptz;v jsonb;receipt jsonb;
BEGIN
 IF NOT private.orders_dashboard_projection_usable() THEN RAISE EXCEPTION 'PROJECTION_NOT_FRESH';END IF;
 FOR r IN SELECT * FROM projection_activation_parity LOOP t:=clock_timestamp();EXECUTE r.sql INTO v;UPDATE projection_activation_parity SET after_value=v,after_ms=extract(epoch from clock_timestamp()-t)*1000 WHERE name=r.name;END LOOP;
 IF EXISTS(SELECT 1 FROM projection_activation_parity WHERE before_value IS DISTINCT FROM after_value) THEN RAISE EXCEPTION 'PROJECTION_PARITY_FAILED';END IF;
 SELECT jsonb_build_object('captured_at',clock_timestamp(),'passed',count(*)FILTER(WHERE before_value=after_value),'cases',jsonb_agg(jsonb_build_object('name',name,'identical',before_value=after_value,'before_ms',before_ms,'after_ms',after_ms)ORDER BY name)) INTO receipt FROM projection_activation_parity;
 EXECUTE format('PREPARE projection_activation_receipt AS SELECT %L::jsonb receipt',receipt::text);
END $parity$;
ROLLBACK;
EXECUTE projection_activation_receipt;
