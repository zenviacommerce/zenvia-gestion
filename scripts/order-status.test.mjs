import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {build} from 'esbuild';

async function loadOrderStatusModule() {
  const result=await build({entryPoints:['src/services/orderStatus.ts'],bundle:true,write:false,format:'esm',platform:'node'});
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

test('a source-pending order with a Sendcloud parcel is not operationally pending', async () => {
  const { isPendingOrder } = await loadOrderStatusModule();
  assert.equal(isPendingOrder({ sourceStatus: 'Pending', sendcloudParcelId: 714512042 }), false);
});

test('an unlabelled, non-cancelled, non-processed order remains pending', async () => {
  const { isPendingOrder } = await loadOrderStatusModule();
  assert.equal(isPendingOrder({ sourceStatus: 'Pending', sendcloudParcelId: null }), true);
});

test('Dashboard uses the operational pending-order predicate', async () => {
  const source = await readFile(new URL('../src/pages/Dashboard.tsx', import.meta.url), 'utf8');
  assert.match(source, /from ['"]\.\.\/services\/orderStatus['"]/);
  assert.doesNotMatch(source, /function\s+isPendingOrder\s*\(/);
});


test('a generic Envia label also removes an order from operational pending state', async () => {
  const { isPendingOrder, hasShippingLabel } = await loadOrderStatusModule();
  const order={ sourceStatus:'Pending', sendcloudParcelId:null, shippingRemoteId:'ENV123', labelCreatedAt:'2026-09-29T10:00:00Z' };
  assert.equal(hasShippingLabel(order),true);
  assert.equal(isPendingOrder(order),false);
});

test('marketplace confirmation leaves a label pending physical pickup',async()=>{
 const {isProcessedOrder,isLabelledOrder}=await loadOrderStatusModule();
 const order={sourceStatus:'shipped',labelCreatedAt:'2026-10-12T19:26:58Z',trackingStatusMessage:'ready to send'};
 assert.equal(isProcessedOrder(order),false);assert.equal(isLabelledOrder(order),true);
});
test('Orders screen uses the common physical-dispatch classifier',async()=>{
 const source=await readFile(new URL('../src/pages/Orders.tsx',import.meta.url),'utf8');
 assert.match(source,/import \{[^}]*isProcessedOrder[^}]*\} from ['"]\.\.\/services\/orderStatus['"]/);
 const {isProcessedOrder}=await loadOrderStatusModule();
 assert.equal(isProcessedOrder({sourceStatus:'shipped',labelCreatedAt:'2026-10-23T08:00:00Z'}),false);
 assert.equal(isProcessedOrder({sourceStatus:'shipped',labelCreatedAt:'2026-10-23T08:00:00Z',logisticsDispatchedAt:'2026-10-23T09:00:00Z'}),true);
});
