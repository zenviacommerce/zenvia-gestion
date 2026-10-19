import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync('supabase/functions/_shared/amazon/orders.ts','utf8');
function fixture(){
 const rows=[],writes=[],cancellations=[];const job={owner_id:'owner',amazon_account_id:'account',marketplace_id:'market',window_from:'2026-10-18T00:00:00Z',window_to:'2026-10-18T01:00:00Z'};
 let orders=[{orderId:'ORDER',createdTime:'2026-10-17T00:00:00Z',lastUpdatedTime:'2026-10-18T00:00:00Z',fulfillment:{fulfilledBy:'MERCHANT',fulfillmentStatus:'UNSHIPPED'},recipient:{deliveryAddress:{name:'Synthetic',city:'City',countryCode:'ES'}},orderItems:[]}];
 const admin={from(table){let action='select',patch,filters=[];const q={select(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},neq(){return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},update(p){action='update';patch=p;return q},insert(p){action='insert';patch=p;return q},upsert(){return q},maybeSingle(){return Promise.resolve({data:table==='integration_accounts'?{id:'integration',display_name:'Amazon',config:{operationalOrdersDirect:{status:'ready'}}}:table==='app_settings'?{config:{}}:null,error:null})},then(resolve,reject){return Promise.resolve().then(()=>{
 if(table!=='fulfillment_orders')return {data:table==='order_cancellation_operations'?structuredClone(cancellations):[],error:null};
 const selected=rows.filter(r=>filters.every(f=>f(r)));
 if(action==='insert'){rows.push({id:'row',...structuredClone(patch)});writes.push(action)}
 if(action==='update')for(const row of selected){Object.assign(row,structuredClone(patch));writes.push(action)}
 return {data:structuredClone(selected),error:null};}).then(resolve,reject)}};return q}};
 const exp={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exp,require:n=>n.includes('sp-api')?{spApiRequest:async()=>({orders})}:{loadAmazonSpApiCredentials:async()=>({})},console,Date,Map,Set,JSON});
 return {rows,writes,cancellations,job,get orders(){return orders},sync:()=>exp.syncOrdersJob(admin,job),reconcile:()=>exp.reconcileOperationalAmazonStates(admin,orders,'owner')};
}
test('full page sync: unchanged business data performs zero operational UPDATE and keeps last_synced_at',async()=>{
 const f=fixture();await f.sync();const stamp=f.rows[0].last_synced_at;f.writes.length=0;await f.sync();assert.equal(f.writes.length,0);assert.equal(f.rows[0].last_synced_at,stamp);assert.ok(stamp);
});
test('full page sync: one status change performs exactly one UPDATE including tracking',async()=>{
 const f=fixture();await f.sync();f.writes.length=0;f.orders[0].fulfillment.fulfillmentStatus='SHIPPED';f.orders[0].packages=[{trackingNumber:'TRACK',carrier:'MRW',shipTime:'2026-10-18T01:00:00Z'}];await f.sync();assert.deepEqual(f.writes,['update']);assert.equal(f.rows[0].tracking_number,'TRACK');assert.equal(f.rows[0].source_status,'SHIPPED');f.writes.length=0;await f.sync();assert.equal(f.writes.length,0);
});
test('standalone reconcile does not rewrite unchanged data or timestamps',async()=>{
 const f=fixture();await f.sync();f.writes.length=0;await f.reconcile();assert.equal(f.writes.length,0);f.orders[0].fulfillment.fulfillmentStatus='CANCELED';await f.reconcile();assert.deepEqual(f.writes,['update']);
});
test('JSON key order and equivalent PostgreSQL timestamp representation do not cause UPDATE',async()=>{
 const f=fixture();await f.sync();f.rows[0].shipping_address=Object.fromEntries(Object.entries(f.rows[0].shipping_address).reverse());f.rows[0].order_updated_at='2026-10-18T00:00:00+00:00';f.writes.length=0;await f.sync();assert.equal(f.writes.length,0);
});
test('business change persists while local shipping edits and existing logistics are retained',async()=>{
 const f=fixture();await f.sync();Object.assign(f.rows[0],{tracking_number:'LOCAL',shipping_provider:'mrw',shipping_address:{name:'Local'},raw_payload:{...f.rows[0].raw_payload,_zenvia_local_shipping_updated_at:'saved'}});f.orders[0].proceeds={grandTotal:{amount:12,currencyCode:'EUR'}};f.writes.length=0;await f.sync();assert.deepEqual(f.writes,['update']);assert.equal(f.rows[0].total_amount,12);assert.equal(f.rows[0].shipping_address.name,'Local');assert.equal(f.rows[0].tracking_number,'LOCAL');
});
test('purged orders remain redacted and unchanged on repeated full sync',async()=>{
 const f=fixture();await f.sync();Object.assign(f.rows[0],{pii_purged_at:'2026-10-18T00:00:00Z',customer_name:null,customer_email:null,customer_phone:null,shipping_address:{},raw_payload:{},items:[]});f.writes.length=0;await f.sync();assert.equal(f.writes.length,0);assert.equal(f.rows[0].customer_name,null);
});
test('stale Amazon state cannot rewrite an already fulfilled order or its observation time',async()=>{
 const f=fixture();await f.sync();Object.assign(f.rows[0],{source_status:'SHIPPED',fulfilled_at:'2026-10-18T03:00:00Z',order_updated_at:'2026-10-18T03:00:00Z'});f.writes.length=0;await f.sync();assert.equal(f.writes.length,0);assert.equal(f.rows[0].source_status,'SHIPPED');
});
test('full sync updates status on every legacy copy, with no second write of its canonical row',async()=>{
 const f=fixture();await f.sync();f.rows.push({...structuredClone(f.rows[0]),id:'legacy-copy'});f.writes.length=0;f.orders[0].fulfillment.fulfillmentStatus='SHIPPED';await f.sync();assert.ok(f.rows.every(row=>row.source_status==='SHIPPED'));assert.equal(f.writes.length,2);f.writes.length=0;await f.sync();assert.equal(f.writes.length,0);
});

