import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('native Amazon orders can be edited locally without a Sendcloud remote order',async()=>{
  const [service,state]=await Promise.all([
    read('src/services/orders.ts'),
    read('supabase/functions/order-logistics-state/index.ts'),
  ]);
  assert.match(service,/nativeAmazon/);
  assert.match(service,/update_native_order/);
  assert.match(state,/action==='update_native_order'/);
  assert.match(state,/order\.sendcloud_remote_id/);
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
  assert.match(page,/Amazon y los transportistas directos no dependen de Sendcloud/);
});

test('Amazon sync stores merchant-fulfilled recipient data directly in the operational order table',async()=>{
  const source=await read('supabase/functions/_shared/amazon/orders.ts');
  assert.match(source,/merchantFulfilled/);
  assert.match(source,/operationalAddress/);
  assert.match(source,/upsertOperationalAmazonOrders/);
  assert.match(source,/source_integration_account_id/);
  assert.match(source,/integration_type:'amazon-direct'/);
});
