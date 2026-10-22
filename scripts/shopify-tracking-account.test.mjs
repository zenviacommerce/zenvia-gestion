import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('Shopify importer leaves the local carrier account out of channel snapshots',async()=>{
 const source=await readFile('supabase/functions/shopify-orders/index.ts','utf8');
 assert.equal(/shipping_integration_account_id\s*:\s*null/.test(source),false);
});
import {PGlite} from '@electric-sql/pglite';
import {readdir} from 'node:fs/promises';
const owner='11111111-1111-1111-1111-111111111111',account='22222222-2222-2222-2222-222222222222',order='33333333-3333-3333-3333-333333333333';
async function fixture(){
 const d=new PGlite();
 await d.exec(`create role anon;create role authenticated;create role service_role;create schema private;create table integration_accounts(id uuid primary key,owner_id uuid,provider text,enabled boolean,status text);create table workspaces(id uuid primary key,status text);create table fulfillment_orders(id uuid primary key,owner_id uuid,shipping_integration_account_id uuid,shipping_provider text,tracking_number text,shipping_remote_id text,sendcloud_parcel_id bigint,label_created_at timestamptz,label_cancelled_at timestamptz,tracking_status_code text,source_channel text,source_integration_account_id uuid,last_synced_at timestamptz,raw_payload jsonb);`);
 const name=(await readdir('supabase/migrations')).find(f=>f.endsWith('_shipment_tracking_shadow.sql'));
 await d.exec(await readFile('supabase/migrations/'+name,'utf8'));
 await d.exec(await readFile('supabase/migrations/20261022133958_shopify_tracking_account_guard.sql','utf8'));
 await d.query("insert into workspaces values($1,'active')",[owner]);
 await d.query("insert into integration_accounts values($1,$2,'mrw',true,'connected')",[account,owner]);
 await d.query("insert into fulfillment_orders(id,owner_id,shipping_integration_account_id,shipping_provider,tracking_number,shipping_remote_id,label_created_at,tracking_status_code,source_channel)values($1,$2,$3,'mrw','TEST-MRW','TEST-MRW',now(),'READY_TO_SEND','shopify')",[order,owner,account]);
 return d;
}
test('Shopify MRW direct label survives legacy NULL refresh and enters account-isolated tracking',async()=>{
 const d=await fixture();try{
 await d.query('update fulfillment_orders set shipping_integration_account_id=null,last_synced_at=now() where id=$1',[order]);
 assert.equal((await d.query('select shipping_integration_account_id from fulfillment_orders')).rows[0].shipping_integration_account_id,account);
 await d.exec('select tracking_seed_shadow()');
 assert.equal((await d.query('select account_id,provider from shipment_tracking_state')).rows[0].account_id,account);
 assert.equal((await d.query('select * from tracking_claim($1,25)',[crypto.randomUUID()])).rows.length,1);
 }finally{await d.close()}
});
test('guard covers MRW before PDF retrieval but allows cancellation, relabel and intentional account replacement',async()=>{
 for(const change of ["label_cancelled_at=now()","shipping_remote_id='REPLACED'","source_channel='amazon'","owner_id='55555555-5555-5555-5555-555555555555'"]){
 const d=await fixture();try{await d.exec(`update fulfillment_orders set shipping_integration_account_id=null,last_synced_at=now(),${change}`);assert.equal((await d.query('select shipping_integration_account_id from fulfillment_orders')).rows[0].shipping_integration_account_id,null)}finally{await d.close()}
 }
 const d=await fixture();try{
 await d.exec('update fulfillment_orders set label_created_at=null');
 await d.exec('update fulfillment_orders set shipping_integration_account_id=null,last_synced_at=now()');
 assert.equal((await d.query('select shipping_integration_account_id from fulfillment_orders')).rows[0].shipping_integration_account_id,account);
 await d.exec("update fulfillment_orders set shipping_integration_account_id='55555555-5555-5555-5555-555555555555',last_synced_at=now()");
 assert.equal((await d.query('select shipping_integration_account_id from fulfillment_orders')).rows[0].shipping_integration_account_id,'55555555-5555-5555-5555-555555555555');
 await d.exec('select tracking_seed_shadow()');assert.equal((await d.query('select * from shipment_tracking_state')).rows.length,0);
 }finally{await d.close()}
});
