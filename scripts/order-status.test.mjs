import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadOrderStatusModule() {
  const source = await readFile(new URL('../src/services/orderStatus.ts', import.meta.url), 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`);
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

test('marketplace confirmation wins over carrier pre-dispatch status',async()=>{
 const {isProcessedOrder,isLabelledOrder}=await loadOrderStatusModule();
 const order={sourceStatus:'shipped',labelCreatedAt:'2026-10-12T19:26:58Z',trackingStatusMessage:'ready to send'};
 assert.equal(isProcessedOrder(order),true);assert.equal(isLabelledOrder(order),false);
});
test('Orders screen recognises a confirmed Shopify shipment before carrier pickup',async()=>{
 const source=await readFile(new URL('../src/pages/Orders.tsx',import.meta.url),'utf8');
 const helper=source.slice(source.indexOf('function isProcessedOrder('),source.indexOf('function isLabelledOrder('));
 const {default:vm}=await import('node:vm');
 const context=vm.createContext({hasShippingLabel:()=>true,isCancelledOrder:()=>false,orderStatusCode:order=>order.sourceStatus});
 vm.runInContext(ts.transpile(helper)+';globalThis.processed=isProcessedOrder;',context);
 assert.equal(context.processed({sourceStatus:'shipped',trackingStatusMessage:'ready to send'}),true);
 assert.equal(context.processed({sourceStatus:'pending',trackingStatusMessage:'ready to send'}),false);
});
