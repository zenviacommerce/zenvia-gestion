import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
function helper(){
 const path='supabase/functions/_shared/shopifyShipment.ts';
 assert.ok(fs.existsSync(path),'Missing Shopify shipment adapter');
 return vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync(path,'utf8').replaceAll('export ',''))+'\n({confirmShopifyShipment})',{URL,Error});
}
const shipment={orderId:'gid://shopify/Order/1',number:'MRW123',company:'MRW',url:'https://mrw.es/track/123'};
function fixture({existing=[],status='OPEN',cancelled=false}={}){
 const calls=[];
 const request=async(query,variables)=>{
  calls.push({query,variables});
  if(query.includes('ZenviaShipmentOrder'))return {order:{id:shipment.orderId,cancelledAt:cancelled?'today':null,fulfillments:existing,fulfillmentOrders:{nodes:[{id:'fo1',status,assignedLocation:{location:{id:'loc1'}},supportedActions:[{action:'CREATE_FULFILLMENT'}]}],pageInfo:{hasNextPage:false}}}};
  if(query.includes('ZenviaShipmentItems'))return {fulfillmentOrder:{lineItems:{nodes:[{id:'line1',remainingQuantity:2}],pageInfo:{hasNextPage:false}}}};
  return {fulfillmentCreate:{fulfillment:{id:'ful1'},userErrors:[]}};
 };
 return {request,calls};
}
test('confirms remaining quantities and sends carrier number URL requests the Shopify shipping notification',async()=>{
 const {confirmShopifyShipment}=helper(),f=fixture();await confirmShopifyShipment(f.request,shipment);
 const input=f.calls.find(c=>c.query.includes('mutation')).variables.fulfillment;
 assert.deepEqual(JSON.parse(JSON.stringify(input)),{notifyCustomer:true,trackingInfo:{number:'MRW123',company:'MRW',url:'https://mrw.es/track/123'},lineItemsByFulfillmentOrder:[{fulfillmentOrderId:'fo1',fulfillmentOrderLineItems:[{id:'line1',quantity:2}]}]});
});
test('retry after a remote success never creates a second fulfillment',async()=>{
 const {confirmShopifyShipment}=helper(),f=fixture({status:'CLOSED',existing:[{id:'ful1',status:'SUCCESS',trackingInfo:[{number:'MRW123'}]}]});
 await confirmShopifyShipment(f.request,shipment);assert.equal(f.calls.filter(c=>c.query.includes('mutation')).length,0);
});
test('cancelled orders and unrelated closed fulfillments cannot be confirmed',async()=>{
 const {confirmShopifyShipment}=helper();
 for(const f of [fixture({cancelled:true}),fixture({status:'CLOSED',existing:[{id:'other',status:'SUCCESS',trackingInfo:[{number:'OTHER'}]}]})])await assert.rejects(()=>confirmShopifyShipment(f.request,shipment));
});
test('Shopify userErrors remain failures instead of a successful confirmation',async()=>{
 const {confirmShopifyShipment}=helper(),f=fixture();
 await assert.rejects(()=>confirmShopifyShipment(async(q,v)=>q.includes('mutation')?{fulfillmentCreate:{fulfillment:null,userErrors:[{message:'Permission denied'}]}}:f.request(q,v),shipment),/Permission denied/);
});

test('Shopify refresh preserves local label tracking until marketplace confirmation succeeds',()=>{
 const path='supabase/functions/_shared/shopifyShipment.ts';
 const {preserveShopifyLabelTracking}=vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync(path,'utf8').replaceAll('export ',''))+'\n({preserveShopifyLabelTracking})',{URL,Error});
 const remote=[{sendcloud_id:'a',tracking_number:null,tracking_url:null,raw_payload:{name:'#1'}}];
 const result=preserveShopifyLabelTracking(remote,[{sendcloud_id:'a',label_created_at:'today',tracking_number:'LOCAL',tracking_url:'https://mrw.es/1',raw_payload:{_zenvia_tracking:{number:'LOCAL'}}}]);
 assert.equal(result[0].tracking_number,'LOCAL');assert.equal(result[0].tracking_url,'https://mrw.es/1');
 assert.equal(preserveShopifyLabelTracking(remote,[])[0].tracking_number,null);
});

test('replacement tracking updates all warehouse fulfillments and resumes a partial update without creating shipments',async()=>{
 const {confirmShopifyShipment}=helper();const remote=[{id:'f1',status:'SUCCESS',trackingInfo:[{number:'OLD'}]},{id:'f2',status:'SUCCESS',trackingInfo:[{number:'OLD'}]}];let fail=true;const mutations=[];
 const request=async(q,v)=>{if(q.includes('ZenviaShipmentOrder'))return {order:{cancelledAt:null,fulfillments:remote,fulfillmentOrders:{nodes:[],pageInfo:{hasNextPage:false}}}};assert.ok(q.includes('ZenviaReplaceTracking'));mutations.push(v.id);if(v.id==='f2'&&fail){fail=false;throw new Error('timeout')}remote.find(f=>f.id===v.id).trackingInfo=[{number:'MRW123'}];return {fulfillmentTrackingInfoUpdate:{fulfillment:{id:v.id},userErrors:[]}};};
 await assert.rejects(()=>confirmShopifyShipment(request,{...shipment,previousNumber:'OLD'}),/timeout/);const result=await confirmShopifyShipment(request,{...shipment,previousNumber:'OLD'});assert.equal(result.fulfillmentIds.length,2);assert.deepEqual(mutations,['f1','f2','f2']);
});
test('a Shopify refresh does not restore the old tracking after a confirmed label cancellation',()=>{
 const {preserveShopifyLabelTracking}=vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('supabase/functions/_shared/shopifyShipment.ts','utf8').replaceAll('export ',''))+'\n({preserveShopifyLabelTracking})',{URL,Error});
 const result=preserveShopifyLabelTracking([{sendcloud_id:'a',tracking_number:'OLD',tracking_url:'https://old',fulfilled_at:'today'}],[{sendcloud_id:'a',label_created_at:null,label_cancelled_at:'today'}]);assert.equal(result[0].tracking_number,null);assert.equal(result[0].fulfilled_at,null);
});
