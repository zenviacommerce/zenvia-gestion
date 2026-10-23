import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path){
  try{return await readFile(new URL(`../${path}`,import.meta.url),'utf8');}
  catch{return '';}
}

test('Dashboard reads persisted KPIs without browser-driven carrier synchronization',async()=>{
  const dashboard=await source('src/pages/Dashboard.tsx');
  assert.doesNotMatch(dashboard,/syncSendcloudOrders\(/);
  assert.match(dashboard,/await\s+fetchOrdersOperationalSummary\(/);
  assert.doesNotMatch(dashboard,/listFulfillmentOrders|order_logistics_read/);
});

test('Dashboard uses the configured order refresh interval',async()=>{
  const dashboard=await source('src/pages/Dashboard.tsx');
  assert.match(dashboard,/settings\.orders\.refreshSeconds/);
  assert.match(dashboard,/watchFulfillmentOrders\(\(\)=>refreshOrders\(true\),Math\.max\(60,settings\.orders\.refreshSeconds\)\*1000\)/);
  assert.doesNotMatch(dashboard,/setInterval/);
});


test('Orders manual sync uses a stable in-flight guard instead of depending on syncing state',async()=>{
  const orders=await source('src/pages/Orders.tsx');
  assert.match(orders,/const syncingRef=useRef\(false\)/);
  assert.match(orders,/if\(syncingRef\.current\)return/);
  assert.match(orders,/syncingRef\.current=true/);
  assert.match(orders,/syncingRef\.current=false/);
  assert.doesNotMatch(orders,/syncEnviaShipments\(/);
  assert.match(orders,/const runAmazon=Boolean\(settings\.integrations\.amazonEnabled\)/);
  assert.match(orders,/const runShopify=Boolean\(settings\.integrations\.shopifyEnabled\)/);
  assert.match(orders,/await requestAmazonSync\(undefined,\{waitForOrders:true\}\)/);
  assert.doesNotMatch(orders,/\[refresh,syncing,settings\.orders\.retryTrackingConfirmation\]/);
});


test('Dashboard pending orders KPI ignores period boundaries and reflects the real operational backlog',async()=>{
  const dashboard=await source('src/pages/Dashboard.tsx');
  const migration=await source('supabase/migrations/20261023132255_orders_cached_logistics_read.sql');
  const summary=migration.split('-- Aggregate-only Summary API:')[1];
  assert.ok(summary,'Aggregate contract must exist; SQL behavior is covered by the PGlite regression suite');
  assert.match(summary,/'pending',count\(\*\) FILTER\(WHERE order_state='pending'\)/);
  assert.doesNotMatch(summary,/'pending',count\(\*\) FILTER\(WHERE in_period/);
  assert.match(dashboard,/Pendientes reales · sin limitar por periodo/);
  assert.doesNotMatch(dashboard,/const pendingOrders=validOrders\.filter\(isPendingOrder\)\.length/);
});

test('Orders has one visible persisted-data watcher and keeps carrier tracking on the server',async()=>{const orders=await source('src/pages/Orders.tsx');assert.doesNotMatch(orders,/setInterval/);assert.match(orders,/watchFulfillmentOrders\(refresh,Math\.max\(60,settings\.orders\.refreshSeconds\)\*1000\)/);assert.doesNotMatch(orders,/syncEnviaShipments\(/);});
