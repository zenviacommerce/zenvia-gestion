// @vitest-environment node
// Offline integration matrix. Applied SQL fixtures are byte-identical production-reviewed inputs.
import {it,expect} from 'vitest';import {PGlite} from '@electric-sql/pglite';import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';
const appliedRoot=process.env.APPLIED_PERF_ROOT;
const read=(p:string)=>readFileSync(/202610220(65250|70148|85809)_/.test(p)?(appliedRoot?appliedRoot+'/'+p:'tests/fixtures/applied-orders-projection/'+p.split('/').pop()):p,'utf8');
it.each(['legacy','shadow','active','ui-first-active','active-disabled'])('%s tracking compatibility preserves complete normalized RPC results',async(mode)=>{const d=new PGlite();try{
await d.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema private;create table private.mfa_function_manifest(signature text primary key,function_oid oid not null,implementation regprocedure not null,original_definition text not null,wrapper_hash text not null);create function auth.uid() returns uuid language sql as $$select current_setting('test.owner')::uuid$$;create function public.security_mfa_assert(boolean) returns void language plpgsql as $$begin if coalesce(current_setting('test.mfa',true),'true')<>'true' then raise exception 'MFA_REQUIRED';end if;end$$;create table public.business_settings(owner_id uuid,legal_name text,tax_id text,address_line1 text,address_line2 text,postal_code text,city text,province text,country_code text,email text,phone text,iban text);grant usage on schema private to authenticated,service_role;create function private.app_workspace_owner_id() returns uuid language sql as $$select current_setting('test.owner')::uuid$$;create function private.app_has_permission(text) returns boolean language sql as $$select coalesce(current_setting('test.permission',true),'true')='true'$$;create function private.mfa_allowed() returns boolean language sql as $$select coalesce(current_setting('test.mfa',true),'true')='true'$$;create table integration_accounts(id uuid primary key,owner_id uuid,provider text,enabled boolean,status text);create table workspaces(id uuid primary key,status text);`+read('tests/fixtures/orders-table-schema.sql'));
await d.exec(`alter table fulfillment_orders add primary key(id);alter table fulfillment_orders enable row level security;grant select on fulfillment_orders to authenticated;create policy owner on fulfillment_orders to authenticated using(owner_id=private.app_workspace_owner_id());`);
await d.exec(read('supabase/migrations/20261019143018_orders_dashboard_tariff_kpi_parity.sql'));
await d.exec(read('supabase/migrations/20261020072636_pickup_reports.sql'));await d.exec(read('supabase/migrations/20261020095712_pickup_dashboard_membership.sql'));await d.exec(read('supabase/migrations/20261020102813_pickup_report_sort.sql'));
const wrapperBefore=(await d.query<any>("select md5(pg_get_functiondef(oid)) hash from pg_proc where proname='orders_dashboard_pickup_v1'")).rows[0].hash;
await d.exec(read('supabase/migrations/20261022053808_shipment_tracking_shadow.sql'));await d.exec(read('supabase/migrations/20261022060055_shipment_tracking_provider_event_time.sql'));

await d.exec(`insert into workspaces values('11111111-1111-1111-1111-111111111111','active');insert into integration_accounts values('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','sendcloud',true,'active');insert into fulfillment_orders(id,owner_id,shipping_integration_account_id,sendcloud_id,source_status,tracking_number,shipping_provider,sendcloud_parcel_id,label_created_at,order_created_at,tracking_status_code,items,shipping_address,raw_payload) select md5(n::text)::uuid,'11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',n::text,'SHIPPED','T'||n,'sendcloud',n,now(),now(),'SHIPPED','[]','{}','{}' from generate_series(1,60)n;select tracking_seed_shadow();update shipment_tracking_state set normalized_state='exception',raw_code='delivery_failed',event_at='2026-10-20T10:00:00Z',movement_at='2026-10-20T10:00:00Z';set role authenticated;set test.owner='11111111-1111-1111-1111-111111111111';`);
await d.exec("reset role");
if(mode==='ui-first-active')await d.exec(read('supabase/migrations/20261022060202_shipment_tracking_ui_release.sql'));
if(mode!=='legacy'){
 await d.exec(read('supabase/migrations/20261022065250_orders_incremental_classified_projection.sql'));
 if(mode!=='shadow')await d.exec(read('supabase/migrations/20261022070148_orders_incremental_projection_activate.sql'));
 await d.exec(read('supabase/migrations/20261022085809_orders_projection_single_enqueue.sql'));
}
if(mode!=='ui-first-active')await d.exec(read('supabase/migrations/20261022060202_shipment_tracking_ui_release.sql'));
const beforeRows=(await d.query<any>('select jsonb_agg(to_jsonb(o) order by id) rows from fulfillment_orders o')).rows[0].rows;
if(mode==='active-disabled')await d.exec('update private.orders_projection_control set read_enabled=false,maintenance_enabled=false');
await d.exec(read('supabase/migrations/20261022093845_shipment_tracking_projection_compatibility.sql'));
expect((await d.query<any>('select jsonb_agg(to_jsonb(o) order by id) rows from fulfillment_orders o')).rows[0].rows).toEqual(beforeRows);
if(mode==='active-disabled'){expect((await d.query<any>('select read_enabled,maintenance_enabled from private.orders_projection_control')).rows[0]).toEqual({read_enabled:false,maintenance_enabled:false});await d.exec('update private.orders_projection_control set read_enabled=true,maintenance_enabled=true')}
await d.exec("set role authenticated");
const issue=(await d.query<any>("select orders_dashboard_pickup_v1(p_state=>'all',p_tracking=>'issue') data")).rows[0].data;
expect(issue.total,'fresh cache must expose normalized exception after held UI upgrade').toBe(60);
expect(issue.rows[0].tracking_normalized_state).toBe('exception');
await d.exec("reset role");
await d.exec(`insert into pickup_reports(id,owner_id,request_id,request_fingerprint,number,created_by,snapshot) values(md5('report')::uuid,'11111111-1111-1111-1111-111111111111',md5('request')::uuid,'{}','REC-2026-000001','11111111-1111-1111-1111-111111111111','{}');
insert into pickup_report_items values(md5('report')::uuid,'11111111-1111-1111-1111-111111111111',md5('1')::uuid,md5('1')::uuid::text);`);
// Direct MRW has no legacy observation: SHIPPED alone is not provider confirmation.
await d.exec("update fulfillment_orders set shipping_provider='mrw' where id=md5('8')::uuid;update shipment_tracking_state t set provider='mrw',normalized_state=null,raw_code='SHIPPED',last_error='MRW_TRACKING_ACCESS_DENIED',identity_key=private.shipment_tracking_identity(o) from fulfillment_orders o where o.id=t.order_id and o.id=md5('8')::uuid");
const normalizedPrefix=mode==='legacy'?(await d.query<any>("select split_part(prosrc,E',\\nmatched AS (',1) prefix from pg_proc where oid='private.mfa_impl_orders_dashboard_pickup_v1(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[],text,boolean)'::regprocedure")).rows[0].prefix:(await d.query<any>('select source_prefix prefix from private.orders_projection_classifier')).rows[0].prefix;
const classifyMrw=async()=>(await d.query<any>(normalizedPrefix+" select tracking_class,order_state from classified where id=md5('8')::uuid")).rows[0];
expect((await classifyMrw()).tracking_class,'MRW raw SHIPPED without confirmed observation must not imply transit').toBe('none');
await d.exec('set role authenticated');expect((await d.query<any>("select orders_dashboard_pickup_v1(p_state=>'all',p_tracking=>'transit') data")).rows[0].data.total).toBe(0);await d.exec('reset role');
await d.exec("update fulfillment_orders set source_status='cancelled' where id=md5('8')::uuid");expect(await classifyMrw()).toEqual({tracking_class:'none',order_state:'cancelled'});
await d.exec("update fulfillment_orders set source_status='SHIPPED' where id=md5('8')::uuid;update shipment_tracking_state set normalized_state='in_transit' where order_id=md5('8')::uuid");
expect((await classifyMrw()).tracking_class,'confirmed MRW observation survives provider access error').toBe('transit');
await d.exec('set role authenticated');expect((await d.query<any>("select orders_dashboard_pickup_v1(p_state=>'all',p_tracking=>'transit') data")).rows[0].data.total).toBe(1);await d.exec('reset role');
// Clone the normalized originals independently of cache selection.
for(const [name,schema] of [['mfa_impl_orders_dashboard_pickup_v1','private'],['orders_dashboard_page_v1','public'],['pickup_report_dashboard_scope','private']]){
 const q=mode==='active'||mode==='ui-first-active'||mode==='active-disabled'?"select original_definition definition from private.orders_projection_rpc_backup where signature like $1":"select pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$2 and p.proname=$1";
 const params=mode==='active'||mode==='ui-first-active'||mode==='active-disabled'?['%'+name+'%']:[name,schema];
 const def=(await d.query<any>(q,params)).rows[0].definition;
 await d.exec(def.replace('FUNCTION '+schema+'.'+name+'(', 'FUNCTION public.reference_'+name+'('));
}
const parity=async()=>{
 await d.exec('set role authenticated');
 for(const args of ["p_state=>'all'","p_state=>'pending'","p_tracking=>'issue'","p_tracking=>'returned'","p_tracking=>'cancelled'","p_tracking=>'delivered'","p_query=>'T1'","p_page=>2,p_page_size=>7","p_selected_ids=>array[md5('1')::uuid,md5('3')::uuid]","p_selection_ids_only=>true","p_from=>current_date-7,p_to=>current_date+1"]){
  for(const [actual,reference] of [['orders_dashboard_pickup_v1','reference_mfa_impl_orders_dashboard_pickup_v1'],['orders_dashboard_page_v1','reference_orders_dashboard_page_v1']]){
   const r=(await d.query<any>(`select ${actual}(${args}) actual,${reference}(${args}) reference`)).rows[0];
   expect(r.actual,mode+' '+actual+' '+args).toEqual(r.reference);
  }
 }
 for(const args of ["p_pickup_report=>'in'","p_pickup_report=>'none'","p_selection_all=>true","p_state=>'all',p_sort_key=>'pickupReport',p_sort_direction=>'asc'","p_state=>'all',p_sort_key=>'pickupReport',p_sort_direction=>'desc'"]){
  const r=(await d.query<any>(`select orders_dashboard_pickup_v1(${args}) actual,reference_mfa_impl_orders_dashboard_pickup_v1(${args}) reference`)).rows[0];expect(r.actual).toEqual(r.reference);
 }
 await d.exec('reset role');
};
await parity();
const rebuild=async()=>{if(mode==='legacy')return;await d.exec(`select private.orders_dashboard_projection_repair_enqueue('11111111-1111-1111-1111-111111111111',1000);select private.orders_dashboard_projection_reconcile(1000)`);expect((await d.query<any>('select private.orders_dashboard_projection_usable() usable')).rows[0].usable).toBe(true)};
await rebuild();await parity();
await d.exec("UPDATE fulfillment_orders SET source_channel='amazon',source_status='Pending' WHERE id=md5('2')::uuid;SET ROLE authenticated");
const stale=(await d.query<any>("select orders_dashboard_pickup_v1(p_state=>'all',p_tracking=>'issue') actual,reference_mfa_impl_orders_dashboard_pickup_v1(p_state=>'all',p_tracking=>'issue') reference")).rows[0];
expect(stale.actual.total,'dirty group must fall back after a business source UPDATE').toBe(stale.reference.total);
await d.exec('RESET ROLE');
if(mode!=='legacy'){
const impl=(await d.query<any>("select prosrc from pg_proc where oid='private.mfa_impl_orders_dashboard_pickup_v1(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[],text,boolean)'::regprocedure")).rows[0].prosrc;
if(mode!=='shadow')expect(impl).toContain('projection_gate');
const refresh=(await d.query<any>("select prosrc from pg_proc where oid='private.orders_dashboard_projection_refresh(uuid,text)'::regprocedure")).rows[0].prosrc;
expect(refresh).toContain('orders_projection_versions');expect(refresh).toContain("'tracking'");
const sourceTrigger=(await d.query<any>("select prosrc from pg_proc where oid='private.orders_dashboard_projection_changed()'::regprocedure")).rows[0].prosrc;
expect(sourceTrigger).toContain('old_key');expect(sourceTrigger).not.toContain('pg_advisory');
}
await parity();await rebuild();await parity();
if(mode!=='legacy')await d.exec("UPDATE private.orders_projection_control SET maintenance_enabled=false");
await d.exec("UPDATE shipment_tracking_state SET normalized_state='delivered' WHERE order_id=md5('3')::uuid;SET ROLE authenticated");
const delivered=(await d.query<any>("select orders_dashboard_pickup_v1(p_state=>'all',p_tracking=>'delivered') data")).rows[0].data;
expect(delivered.total,'paused maintenance must still fall back to current normalized state').toBe(1);

await d.exec('reset role');
expect((await d.query<any>("select md5(pg_get_functiondef(oid)) hash from pg_proc where proname='orders_dashboard_pickup_v1'")).rows[0].hash).toBe(wrapperBefore);
await d.exec("set test.owner='99999999-9999-9999-9999-999999999999';set role authenticated");
expect((await d.query<any>("select orders_dashboard_pickup_v1(p_state=>'all') data")).rows[0].data.total).toBe(0);
await d.exec("reset role;set test.owner='11111111-1111-1111-1111-111111111111';set test.mfa='false';set role authenticated");
await expect(d.query('select orders_dashboard_pickup_v1()')).rejects.toThrow('MFA_REQUIRED');
expect((await d.query<any>('select count(*) n from shipment_tracking_state')).rows[0].n).toBe(0);
await d.exec("reset role;set test.mfa='true';set test.permission='false';set role authenticated");
expect((await d.query<any>('select count(*) n from shipment_tracking_state')).rows[0].n).toBe(0);
await d.exec("reset role;set test.permission='true'");
if(mode!=='legacy'){
 await d.exec('update private.orders_projection_control set maintenance_enabled=true');await rebuild();
 const usable=async()=>Boolean((await d.query<any>('select private.orders_dashboard_projection_usable() usable')).rows[0].usable);
 // Invalidate tracking without a surviving queue entry: MVCC tokens still reject stale reads.
 await d.exec("begin;update shipment_tracking_state set raw_message='first' where order_id=md5('1')::uuid;delete from private.orders_projection_dirty");expect(await usable()).toBe(false);
 await d.exec("update shipment_tracking_state set raw_message='second' where order_id=md5('1')::uuid;delete from private.orders_projection_dirty;commit");expect(await usable()).toBe(false);
 await parity();await rebuild();
 const state=(await d.query<any>("select to_jsonb(t) data from shipment_tracking_state t where order_id=md5('1')::uuid")).rows[0].data;
 await d.exec("delete from shipment_tracking_state where order_id=md5('1')::uuid;delete from private.orders_projection_dirty");expect(await usable()).toBe(false);await parity();await rebuild();
 await d.query("insert into shipment_tracking_state select (jsonb_populate_record(null::shipment_tracking_state,$1::jsonb)).*",[JSON.stringify(state)]);await d.exec('delete from private.orders_projection_dirty');expect(await usable()).toBe(false);await parity();await rebuild();
 await d.exec("update shipment_tracking_state set identity_key='mismatched' where order_id=md5('1')::uuid");await parity();await rebuild();
 await d.exec("update shipment_tracking_state set account_id='99999999-9999-9999-9999-999999999999' where order_id=md5('1')::uuid");await parity();await rebuild();
 // Both optional queue and ledger fail. Source and tracking business writes must commit.
 await d.exec(`create function private.test_reject_projection_write() returns trigger language plpgsql as $$begin raise exception 'FORCED_OPTIONAL_FAILURE';end$$;
 create trigger test_refresh_failure before insert or update on private.orders_dashboard_projection for each row execute function private.test_reject_projection_write();
 update fulfillment_orders set tracking_status_message='projection error cannot reject source' where id=md5('4')::uuid;
 select private.orders_dashboard_projection_reconcile(1000);`);
 expect(await usable()).toBe(false);expect((await d.query<any>('select count(*) n from private.orders_projection_failures')).rows[0].n).toBeGreaterThan(0);
 await d.exec(`drop trigger test_refresh_failure on private.orders_dashboard_projection;
 create trigger test_queue_failure before insert on private.orders_projection_dirty for each row execute function private.test_reject_projection_write();
 create trigger test_ledger_failure before insert on private.orders_projection_failures for each row execute function private.test_reject_projection_write();
 update fulfillment_orders set tracking_status_message='business write commits' where id=md5('4')::uuid;
 update shipment_tracking_state set raw_message='provider write commits' where order_id=md5('4')::uuid;`);
 expect((await d.query<any>("select tracking_status_message message from fulfillment_orders where id=md5('4')::uuid")).rows[0].message).toBe('business write commits');expect(await usable()).toBe(false);
 await parity();await d.exec('drop trigger test_queue_failure on private.orders_projection_dirty;drop trigger test_ledger_failure on private.orders_projection_failures;drop function private.test_reject_projection_write()');await rebuild();
 // Source INSERT/DELETE and repeated UPDATE also fail closed before reconciliation.
 await d.exec("insert into fulfillment_orders select (jsonb_populate_record(null::fulfillment_orders,to_jsonb(o)||jsonb_build_object('id',md5('61')::uuid,'sendcloud_id','61','sendcloud_parcel_id',61,'tracking_number','T61'))).* from fulfillment_orders o where id=md5('4')::uuid");await parity();await rebuild();
 await d.exec("delete from fulfillment_orders where id=md5('61')::uuid");await parity();await rebuild();
 await d.exec("begin;update fulfillment_orders set tracking_status_message='v1' where id=md5('4')::uuid;delete from private.orders_projection_dirty;update fulfillment_orders set tracking_status_message='v2' where id=md5('4')::uuid;delete from private.orders_projection_dirty;commit");expect(await usable()).toBe(false);await rebuild();
 // Extra/missing cache rows and old-generation excluded groups may never authorize partial results.
 await d.exec("delete from private.orders_dashboard_projection where id=md5('4')::uuid");expect(await usable()).toBe(false);await parity();await rebuild();
 if(mode!=='ui-first-active'){
 await d.exec("update private.orders_projection_groups set classifier_generation=1 where group_key=md5('2')::uuid::text");expect(await usable()).toBe(false);await rebuild();
 }
 // Regroup and tenant moves must invalidate old manifests, including excluded groups.
 await d.exec("update fulfillment_orders set source_channel='shopify',order_number='REGROUP' where id=md5('5')::uuid");expect(await usable()).toBe(false);await parity();await rebuild();
 await d.exec("update fulfillment_orders set owner_id='99999999-9999-9999-9999-999999999999' where id=md5('5')::uuid");expect(await usable()).toBe(false);await parity();await rebuild();
 // Physical cleanup remains available with both switches off.
 await d.exec("update private.orders_projection_control set read_enabled=false,maintenance_enabled=false;update fulfillment_orders set pii_purged_at=now() where id=md5('4')::uuid;select private.orders_dashboard_projection_cleanup(1000)");
 expect((await d.query<any>("select count(*) n from private.orders_dashboard_projection where id=md5('4')::uuid")).rows[0].n).toBe(0);
 await d.exec('set role authenticated');expect((await d.query<any>('select count(*) n from private.orders_dashboard_projection')).rows[0].n).toBe(0);await d.exec('reset role');
 if(mode!=='shadow'){
 await d.exec(read('supabase/rollback/20261022_shipment_tracking_projection_reads.sql'));await parity();
 expect((await d.query<any>('select read_enabled from private.orders_projection_control')).rows[0].read_enabled).toBe(false);
 }
}
}finally{await d.close()}},120000);
