import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('native Amazon orders can be edited locally without a Sendcloud remote order',async()=>{
  const [service,state]=await Promise.all([
    read('src/services/orders.ts'),
    read('supabase/functions/order-logistics-state/index.ts'),
  ]);
  assert.match(service,/invokeOrderState[^\n]*action:'update_order'/);
  assert.doesNotMatch(service,/nativeAmazon/);
  assert.match(state,/action==='update_native_order'/);
  assert.match(state,/admin\.from\('fulfillment_orders'\)\.update/);
  assert.match(state,/package_length_cm/);
});

test('MRW remains available when Sendcloud and Envia rate lookups fail',async()=>{
  const service=await read('src/services/orders.ts');
  assert.match(service,/noProviderOptions=!sendcloud&&!envia&&!mrw/);
  assert.match(service,/mrwOptions/);
  assert.match(service,/option\?\.provider==='mrw'/);
});

test('Orders keeps refreshing direct Amazon state with no logistics aggregator enabled',async()=>{
  const page=await read('src/pages/Orders.tsx');
  assert.match(page,/Promise\.all\(\[refresh\(\),settings\.orders\.retryTrackingConfirmation\?retryAmazonTrackingConfirmations/);
  assert.match(page,/Los canales directos y transportistas conectados no dependen de Sendcloud/);
});

test('Amazon sync stores merchant-fulfilled recipient data directly in the operational order table',async()=>{
  const source=await read('supabase/functions/_shared/amazon/orders.ts');
  assert.match(source,/merchantFulfilled/);
  assert.match(source,/operationalAddress/);
  assert.match(source,/upsertOperationalAmazonOrders/);
  assert.match(source,/source_integration_account_id/);
  assert.match(source,/integration_type:'amazon-direct'/);
});


test('local order edits are provider independent for migrated Amazon rows',async()=>{
  const service=await read('src/services/orders.ts');
  assert.match(service,/integration_type/);
  const edit=service.slice(service.indexOf('export function updateFulfillmentOrder'),service.indexOf('export async function createOrderLabel'));
  assert.ok(edit.length>0);
  assert.match(edit,/invokeOrderState[^\n]*action:'update_order'/);
  assert.doesNotMatch(edit,/invokeSendcloud/);
});

test('Amazon direct-order readiness records missing PII permission and exposes it in Integrations',async()=>{
  const [orders,settings]=await Promise.all([
    read('supabase/functions/_shared/amazon/orders.ts'),
    read('src/pages/Settings.tsx'),
  ]);
  assert.match(orders,/operationalOrdersDirect/);
  assert.match(orders,/pii_permission_missing/);
  assert.match(orders,/markOperationalReadiness/);
  assert.match(settings,/Pedidos directos Amazon: activos/);
  assert.match(settings,/falta autorización PII de destinatario/);
});
