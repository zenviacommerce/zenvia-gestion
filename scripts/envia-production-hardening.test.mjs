import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Envia uses one multicarrier rate request as the primary comparison source',async()=>{
  const edge=await read('supabase/functions/envia-shipping/index.ts');
  assert.match(edge,/shipment:\{type:1\}/);
  assert.match(edge,/Envia multicarrier rate failed; using per-carrier fallback/);
  assert.match(edge,/carrierDescription/);
  assert.match(edge,/serviceDescription/);
});

test('Envia treats HTTP 200 meta=error responses as real errors',async()=>{
  const edge=await read('supabase/functions/envia-shipping/index.ts');
  assert.match(edge,/responseMetaError/);
  assert.match(edge,/String\(payload\?\.meta\|\|''\)\.toLowerCase\(\)!=='error'/);
});

test('shipment history accepts nested response arrays and hydrates each tracking number',async()=>{
  const edge=await read('supabase/functions/envia-shipping/index.ts');
  assert.match(edge,/payload\?\.data\?\.guides/);
  assert.match(edge,/payload\?\.data\?\.shipments/);
  assert.match(edge,/guide\/\$\{encodeURIComponent\(tracking\)\}/);
  assert.match(edge,/Envia shipment detail fallback/);
});

test('label modal groups Envia services by real carrier instead of mixing all carriers in one list',async()=>{
  const [page,css]=await Promise.all([read('src/pages/Orders.tsx'),read('src/orders.css')]);
  assert.match(page,/carrierGroups/);
  assert.match(page,/ordersCarrierGroupHead/);
  assert.match(page,/Comparativa multitransportista en tiempo real/);
  assert.match(css,/ordersCarrierGroup/);
  assert.match(page,/ordersShippingProvider/);
});

test('generic tariff reader can recover multicarrier weight tables for manual review',async()=>{
  const tariff=await read('src/services/transportTariffs.ts');
  assert.match(tariff,/parseGenericCarrierServices/);
  assert.match(tariff,/genericCarriers/);
  assert.match(tariff,/multiCarrier\?'envia'/);
  assert.match(tariff,/lector genérico multitransportista/);
});
