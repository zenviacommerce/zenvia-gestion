import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('ZENVIA IA is mounted globally and exposes operational actions through the app boundary',async()=>{
  const [app,agent,service]=await Promise.all([
    read('src/App.tsx'),
    read('src/components/AppAgent.tsx'),
    read('src/services/appAgent.ts'),
  ]);
  assert.match(app,/<AppAgent/);
  assert.match(app,/handleAgentAction/);
  assert.match(app,/open_expense_upload/);
  assert.match(app,/open_product_create/);
  assert.match(app,/open_supplier_create/);
  assert.match(app,/sync_orders/);
  assert.match(app,/create_client/);
  assert.match(app,/create_product/);
  assert.match(app,/create_supplier/);
  assert.match(app,/set_expense_status/);
  assert.match(app,/confirmAction/);
  assert.match(agent,/ZENVIA IA/);
  assert.match(agent,/Especialista en ZENVIA Gestión/);
  assert.match(agent,/operaciones que modifican datos usan la confirmación estándar/i);
  assert.match(service,/supabase\.functions\.invoke\('app-agent'/);
});

test('tenant-local ZENVIA agent authenticates the user and runs without paid model APIs',async()=>{
  const edge=await read('supabase/functions/app-agent/index.ts');
  assert.match(edge,/admin\.auth\.getUser/);
  assert.match(edge,/authorizedPages/);
  assert.match(edge,/loadBusinessContext/);
  assert.match(edge,/processLocalAgent/);
  assert.match(edge,/zenvia-local-v1/);
  assert.match(edge,/\.eq\('owner_id',ownerId\)/);
  assert.match(edge,/fulfillment_orders/);
  assert.match(edge,/sales_invoices/);
  assert.match(edge,/support_tickets/);
  assert.doesNotMatch(edge,/OPENAI_API_KEY/);
  assert.doesNotMatch(edge,/api\.openai\.com/);
  assert.doesNotMatch(edge,/PLATFORM_CONTROL_PLANE_URL/);
  assert.doesNotMatch(edge,/functions\/v1\/platform-agent/);
});


test('global AI and alerts live in a reserved toolbar instead of floating over page actions',async()=>{
  const [app,css]=await Promise.all([
    read('src/App.tsx'),
    read('src/app-agent.css'),
  ]);
  assert.match(app,/className="appGlobalTools"/);
  assert.match(app,/className="appGlobalTools"[\s\S]*<AppAgent[\s\S]*<AlertCenter/);
  assert.match(css,/\.appGlobalTools\{[\s\S]*position:sticky/);
  assert.match(css,/\.appGlobalTools \.appAgentLauncher\{position:static/);
  assert.match(css,/@media\(max-width:900px\)[\s\S]*\.appGlobalTools\{[\s\S]*position:fixed/);
  assert.match(css,/\.mobileNavHeader\{padding-right:108px!important\}/);
});


test('ZENVIA IA desktop panel has enough width and mobile remains full-width',async()=>{
  const css=await read('src/app-agent.css');
  assert.match(css,/\.appAgentPanel\{width:clamp\(520px,38vw,640px\)/);
  assert.match(css,/@media\(max-width:900px\)[\s\S]*\.appAgentPanel\{width:100%;max-width:none\}/);
});

test('orders refresh after agent-triggered synchronization',async()=>{
  const orders=await read('src/pages/Orders.tsx');
  assert.match(orders,/zenvia:orders-refresh/);
  assert.match(orders,/Promise\.all\(\[refresh\(\),refreshStatus\(\),refreshTariffs\(\)\]\)/);
});


test('local agent understands core ZENVIA domain commands and real-data questions',async()=>{
  const edge=await read('supabase/functions/app-agent/index.ts');
  for(const phrase of [
    'que tengo pendiente','pedidos pendientes','facturas pendientes','productos sin coste',
    'sincroniza los pedidos','crea un proveedor','crea un cliente','crea un producto'
  ])assert.match(edge,new RegExp(phrase));
  for(const action of ['sync_orders','create_client','create_product','create_supplier','set_expense_status']){
    assert.match(edge,new RegExp(action));
  }
});


test('local agent uses the same operational pending-order rule as the UI',async()=>{
  const edge=await read('supabase/functions/app-agent/index.ts');
  assert.match(edge,/function isPendingOrderRow/);
  assert.match(edge,/source_status/);
  assert.match(edge,/sendcloud_parcel_id/);
  assert.match(edge,/shipping_remote_id/);
  assert.match(edge,/label_created_at/);
  assert.match(edge,/\['fulfilled','shipped','delivered'\]\.includes\(status\)/);
  assert.match(edge,/raw\.ordersStateRows\.filter\(isPendingOrderRow\)/);
  assert.doesNotMatch(edge,/\.is\('fulfilled_at',null\)\.is\('label_created_at',null\)/);
});


test('agent pending metrics respect the same remembered date filters as the visible app',async()=>{
  const edge=await read('supabase/functions/app-agent/index.ts');
  assert.match(edge,/user_preferences/);
  assert.match(edge,/dashboard\.period/);
  assert.match(edge,/expenses\.filters/);
  assert.match(edge,/orders\.filters/);
  assert.match(edge,/sales\.filters/);
  assert.match(edge,/applyDateRange/);
  assert.match(edge,/issue_date/);
  assert.match(edge,/order_created_at/);
  assert.match(edge,/Con el periodo seleccionado/);
});