test('nonempty items do not receive optional-null writes on unchanged replay',async()=>{
 const f=fixture();f.orders[0].orderItems=[{orderItemId:'ITEM',quantityOrdered:1,product:{sellerSku:'SKU'}}];await f.sync();f.writes.length=0;await f.sync();assert.equal(f.writes.length,0);
});
test('confirmed local cancellation is preserved before comparison while Amazon remains unshipped',async()=>{
 const f=fixture();await f.sync();f.rows[0].source_status='cancelled';f.cancellations.push({order_id:'row',kind:'order',status:'confirmed'});f.writes.length=0;await f.sync();assert.equal(f.writes.length,0);assert.equal(f.rows[0].source_status,'cancelled');
});
test('confirmed label cancellation does not repeatedly restore tracking removed by SQL',async()=>{
 const f=fixture();f.orders[0].fulfillment.fulfillmentStatus='SHIPPED';f.orders[0].packages=[{trackingNumber:'CANCELLED-TRACK',carrier:'MRW',shipTime:'2026-10-18T01:00:00Z'}];await f.sync();Object.assign(f.rows[0],{tracking_number:null,tracking_status_code:null,tracking_status_message:null,tracking_updated_at:null,fulfilled_at:null});f.cancellations.push({order_id:'row',kind:'label',status:'confirmed',details:{trackingNumber:'CANCELLED-TRACK'}});f.writes.length=0;await f.sync();assert.equal(f.writes.length,0);assert.equal(f.rows[0].tracking_number,null);
});
test('cancelled old package cannot overwrite a subsequent replacement label',async()=>{
 const f=fixture();f.orders[0].fulfillment.fulfillmentStatus='SHIPPED';f.orders[0].packages=[{trackingNumber:'OLD',carrier:'MRW',shipTime:'2026-10-18T01:00:00Z'}];await f.sync();Object.assign(f.rows[0],{label_created_at:'2026-10-18T02:00:00Z',shipping_remote_id:'NEW-LABEL',tracking_number:'NEW',tracking_status_code:'NEW',tracking_status_message:'New label',fulfilled_at:'2026-10-18T02:00:00Z'});f.cancellations.push({order_id:'row',kind:'label',status:'confirmed',details:{trackingNumber:'OLD'}});f.writes.length=0;await f.sync();assert.equal(f.writes.length,0);assert.equal(f.rows[0].tracking_number,'NEW');assert.equal(f.rows[0].shipping_remote_id,'NEW-LABEL');
});

