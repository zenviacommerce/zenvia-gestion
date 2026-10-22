// REVIEW ONLY: known-red compatibility reproducer; run with reviews/vitest.review.config.ts.
// No migration in this checkout is changed; applied projection SQL is read as a local fixture.
import {it,expect} from 'vitest';import {PGlite} from '@electric-sql/pglite';import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';
const appliedRoot=process.env.APPLIED_PERF_ROOT;
if(!appliedRoot)throw new Error('Set APPLIED_PERF_ROOT to a local checkout containing approved 65250/70148/85809 SQL fixtures; no database is used.');
const read=(p:string)=>p.includes('20261022060202')&&process.env.REVIEW_ADAPTER==='historical'?execFileSync('git',['show','b37749c:supabase/migrations/20261022060202_shipment_tracking_ui_release.sql'],{encoding:'utf8'}):readFileSync(/202610220(65250|70148|85809)_/.test(p)?appliedRoot+'/'+p:p,'utf8');
it('held legacy UI preserves normalized fresh-cache reads against actually applied async projection',async()=>{const d=new PGlite();try{
await d.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema private;create table private.mfa_function_manifest(signature text primary key,function_oid oid not null,implementation regprocedure not null,original_definition text not null,wrapper_hash text not null);create function auth.uid() returns uuid language sql as $$select current_setting('test.owner')::uuid$$;create function public.security_mfa_assert(boolean) returns void language plpgsql as $$begin if coalesce(current_setting('test.mfa',true),'true')<>'true' then raise exception 'MFA_REQUIRED';end if;end$$;create table public.business_settings(owner_id uuid,legal_name text,tax_id text,address_line1 text,address_line2 text,postal_code text,city text,province text,country_code text,email text,phone text,iban text);grant usage on schema private to authenticated,service_role;create function private.app_workspace_owner_id() returns uuid language sql as $$select current_setting('test.owner')::uuid$$;create function private.app_has_permission(text) returns boolean language sql as $$select true$$;create function private.mfa_allowed() returns boolean language sql as $$select coalesce(current_setting('test.mfa',true),'true')='true'$$;create table integration_accounts(id uuid primary key,owner_id uuid,provider text,enabled boolean,status text);create table workspaces(id uuid primary key,status text);`+read('tests/fixtures/orders-table-schema.sql'));
await d.exec(`alter table fulfillment_orders add primary key(id);alter table fulfillment_orders enable row level security;grant select on fulfillment_orders to authenticated;create policy owner on fulfillment_orders to authenticated using(owner_id=private.app_workspace_owner_id());`);
await d.exec(read('supabase/migrations/20261019143018_orders_dashboard_tariff_kpi_parity.sql'));
await d.exec(read('supabase/migrations/20261020072636_pickup_reports.sql'));await d.exec(read('supabase/migrations/20261020095712_pickup_dashboard_membership.sql'));
const wrapperBefore=(await d.query<any>("select md5(pg_get_functiondef(oid)) hash from pg_proc where proname='orders_dashboard_pickup_v1'")).rows[0].hash;
await d.exec(read('supabase/migrations/20261022053808_shipment_tracking_shadow.sql'));await d.exec(read('supabase/migrations/20261022060055_shipment_tracking_provider_event_time.sql'));

await d.exec(`insert into workspaces values('11111111-1111-1111-1111-111111111111','active');insert into integration_accounts values('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','sendcloud',true,'active');insert into fulfillment_orders(id,owner_id,shipping_integration_account_id,sendcloud_id,source_status,tracking_number,shipping_provider,sendcloud_parcel_id,label_created_at,order_created_at,tracking_status_code,items,shipping_address,raw_payload) select md5(n::text)::uuid,'11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',n::text,'SHIPPED','T'||n,'sendcloud',n,now(),now(),'SHIPPED','[]','{}','{}' from generate_series(1,60)n;select tracking_seed_shadow();update shipment_tracking_state set normalized_state='exception',raw_code='delivery_failed',event_at='2026-10-20T10:00:00Z',movement_at='2026-10-20T10:00:00Z';set role authenticated;set test.owner='11111111-1111-1111-1111-111111111111';`);
await d.exec("reset role");await d.exec(read('supabase/migrations/20261022065250_orders_incremental_classified_projection.sql'));await d.exec(read('supabase/migrations/20261022070148_orders_incremental_projection_activate.sql'));await d.exec(read('supabase/migrations/20261022085809_orders_projection_single_enqueue.sql'));await d.exec(read('supabase/migrations/20261022060202_shipment_tracking_ui_release.sql'));await d.exec("set role authenticated");
const issue=(await d.query<any>("select orders_dashboard_pickup_v1(p_state=>'all',p_tracking=>'issue') data")).rows[0].data;
expect(issue.total,'fresh cache must expose normalized exception after held UI upgrade').toBe(60);
expect(issue.rows[0].tracking_normalized_state).toBe('exception');
await d.exec("reset role");
// Independently exercise dirty-cache behaviour, rather than only SQL text.
const refDef=(await d.query<any>("select original_definition from private.orders_projection_rpc_backup where signature like '%mfa_impl_orders_dashboard_pickup_v1%'")).rows[0].original_definition;
await d.exec(refDef.replace('FUNCTION private.mfa_impl_orders_dashboard_pickup_v1(', 'FUNCTION public.review_reference_pickup('));
await d.exec("UPDATE fulfillment_orders SET source_channel='amazon',source_status='Pending' WHERE id=md5('2')::uuid;SET ROLE authenticated");
const stale=(await d.query<any>("select orders_dashboard_pickup_v1(p_state=>'all',p_tracking=>'issue') actual,review_reference_pickup(p_state=>'all',p_tracking=>'issue') reference")).rows[0];
expect(stale.actual.total,'dirty group must fall back after a business source UPDATE').toBe(stale.reference.total);
await d.exec('RESET ROLE');
const impl=(await d.query<any>("select prosrc from pg_proc where oid='private.mfa_impl_orders_dashboard_pickup_v1(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[],text,boolean)'::regprocedure")).rows[0].prosrc;
expect(impl,'upgrade must preserve 70148 eligibility gate').toContain('projection_gate');
const refresh=(await d.query<any>("select prosrc from pg_proc where oid='private.orders_dashboard_projection_refresh(uuid,text)'::regprocedure")).rows[0].prosrc;
expect(refresh,'upgrade must preserve version stamps').toContain('orders_projection_versions');
const sourceTrigger=(await d.query<any>("select prosrc from pg_proc where oid='private.orders_dashboard_projection_changed()'::regprocedure")).rows[0].prosrc;
expect(sourceTrigger).toContain('old_key');
await d.exec("UPDATE private.orders_projection_control SET maintenance_enabled=false;UPDATE shipment_tracking_state SET normalized_state='delivered' WHERE order_id=md5('2')::uuid;SET ROLE authenticated");
const delivered=(await d.query<any>("select orders_dashboard_pickup_v1(p_state=>'all',p_tracking=>'delivered') data")).rows[0].data;
expect(delivered.total,'paused maintenance must still fall back to current normalized state').toBe(1);
}finally{await d.close()}},20000);
