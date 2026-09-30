import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Envia rate parsing keeps carrier and service identities separate',async()=>{
  const edge=await read('supabase/functions/envia-shipping/index.ts');
  assert.match(edge,/carrierDescription/);
  assert.match(edge,/serviceDescription/);
  assert.doesNotMatch(edge,/function carrierName\(item:any\)\{return clean\(item\?\.description/);
  assert.match(edge,/parseEtaDays/);
});

test('Envia label response supports documented data arrays and trackUrl',async()=>{
  const edge=await read('supabase/functions/envia-shipping/index.ts');
  assert.match(edge,/const rows=asRows\(payload\)/);
  assert.match(edge,/data\?\.trackUrl/);
  assert.match(edge,/data\?\.totalPrice/);
});

test('Envia shipments are synchronized independently from Sendcloud',async()=>{
  const [edge,orders,page]=await Promise.all([
    read('supabase/functions/envia-shipping/index.ts'),
    read('src/services/orders.ts'),
    read('src/pages/Orders.tsx'),
  ]);
  assert.match(edge,/action==='sync_shipments'/);
  assert.match(edge,/\/guide\/\$\{period\.month\}\/\$\{period\.year\}/);
  assert.match(orders,/syncEnviaShipments/);
  assert.match(page,/syncEnviaShipments/);
  assert.match(page,/Envia\.com/);
});

test('live quote comparison shows source, carrier, service, contracted tariff and delta',async()=>{
  const [page,shipping]=await Promise.all([
    read('src/pages/Orders.tsx'),
    read('src/services/orderShipping.ts'),
  ]);
  assert.match(page,/ordersComparison/);
  assert.match(page,/Precio API/);
  assert.match(page,/Tu tarifa/);
  assert.match(page,/Diferencia/);
  assert.match(page,/ordersProviderBadge/);
  assert.match(shipping,/estimateTransportTariffForOption/);
  assert.match(shipping,/externalServiceCode/);
});

test('generic tariff fallback never interprets VAT percentage as fuel surcharge',async()=>{
  const tariff=await read('src/services/transportTariffs.ts');
  assert.match(tariff,/if\(\/iva\|vat\|impuesto\/i\.test\(before\)\)continue/);
  assert.match(tariff,/reanalyzeTransportTariffDraft/);
});

test('unusable tariff imports are explicit and cannot be reviewed as empty tariffs',async()=>{
  const panel=await read('src/components/TransportTariffsPanel.tsx');
  assert.match(panel,/La importación no contiene servicios ni tramos/);
  assert.match(panel,/Reanalizar/);
  assert.match(panel,/La tarifa no contiene servicios y tramos utilizables/);
});


test('tariff fallback does not invent expiry or fuel inclusion from unrelated document text',async()=>{
  const tariff=await read('src/services/transportTariffs.ts');
  assert.doesNotMatch(tariff,/\|\|text\.match\(\/\(\\d\{1,2\}\)/);
  assert.match(tariff,/fuelSurchargeIncluded:fuelIncluded/);
  assert.match(tariff,/No se ha podido determinar el tratamiento del combustible/);
});
