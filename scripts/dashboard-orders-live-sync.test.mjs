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
  assert.match(dashboard,/await\s+listFulfillmentOrders\(\)/);
});

test('Dashboard uses the configured order refresh interval',async()=>{
  const dashboard=await source('src/pages/Dashboard.tsx');
  assert.match(dashboard,/settings\.orders\.refreshSeconds/);
  assert.match(dashboard,/watchFulfillmentOrders\(refreshOrders,Math\.max\(60,settings\.orders\.refreshSeconds\)\*1000\)/);
  assert.doesNotMatch(dashboard,/setInterval/);
});


test('Orders manual sync uses a stable in-flight guard instead of depending on syncing state',async()=>{
  const orders=await source('src/pages/Orders.tsx');
  assert.match(orders,/const syncingRef=useRef\(false\)/);
  assert.match(orders,/if\(syncingRef\.current\)return/);
  assert.match(orders,/syncingRef\.current=true/);
  assert.match(orders,/syncingRef\.current=false/);
  assert.match(orders,/settings\.integrations\.enviaEnabled/);
  assert.match(orders,/syncEnviaShipments/);
  assert.match(orders,/const runAmazon=Boolean\(settings\.integrations\.amazonEnabled\)/);
  assert.match(orders,/const runShopify=Boolean\(settings\.integrations\.shopifyEnabled\)/);
  assert.match(orders,/await requestAmazonSync\(undefined,\{waitForOrders:true\}\)/);
  assert.doesNotMatch(orders,/\[refresh,syncing,settings\.orders\.retryTrackingConfirmation\]/);
});


test('Dashboard pending orders KPI ignores period boundaries and reflects the real operational backlog',async()=>{
  const dashboard=await source('src/pages/Dashboard.tsx');
  assert.match(dashboard,/const allValidOrders=orders\.filter\(order=>!isCancelledOrder\(order\)\)/);
  assert.match(dashboard,/const pendingOrders=allValidOrders\.filter\(isPendingOrder\)\.length/);
  assert.match(dashboard,/Pendientes reales · sin limitar por periodo/);
  assert.doesNotMatch(dashboard,/const pendingOrders=validOrders\.filter\(isPendingOrder\)\.length/);
});

test('Orders has one visible persisted-data watcher and preserves manual connector actions',async()=>{const orders=await source('src/pages/Orders.tsx');assert.doesNotMatch(orders,/setInterval/);assert.match(orders,/watchFulfillmentOrders\(refresh,Math\.max\(60,settings\.orders\.refreshSeconds\)\*1000\)/);assert.match(orders,/runEnvia\?syncEnviaShipments\(enviaHistory\?12:2\)/);});
