import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('shipping data model supports Sendcloud and Envia side by side',async()=>{
  const [migration,orders]=await Promise.all([
    read('supabase/migrations/20260929143000_multi_shipping_envia.sql'),
    read('src/services/orders.ts'),
  ]);
  assert.match(migration,/provider in \('amazon','sendcloud','envia','shopify','gmail'\)/);
  assert.match(migration,/shipping_provider text/);
  assert.match(migration,/shipping_remote_id text/);
  assert.match(orders,/shippingProvider:'sendcloud'\|'envia'\|null/);
  assert.match(orders,/provider:'sendcloud'\|'envia'/);
});

test('Envia credentials are vaulted and sandbox is the default environment',async()=>{
  const [integrations,edge]=await Promise.all([
    read('supabase/functions/integration-accounts/index.ts'),
    read('supabase/functions/envia-shipping/index.ts'),
  ]);
  assert.match(integrations,/provider==='envia'/);
  assert.match(integrations,/writeVault/);
  assert.match(integrations,/token API de Envia\.com/);
  assert.match(edge,/https:\/\/api-test\.envia\.com/);
  assert.match(edge,/https:\/\/queries\.test\.envia\.com/);
  assert.match(edge,/action==='rates'/);
  assert.match(edge,/action==='create_label'/);
  assert.match(edge,/ship\/rate\//);
  assert.match(edge,/ship\/generate\//);
});

test('Orders compares providers and routes label creation to the selected provider',async()=>{
  const [orders,page]=await Promise.all([
    read('src/services/orders.ts'),
    read('src/pages/Orders.tsx'),
  ]);
  assert.match(orders,/Promise\.allSettled/);
  assert.match(orders,/invokeEnvia/);
  assert.match(orders,/option\?\.provider==='envia'/);
  assert.match(page,/Compara los servicios disponibles de tus proveedores logísticos/);
  assert.match(page,/providerName/);
  assert.match(page,/Tarifas en tiempo real de Envia\.com/);
  assert.match(page,/hasShippingLabel/);
});

test('Envia quotations use explicit package dimensions and never invent phone numbers',async()=>{
  const [settings,edge]=await Promise.all([
    read('src/services/settingsSchema.ts'),
    read('supabase/functions/envia-shipping/index.ts'),
  ]);
  assert.match(settings,/packageLengthCm/);
  assert.match(settings,/packageWidthCm/);
  assert.match(settings,/packageHeightCm/);
  assert.match(edge,/teléfono del remitente/);
  assert.match(edge,/teléfono del destinatario/);
  assert.doesNotMatch(edge,/000000000/);
});
