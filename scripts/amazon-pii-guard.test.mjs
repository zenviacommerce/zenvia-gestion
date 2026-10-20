import {loadOrderWeightFixture} from './order-weight-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';

const migration=readFileSync(new URL('../supabase/migrations/20261016185733_amazon_buyer_pii_guard.sql',import.meta.url),'utf8');
const owner='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const order='123-1234567-1234567';
const canary='SYNTHETIC-BUYER-CANARY';
async function fixture(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema private;
 create table public.fulfillment_orders(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null,source_channel text,order_id text,order_number text,
 customer_name text,customer_email text,customer_phone text,shipping_address jsonb default '{}',billing_address jsonb default '{}',
 raw_payload jsonb default '{}',items jsonb default '[]',total_amount numeric,currency text,
 order_created_at timestamptz,order_updated_at timestamptz,fulfilled_at timestamptz,last_synced_at timestamptz,
 tracking_number text,tracking_url text,tracking_status_message text,tracking_status_code text,
 shipping_label_url text,shipping_remote_id text,sendcloud_parcel_id bigint,sendcloud_shipment_id text,sendcloud_remote_id text,
 amazon_tracking_sync_error text,shopify_tracking_sync_error text,sendcloud_id text,integration_id bigint,
 source_integration_account_id uuid,integration_name text,integration_type text,source_status text,
 carrier_code text,carrier_name text,shipping_service_name text,tracking_updated_at timestamptz,
 pii_purged_at timestamptz,destination_country_code text
 );`);
 await db.exec(migration);
 return db;
}
async function seed(db,who=owner,channel='amazon'){
 return (await db.query(`insert into fulfillment_orders(owner_id,source_channel,order_id,order_number,customer_name,customer_email,customer_phone,shipping_address,raw_payload,items,total_amount,currency,order_created_at)
 values($1,$2,$3,$3,$4,$4,$4,$5,$6,$7,12.34,'EUR',now()-interval '100 days') returning *`,[who,channel,order,canary,{name:canary,address_line_1:canary,country_code:'ES'},{unknown:{buyer:canary}},[{sku:'SKU-1',quantity:2,name:canary,unit_price:{value:6.17,currency:'EUR'},properties:{custom:canary}}]])).rows[0];
}
function assertClean(row){
 for(const k of ['customer_name','customer_email','customer_phone','tracking_number','tracking_url','shipping_label_url'])assert.equal(row[k],null,k);
 assert.deepEqual(row.shipping_address,{});assert.deepEqual(row.billing_address,{});assert.deepEqual(row.raw_payload,{});
 assert.ok(row.pii_purged_at);assert.equal(row.destination_country_code,'ES');assert.equal(Number(row.total_amount),12.34);
 assert.equal(row.items[0].sku,'SKU-1');assert.equal(row.items[0].quantity,2);assert.ok(!JSON.stringify(row).includes(canary));
}
test('SQL runs on PostgreSQL 17, cleans all PII and preserves the economic record',async()=>{
 const db=await fixture();try{
 assert.match((await db.query('select version() v')).rows[0].v,/PostgreSQL 17\./);
 const row=await seed(db);await db.query('update fulfillment_orders set pii_purged_at=now() where id=$1',[row.id]);
 assertClean((await db.query('select * from fulfillment_orders where id=$1',[row.id])).rows[0]);
 }finally{await db.close();}
});
test('sync cannot clear purge marker or write fresh PII, even after changing source/account fields',async()=>{
 const db=await fixture();try{
 const row=await seed(db);await db.query('update fulfillment_orders set pii_purged_at=now() where id=$1',[row.id]);
 await db.query(`update fulfillment_orders set pii_purged_at=null,customer_name=$2,customer_email=$2,customer_phone=$2,shipping_address=$3,raw_payload=$4 where id=$1`,[row.id,canary,{name:canary,country_code:'ES'},{buyer:canary}]);
 assertClean((await db.query('select * from fulfillment_orders where id=$1',[row.id])).rows[0]);
 await assert.rejects(db.query(`update fulfillment_orders set source_channel='other' where id=$1`,[row.id]));
 await assert.rejects(db.query('update fulfillment_orders set owner_id=$2 where id=$1',[row.id,other]));
 }finally{await db.close();}
});
test('tombstone survives row deletion and a sync recreation, without affecting another tenant',async()=>{
 const db=await fixture();try{
 const row=await seed(db);await db.query('update fulfillment_orders set pii_purged_at=now() where id=$1',[row.id]);
 await db.query('delete from fulfillment_orders where id=$1',[row.id]);
 assertClean(await seed(db));assert.equal((await seed(db,other)).customer_name,canary);
 assert.equal((await seed(db,other,'shopify')).customer_name,canary);
 }finally{await db.close();}
});
test('a later real Amazon operational import is cleaned by the SQL guard',async()=>{
 const db=await fixture();try{
 const row=await seed(db);await db.query("update fulfillment_orders set order_id='legacy-remote-id' where id=$1",[row.id]);
 await db.query('update fulfillment_orders set pii_purged_at=now() where id=$1',[row.id]);
 const source=readFileSync(new URL('../supabase/functions/_shared/amazon/orders.ts',import.meta.url),'utf8');
 const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText+'\nexports.operationalImport=upsertOperationalAmazonOrders;',{
 exports,require:name=>name.includes('orderPackageWeight')?loadOrderWeightFixture():({}),Date,Map,Set,console
 });
 const admin={from(table){let patch;const filters=[];const q={
 select(){return q},eq(k,v){filters.push([k,v]);return q},neq(){return q},in(){return q},
 update(v){patch=v;return q},
 async maybeSingle(){return {data:table==='integration_accounts'?{id:'33333333-3333-4333-8333-333333333333',display_name:'Synthetic',config:{}}:{value:{shipping:{defaultWeightKg:1}}},error:null}},
 then(resolve,reject){return(async()=>{
 if(table!=='fulfillment_orders')return {data:[],error:null};
 if(patch){const keys=Object.keys(patch),vals=Object.values(patch);const where=filters.map(([k,v])=>{vals.push(v);return '"'+k+'"=$'+vals.length}).join(' and ');
 await db.query('update fulfillment_orders set '+keys.map((k,i)=>'"'+k+'"=$'+(i+1)).join(',')+' where '+where,vals);return {error:null};}
 return {data:(await db.query('select * from fulfillment_orders where id=$1',[row.id])).rows,error:null};
 })().then(resolve,reject)}
 };return q}};
 const incoming={orderId:order,createdTime:new Date(Date.now()-100*86400000).toISOString(),lastUpdatedTime:new Date().toISOString(),fulfillment:{fulfilledBy:'MERCHANT',fulfillmentStatus:'SHIPPED'},buyer:{buyerName:canary,buyerEmail:canary},recipient:{deliveryAddress:{name:canary,addressLine1:canary,countryCode:'ES',phone:canary}},orderItems:[{orderItemId:'ITEM-1',quantityOrdered:2,product:{sellerSku:'SKU-1',title:canary},proceeds:{proceedsTotal:{amount:12.34,currencyCode:'EUR'}}}],proceeds:{grandTotal:{amount:12.34,currencyCode:'EUR'}}};
 assert.equal(await exports.operationalImport(admin,[incoming],{owner_id:owner,amazon_account_id:'44444444-4444-4444-8444-444444444444',marketplace_id:'ES'}),1);
 assertClean((await db.query('select * from fulfillment_orders where id=$1',[row.id])).rows[0]);
 }finally{await db.close();}
});
test('purged markers are service-only, and legacy purchase deadline is exactly 60 days',async()=>{
 const db=await fixture();try{
 const privileges=(await db.query(`select has_table_privilege('anon','private.amazon_pii_tombstones','select') anon,has_table_privilege('authenticated','private.amazon_pii_tombstones','select') auth`)).rows[0];
 assert.deepEqual(privileges,{anon:false,auth:false});
 const rows=(await db.query(`select private.amazon_pii_deadline('2026-01-01Z',null) legacy,private.amazon_pii_deadline('2026-01-01Z','2026-01-05Z') delivered`)).rows[0];
 assert.equal(new Date(rows.legacy).toISOString(),'2026-03-02T00:00:00.000Z');assert.equal(new Date(rows.delivered).toISOString(),'2026-02-04T00:00:00.000Z');
 }finally{await db.close();}
});
test('purchase deadline is timezone-independent across daylight saving changes',async()=>{
 const db=await fixture();try{
 await db.exec("set timezone='Europe/Madrid'");
 const {rows}=await db.query("select private.amazon_pii_deadline('2026-03-01T12:00:00Z',null) d");
 assert.equal(new Date(rows[0].d).toISOString(),'2026-04-30T12:00:00.000Z');
 }finally{await db.close();}
});
test('pilot touches exactly ten synthetic orders, leaves invoices intact and is idempotent',async()=>{
 const db=await fixture();try{
 await db.exec("create table sales_invoices(id int primary key,client_name text,status text);insert into sales_invoices values(1,'DIRECT-CLIENT-SYNTHETIC','paid')");
 const ids=[];
 for(let n=0;n<14;n++)ids.push((await db.query(`insert into fulfillment_orders(owner_id,source_channel,order_id,order_number,customer_name,order_created_at) values($1,'amazon',$2,$2,$3,now()-interval '100 days') returning id`,[owner,`123-1234567-${String(1234500+n)}`,canary])).rows[0].id);
 const chosen=ids.slice(0,10);
 await db.query('update fulfillment_orders set pii_purged_at=now() where id=any($1::uuid[])',[chosen]);
 const first=(await db.query('select id,pii_purged_at,customer_name from fulfillment_orders order by id')).rows;
 assert.equal(first.filter(r=>r.pii_purged_at).length,10);assert.equal(first.filter(r=>r.customer_name===canary).length,4);
 await db.query('update fulfillment_orders set pii_purged_at=now(),customer_name=$2 where id=any($1::uuid[])',[chosen,canary]);
 assert.deepEqual((await db.query('select id,pii_purged_at,customer_name from fulfillment_orders order by id')).rows,first);
 assert.equal((await db.query('select client_name from sales_invoices')).rows[0].client_name,'DIRECT-CLIENT-SYNTHETIC');
 }finally{await db.close();}
});
test('recipient fallback does not prepare a patch for a purged order',()=>{
 const exports={};const source=readFileSync(new URL('../supabase/functions/_shared/recipientFallback.ts',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
 assert.equal(exports.recipientPatch({pii_purged_at:'2026-01-01',shipping_address:{},raw_payload:{}},{name:canary,address_line_1:canary},'account','sendcloud'),null);
});
