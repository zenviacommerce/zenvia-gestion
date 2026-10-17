// Print a real PostgreSQL verification transaction. It creates ONLY pg_temp
// synthetic fixtures and rolls every DDL/DML operation back. Never buyer data.
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root),'utf8');
let schema=read('scripts/amazon-pii-guard.test.mjs').match(/await db.exec\(`([\s\S]*?)`\);/)[1].replace('create role anon;create role authenticated;create role service_role;create schema private;','');
const extra=`alter table public.fulfillment_orders add column shopify_tracking_synced_number text,add column order_action_lease uuid,add column order_action_lease_until timestamptz,add column shopify_tracking_lease_until timestamptz;
create table public.amazon_sync_jobs(id uuid primary key default gen_random_uuid(),owner_id uuid,payload jsonb not null default '{}',last_error text,status text);
create table public.amazon_sync_runs(id uuid primary key default gen_random_uuid(),owner_id uuid,checkpoint jsonb not null default '{}',error_message text);
create table public.amazon_sync_state(id uuid primary key default gen_random_uuid(),owner_id uuid,checkpoint jsonb not null default '{}');
create table public.order_cancellation_operations(id uuid primary key default gen_random_uuid(),owner_id uuid,order_id uuid,status text,reference text,details jsonb default '{}',message text,remote_id text);`;
let body=schema+read('supabase/migrations/20261016185733_amazon_buyer_pii_guard.sql')+extra+read('supabase/migrations/20261016194728_amazon_pii_bounded_runner.sql');
body=body.replaceAll('public.','pg_temp.').replaceAll('private.','pg_temp.').replaceAll('create table pg_temp.','create temporary table pg_temp.');
let sql="begin;set local statement_timeout='30s';\n"+body+read('docs/verification/sql/20261017-amazon-pii-synthetic-checks.sql')+'\nrollback;';
if(process.argv.includes('--writer')){
 const prefix=sql.slice(0,sql.indexOf('do $legacy$'));
 sql=prefix.replace('begin;','begin;set local application_name=\'zenvia_pii_writer_test\';')+'select pg_sleep(10);select pg_backend_pid() as writer_pid;rollback;';
}
if(process.argv.includes('--contender')){
 let prefix=sql.slice(0,sql.indexOf('do $legacy$'));
 prefix=prefix.replace('insert into pg_temp.fulfillment_orders(owner_id,source_channel','alter table pg_temp.fulfillment_orders disable trigger aaaa_amazon_pii_write_fence;\ninsert into pg_temp.fulfillment_orders(owner_id,source_channel');
 sql=prefix+`alter table pg_temp.fulfillment_orders enable trigger aaaa_amazon_pii_write_fence;
 do $verify$ begin begin perform pg_temp.amazon_pii_run_batch('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','pilot',10,false);raise exception 'Concurrent writer incorrectly admitted purge';exception when lock_not_available then null;end;if exists(select 1 from pg_temp.fulfillment_orders where pii_purged_at is not null) then raise exception 'Rejected purge changed rows';end if;end $verify$;
 select pg_backend_pid() as purger_pid,'writer fence refused purge with 55P03; zero changed rows' as verification;rollback;`;
}
process.stdout.write(process.argv.includes('--json')?JSON.stringify(sql):sql);
