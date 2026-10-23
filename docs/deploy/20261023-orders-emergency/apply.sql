-- Awaiting owner approval. Only two function definitions; zero business rows changed.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $patch$
DECLARE r record; original text; patched text; changed integer:=0;
BEGIN
 FOR r IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='private' AND p.proname IN ('mfa_impl_orders_workbench_v1','mfa_impl_orders_dashboard_pickup_v1')
 LOOP
  original:=pg_get_functiondef(r.oid);
  IF md5(original)<>(CASE r.proname
   WHEN 'mfa_impl_orders_workbench_v1' THEN 'de9f2c2f531ac1d6ead3323792b54f3b'
   ELSE 'ada5a85ba7cc2ed7e78fc0e27fe09f00' END)
  THEN RAISE EXCEPTION 'RPC changed concurrently: %',r.proname; END IF;
  patched:=replace(original,$state$private.order_logistics_state(to_jsonb(p)) AS order_state$state$,'p.order_state');
  patched:=replace(patched,$day$(coalesce(nullif(private.order_logistics_evidence(to_jsonb(p))->>'dispatchedAt',''),nullif(private.order_logistics_evidence(to_jsonb(p))->>'historicalDate',''))::timestamptz AT TIME ZONE 'Europe/Madrid')::date AS dispatched_day$day$,'p.dispatched_day');
  IF patched=original OR position($state$private.order_logistics_state(to_jsonb(p)) AS order_state$state$ IN patched)>0
    OR position($day$(coalesce(nullif(private.order_logistics_evidence(to_jsonb(p))->>'dispatchedAt',''),nullif(private.order_logistics_evidence(to_jsonb(p))->>'historicalDate',''))::timestamptz AT TIME ZONE 'Europe/Madrid')::date AS dispatched_day$day$ IN patched)>0
  THEN RAISE EXCEPTION 'Unexpected RPC structure: %',r.proname; END IF;
  EXECUTE patched;
  changed:=changed+1;
 END LOOP;
 IF changed<>2 THEN RAISE EXCEPTION 'Expected 2 functions, found %',changed; END IF;
END $patch$;
COMMIT;

