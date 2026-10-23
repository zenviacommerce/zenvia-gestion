// Reproducible synthetic PostgreSQL-WASM benchmark. No network or credentials.
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
const db=new PGlite();
const owner='00000000-0000-4000-8000-000000000001';
try{
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA private;CREATE SCHEMA auth;
CREATE TABLE private.mfa_function_manifest(signature text primary key,function_oid oid not null,implementation regprocedure not null,original_definition text not null,wrapper_hash text not null);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT current_setting('test.owner')::uuid$$;
CREATE FUNCTION private.app_has_permission(text) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT true$$;
CREATE FUNCTION private.mfa_allowed() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT true$$;
CREATE FUNCTION private.app_workspace_owner_id() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT current_setting('test.owner')::uuid$$;
CREATE FUNCTION public.security_mfa_assert(boolean) RETURNS void LANGUAGE sql STABLE AS $$SELECT NULL::void$$;
CREATE TABLE public.business_settings(owner_id uuid,legal_name text,tax_id text,address_line1 text,address_line2 text,postal_code text,city text,province text,country_code text,email text,phone text,iban text);
`+readFileSync('tests/fixtures/orders-table-schema.sql','utf8'));
await db.exec(`SET test.owner='${owner}';ALTER TABLE fulfillment_orders ENABLE ROW LEVEL SECURITY;GRANT USAGE ON SCHEMA private TO authenticated;GRANT SELECT ON fulfillment_orders TO authenticated;CREATE POLICY tenant ON fulfillment_orders TO authenticated USING(owner_id=private.app_workspace_owner_id());
INSERT INTO fulfillment_orders(id,owner_id,sendcloud_id,source_channel,order_number,source_status,order_created_at,shipping_address,items,raw_payload,customer_name,currency,pii_purged_at,total_amount)
SELECT md5(n::text)::uuid,'${owner}',n::text,'shopify',CASE WHEN n>1000 THEN (n-1000)::text ELSE n::text END,CASE WHEN n%10=0 THEN 'unfulfilled' ELSE 'shipped' END,now()-n*interval '1 hour','{"country_code":"ES","postal_code":"28001"}','[{"quantity":2,"sku":"SYNTHETIC","unit_price":3}]',jsonb_build_object('provider_data',repeat('SYNTHETIC',100),'shipping_details',jsonb_build_object('measurement',jsonb_build_object('weight',jsonb_build_object('value',2,'unit','kg')))),'SYNTHETIC','EUR',CASE WHEN n%2=0 THEN now() END,10 FROM generate_series(1,1014)n;`);
for(const name of ['20261019143018_orders_dashboard_tariff_kpi_parity.sql','20261020072636_pickup_reports.sql','20261020095712_pickup_dashboard_membership.sql','20261020102813_pickup_report_sort.sql'])await db.exec(readFileSync('supabase/migrations/'+name,'utf8'));
const scenarios={pending:"p_state=>'pending'",issues:"p_tracking=>'issue'",search:"p_query=>'SYNTHETIC'",page2:"p_state=>'all',p_page=>2",selection:"p_selection_ids_only=>true",pickup:"p_state=>'all',p_sort_key=>'pickupReport'"};
const results={environment:'isolated PGlite PostgreSQL WASM; not production/capacity evidence',raw_orders:1014,deduped_orders:1000,samples_per_scenario:7,stages:[]};
for(const stage of ['baseline','singleton','projection']){
 if(stage==='singleton')await db.exec(readFileSync('supabase/migrations/20261022064741_orders_singleton_merge_fast_path.sql','utf8'));
 if(stage==='projection'){await db.exec(readFileSync('supabase/migrations/20261022065250_orders_incremental_classified_projection.sql','utf8'));await db.exec(readFileSync('supabase/migrations/20261022070148_orders_incremental_projection_activate.sql','utf8'));}
 await db.exec('SET ROLE authenticated');
 const measurements=[];
 for(const fn of ['orders_dashboard_page_v1','orders_dashboard_pickup_v1'])for(const [name,args] of Object.entries(scenarios)){
  if(name==='pickup'&&fn==='orders_dashboard_page_v1')continue;
  const query=`SELECT public.${fn}(${args}) data`;
  await db.query(query);const ms=[];
  for(let i=0;i<7;i++){const start=performance.now();await db.query(query);ms.push(performance.now()-start)}
  ms.sort((a,b)=>a-b);measurements.push({operation:fn,scenario:name,mean_ms:ms.reduce((a,b)=>a+b,0)/ms.length,p95_ms:ms.at(-1),p99_ms:ms.at(-1),min_ms:ms[0],max_ms:ms.at(-1)});
 }
 await db.exec('RESET ROLE');results.stages.push({stage,measurements});
 console.log(JSON.stringify({stage,measurements}));
}
const writes=[];for(let i=0;i<7;i++){const start=performance.now();await db.exec(`UPDATE fulfillment_orders SET source_status=CASE WHEN source_status='shipped' THEN 'unfulfilled' ELSE 'shipped' END WHERE sendcloud_id='1'`);writes.push(performance.now()-start)}
results.projected_single_group_update_ms=writes;
writeFileSync('docs/deploy/20261022-orders-projection-synthetic-benchmark.json',JSON.stringify(results,null,2)+'\n');
}finally{await db.close()}