test('Amazon cannot replace the actual local shipment carrier or service in either sync path',async()=>{
 for(const provider of ['envia','sendcloud','mrw'])for(const path of ['sync','reconcile']){
  const f=fixture();await f.sync();Object.assign(f.rows[0],{shipping_provider:provider,shipping_remote_id:'LOCAL-SHIPMENT',label_created_at:'2026-10-18T01:00:00Z',carrier_code:'correosExpress',carrier_name:'Correos Express',shipping_option_code:'epaq_24',shipping_service_name:'ePaq 24',shipping_cost_amount:4.57,shipping_cost_source:'provider_actual'});
  f.orders[0].fulfillment.fulfillmentStatus='SHIPPED';f.orders[0].packages=[{trackingNumber:'TRACK',carrier:'MRW',shippingService:'MRW Urgent 19:00',shipTime:'2026-10-18T01:00:00Z'}];
  await f[path]();assert.equal(f.rows[0].carrier_code,'correosExpress',`${provider}/${path}`);assert.equal(f.rows[0].carrier_name,'Correos Express');assert.equal(f.rows[0].shipping_service_name,'ePaq 24');assert.equal(f.rows[0].shipping_cost_amount,4.57);assert.equal(f.rows[0].source_status,'SHIPPED');
  f.writes.length=0;await f[path]();assert.equal(f.writes.length,0);
 }
});
test('Amazon still supplies carrier and service for externally fulfilled shipments without local ownership',async()=>{
 const f=fixture();await f.sync();f.orders[0].fulfillment.fulfillmentStatus='SHIPPED';f.orders[0].packages=[{trackingNumber:'TRACK',carrier:'MRW',shippingService:'Urgent',shipTime:'2026-10-18T01:00:00Z'}];await f.sync();assert.equal(f.rows[0].carrier_code,'mrw');assert.equal(f.rows[0].shipping_service_name,'Urgent');
});

test('cancelled MRW label never displaces its active Correos replacement',async()=>{
 const f=fixture();await f.sync();Object.assign(f.rows[0],{shipping_provider:'envia',shipping_remote_id:'CORREOS-ACTIVE',tracking_number:'CORREOS-ACTIVE',label_created_at:'2026-10-18T02:00:00Z',carrier_code:'correosExpress',carrier_name:'Correos Express',shipping_option_code:'epaq_24',shipping_service_name:'ePaq 24',shipping_cost_amount:4.57,shipping_cost_source:'provider_actual'});
 f.cancellations.push({order_id:'row',kind:'label',status:'confirmed',details:{shipmentRef:'MRW-CANCELLED',trackingNumber:'MRW-CANCELLED'}});
 f.orders[0].fulfillment.fulfillmentStatus='SHIPPED';f.orders[0].packages=[{trackingNumber:'MRW-CANCELLED',carrier:'MRW',shippingService:'MRW cancelled service',shipTime:'2026-10-18T02:00:00Z'}];
 await f.sync();assert.equal(f.rows[0].carrier_code,'correosExpress');assert.equal(f.rows[0].shipping_service_name,'ePaq 24');assert.equal(f.rows[0].shipping_remote_id,'CORREOS-ACTIVE');assert.equal(f.rows[0].shipping_cost_amount,4.57);assert.equal(f.rows[0].tracking_number,'CORREOS-ACTIVE');assert.equal(f.rows[0].marketplace_carrier,'MRW');
});
