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
test('confirms remaining quantities and sends carrier number URL without notifying customers',async()=>{
 const {confirmShopifyShipment}=helper(),f=fixture();await confirmShopifyShipment(f.request,shipment);
 const input=f.calls.find(c=>c.query.includes('mutation')).variables.fulfillment;
 assert.deepEqual(JSON.parse(JSON.stringify(input)),{notifyCustomer:false,trackingInfo:{number:'MRW123',company:'MRW',url:'https://mrw.es/track/123'},lineItemsByFulfillmentOrder:[{fulfillmentOrderId:'fo1',fulfillmentOrderLineItems:[{id:'line1',quantity:2}]}]});
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
