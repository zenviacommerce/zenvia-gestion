// @vitest-environment node
import {it,expect} from 'vitest';import {PGlite} from '@electric-sql/pglite';import {readFileSync} from 'node:fs';
const read=(p:string)=>readFileSync(p,'utf8');
it.each(['legacy','shadow','active','active-disabled'])('%s workbench preserves security, scopes and projection fallback',async(mode)=>{const d=new PGlite();try{
await d.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema private;create table private.mfa_function_manifest(signature text primary key,function_oid oid not null,implementation regprocedure not null,original_definition text not null,wrapper_hash text not null);create function auth.uid() returns uuid language sql as $$select current_setting('test.owner')::uuid$$;create function public.security_mfa_assert(boolean) returns void language plpgsql as $$begin if coalesce(current_setting('test.mfa',true),'true')<>'true' then raise exception 'MFA_REQUIRED';end if;end$$;create table public.business_settings(owner_id uuid,legal_name text,tax_id text,address_line1 text,address_line2 text,postal_code text,city text,province text,country_code text,email text,phone text,iban text);grant usage on schema private to authenticated,service_role;create function private.app_workspace_owner_id() returns uuid language sql as $$select current_setting('test.owner')::uuid$$;create function private.app_has_permission(text) returns boolean language sql as $$select coalesce(current_setting('test.permission',true),'true')='true'$$;create function private.mfa_allowed() returns boolean language sql as $$select coalesce(current_setting('test.mfa',true),'true')='true'$$;create table integration_accounts(id uuid primary key,owner_id uuid,provider text,enabled boolean,status text);create table workspaces(id uuid primary key,status text);`+read('tests/fixtures/orders-table-schema.sql'));
await d.exec(`alter table fulfillment_orders add primary key(id);alter table fulfillment_orders enable row level security;grant select on fulfillment_orders to authenticated;create policy owner on fulfillment_orders to authenticated using(owner_id=private.app_workspace_owner_id());`);
await d.exec(read('supabase/migrations/20261019143018_orders_dashboard_tariff_kpi_parity.sql'));
await d.exec(read('supabase/migrations/20261020072636_pickup_reports.sql'));await d.exec(read('supabase/migrations/20261020095712_pickup_dashboard_membership.sql'));await d.exec(read('supabase/migrations/20261020102813_pickup_report_sort.sql'));

await d.exec(read('supabase/migrations/20261022053808_shipment_tracking_shadow.sql'));await d.exec(read('supabase/migrations/20261022060055_shipment_tracking_provider_event_time.sql'));
await d.exec(read('supabase/migrations/20261022060202_shipment_tracking_ui_release.sql'));
if(mode!=='legacy')for(const file of ['20261022065250_orders_incremental_classified_projection.sql','20261022070148_orders_incremental_projection_activate.sql','20261022085809_orders_projection_single_enqueue.sql']){if(mode==='shadow'&&file.includes('70148'))continue;await d.exec(read('tests/fixtures/applied-orders-projection/'+file));}
await d.exec(read('supabase/migrations/20261022093845_shipment_tracking_projection_compatibility.sql'));
const hash=async()=>(await d.query<any>("select md5(pg_get_functiondef(oid)) hash from pg_proc where proname='orders_dashboard_pickup_v1'")).rows[0].hash;
const before=await hash();
const implBefore=(await d.query<any>("select md5(pg_get_functiondef(oid)) hash from pg_proc where proname='mfa_impl_orders_dashboard_pickup_v1'")).rows[0].hash;
if(mode==='active-disabled')await d.exec('update private.orders_projection_control set read_enabled=false,maintenance_enabled=false');
await d.exec(read('supabase/migrations/20261022125659_orders_workbench.sql'));
expect((await d.query<any>("select count(*)::int n from pg_proc where proname='orders_workbench_v1'")).rows[0].n).toBe(1);
expect(await hash()).toBe(before);
expect((await d.query<any>("select md5(pg_get_functiondef(oid)) hash from pg_proc where proname='mfa_impl_orders_dashboard_pickup_v1'")).rows[0].hash).toBe(implBefore);
if(mode==='active-disabled')expect((await d.query<any>('select read_enabled,maintenance_enabled from private.orders_projection_control')).rows[0]).toEqual({read_enabled:false,maintenance_enabled:false});
await d.exec(`set test.owner='11111111-1111-1111-1111-111111111111';insert into workspaces values('11111111-1111-1111-1111-111111111111','active');insert into integration_accounts values('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','sendcloud',true,'active');
insert into fulfillment_orders(id,owner_id,shipping_integration_account_id,sendcloud_id,source_status,shipping_provider,sendcloud_parcel_id,label_created_at,tracking_number,order_created_at,shipping_address,items,raw_payload) select md5(n::text)::uuid,'11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',n::text,case when n=1 then 'open' else 'SHIPPED' end,'sendcloud',case when n>1 then n end,case when n>1 then now() end,'T'||n,now()-interval '100 days',jsonb_build_object('country_code',case when n=10 then 'FR' else 'ES' end),'[]','{}' from generate_series(1,10)n;
select tracking_seed_shadow();update shipment_tracking_state set normalized_state='in_transit',movement_at=now()-interval '4 days',last_checked_at=now(),observed_at=now();
update shipment_tracking_state set normalized_state='delivered' where order_id=md5('3')::uuid;
update shipment_tracking_state set normalized_state='returned' where order_id=md5('4')::uuid;
update shipment_tracking_state set normalized_state='cancelled' where order_id=md5('5')::uuid;
update shipment_tracking_state set normalized_state='exception' where order_id=md5('6')::uuid;
update shipment_tracking_state set movement_at=null,raw_event_time=to_char((now() at time zone 'Europe/Madrid')-interval '4 days','YYYY-MM-DD')||'T10:00:00' where order_id=md5('7')::uuid;
update shipment_tracking_state set movement_at=null,raw_event_time='2026-02-31T10:00:00' where order_id=md5('8')::uuid;
update shipment_tracking_state set movement_at=now()-interval '2 days' where order_id=md5('9')::uuid;
update shipment_tracking_state set normalized_state=null,movement_at=null where order_id=md5('10')::uuid;`);
const call=async(args="")=>{await d.exec('set role authenticated');try{return (await d.query<any>('select orders_workbench_v1('+args+') data')).rows[0].data}finally{await d.exec('reset role')}};
const issues=await call("p_state=>'issues',p_from=>current_date,p_to=>current_date,p_page_size=>1");expect(issues.total).toBe(3);expect(issues.rows).toHaveLength(1);expect(issues.rows[0].is_attention).toBeUndefined();expect(issues.counters.issues).toBe(3);expect(issues.counters.pending).toBe(1);expect(issues.counters.shipped).toBe(8);
expect((await call("p_state=>'pending',p_from=>current_date,p_to=>current_date")).total).toBe(1);
expect((await call("p_state=>'issues',p_tracking_stale_days=>5")).total).toBe(1);
expect((await call("p_state=>'issues',p_selection_ids_only=>true,p_selection_all=>true")).total).toBe(3);
expect((await call("p_state=>'issues',p_country=>'ES'")).facets.countries).toEqual(['ES','FR']);
expect((await call("p_state=>'issues',p_query=>'FR'")).facets.countries).toEqual(['FR']);
expect((await call("p_state=>'issues',p_from=>current_date,p_to=>current_date,p_page=>1,p_page_size=>1")).counters).toEqual(issues.counters);
await d.exec("update fulfillment_orders set source_status='cancelled' where id=md5('6')::uuid");expect((await call("p_state=>'issues'")).total).toBe(2);
await d.exec("update fulfillment_orders set source_status='SHIPPED' where id=md5('6')::uuid");
await d.exec("update shipment_tracking_state set movement_at=now()-interval '3 days' where order_id=md5('9')::uuid");expect((await call("p_state=>'issues'")).total).toBe(4);
await d.exec("update shipment_tracking_state set movement_at=now()+interval '1 day' where order_id=md5('9')::uuid");expect((await call("p_state=>'issues'")).total).toBe(3);
await expect(call("p_state=>'all',p_selected_ids=>array(select md5(n::text)::uuid from generate_series(1,2001)n)")).rejects.toThrow(/LIMIT/);
expect((await call("p_state=>'issues',p_selection_ids_only=>true")).total).toBe(0);
expect((await call("p_state=>'issues',p_selected_ids=>array[md5('2')::uuid,md5('3')::uuid]")).total).toBe(1);
if(mode==='active'){
 await d.exec("select private.orders_dashboard_projection_repair_enqueue('11111111-1111-1111-1111-111111111111',1000);select private.orders_dashboard_projection_reconcile(1000)");
 expect((await call("p_state=>'issues'")).total).toBe(3);
 await d.exec("update shipment_tracking_state set normalized_state='delivered' where order_id=md5('2')::uuid");expect((await call("p_state=>'issues'")).total).toBe(2);
 await d.exec('update private.orders_projection_control set read_enabled=false,maintenance_enabled=false');expect((await call("p_state=>'issues'")).total).toBe(2);
}
await d.exec("set test.owner='99999999-9999-9999-9999-999999999999'");expect((await call("p_state=>'issues'")).total).toBe(0);
await d.exec("set test.owner='11111111-1111-1111-1111-111111111111';set test.mfa='false'");await expect(call()).rejects.toThrow('MFA_REQUIRED');
await d.exec("set test.mfa='true';set test.permission='false'");await expect(call()).rejects.toThrow('PICKUP_ORDERS_PERMISSION_REQUIRED');
}finally{await d.close()}},120000);
