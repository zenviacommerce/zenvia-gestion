import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('pending orders KPI navigates to Orders through the app navigation callback',async()=>{
  const [app,dashboard,stat,orders]=await Promise.all([
    read('src/App.tsx'),
    read('src/pages/Dashboard.tsx'),
    read('src/components/StatCard.tsx'),
    read('src/pages/Orders.tsx'),
  ]);
  assert.match(app,/onOrders=\{can\('orders'\)\?\(\)=>void navigate\('orders',\{pendingOrders:true\}\):undefined\}/);
  assert.match(app,/<Orders pendingOnly=\{ordersPendingEntry\}\/>/);
  assert.match(orders,/pendingOnly\?'pending':remembered\.state/);
  assert.match(orders,/pendingOnly\?'':remembered\.query/);
  assert.match(orders,/pendingOnly\?'all':remembered\.trackingFilter/);
  assert.match(orders,/pendingOnly\?'all':remembered\.countryFilter/);
  assert.match(orders,/pendingOnly\?'all':remembered\.carrierFilter/);
  assert.match(dashboard,/onOrders\?:\(\)=>void/);
  assert.match(dashboard,/label="Pendientes"[\s\S]*onClick=\{onOrders\}/);
  assert.match(stat,/onClick\?:\(\)=>void/);
  assert.match(stat,/type="button"/);
});
