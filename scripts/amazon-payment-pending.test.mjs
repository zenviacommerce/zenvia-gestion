import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {transform,build} from 'esbuild';
const source=await readFile(new URL('../src/services/orderStatus.ts',import.meta.url),'utf8');
const code=(await build({entryPoints:['src/services/orderStatus.ts'],bundle:true,write:false,format:'esm',platform:'node'})).outputFiles[0].text;
const status=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const order=(sourceStatus,sourceChannel='amazon')=>({sourceStatus,sourceChannel});
test('Amazon Pending and PendingAvailability never count as orders awaiting shipment',()=>{assert.equal(status.isPendingOrder(order('PENDING')),false);assert.equal(status.isPendingOrder(order('PendingAvailability')),false);assert.equal(status.isPendingOrder(order('InvoiceUnconfirmed')),false);});
test('confirmed Amazon and manual/Shopify pending orders remain actionable',()=>{assert.equal(status.isPendingOrder(order('UNSHIPPED')),true);assert.equal(status.isPendingOrder(order('pending','other')),true);assert.equal(status.isPendingOrder(order('pending','shopify')),true);});
test('all carrier backends reject unpaid Amazon before any shipment call',async()=>{
 const shared=await readFile(new URL('../supabase/functions/_shared/amazonShippingEligibility.ts',import.meta.url),'utf8');
 const js=(await transform(shared,{loader:'ts',format:'esm'})).code;
 const {assertAmazonOrderShippable}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
 assert.throws(()=>assertAmazonOrderShippable({source_channel:'amazon',source_status:'PENDING'}),/confirme el pago/);
 assert.throws(()=>assertAmazonOrderShippable({source_channel:'amazon',source_status:null}),/confirmado/);
 assert.doesNotThrow(()=>assertAmazonOrderShippable({source_channel:'amazon',source_status:'UNSHIPPED'}));
 assert.doesNotThrow(()=>assertAmazonOrderShippable({source_channel:'amazon',source_status:'PARTIALLY_SHIPPED'}));
 assert.doesNotThrow(()=>assertAmazonOrderShippable({source_channel:'shopify',source_status:'pending'}));
 for(const carrier of ['envia-shipping','mrw-shipping','sendcloud-orders']){
  const edge=await readFile(new URL('../supabase/functions/'+carrier+'/index.ts',import.meta.url),'utf8');
  assert.match(edge,/assertAmazonOrderShippable\(order\)/);
 }
});
