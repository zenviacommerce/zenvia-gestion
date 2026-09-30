import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('demo reset is service-role only and refuses unmarked workspaces',async()=>{
  const migration=await read('supabase/migrations/20260930170000_demo_workspace_seed.sql');
  assert.match(migration,/platform_reset_demo_workspace/);
  assert.match(migration,/demo'->>'enabled'/);
  assert.match(migration,/raise exception 'El workspace no está autorizado como cuenta demo.'/);
  assert.match(migration,/grant execute on function public\.platform_reset_demo_workspace\(uuid\) to service_role/);
});

test('demo reset seeds representative commerce data and removes real integrations',async()=>{
  const migration=await read('supabase/migrations/20260930170000_demo_workspace_seed.sql');
  assert.match(migration,/delete from public\.integration_accounts/);
  assert.match(migration,/insert into public\.products/);
  assert.match(migration,/insert into public\.clients/);
  assert.match(migration,/insert into public\.suppliers/);
  assert.match(migration,/insert into public\.invoices/);
  assert.match(migration,/insert into public\.sales_invoices/);
  assert.match(migration,/insert into public\.fulfillment_orders/);
  assert.match(migration,/insert into public\.amazon_orders/);
  assert.match(migration,/@example\.com/);
  assert.match(migration,/'disabled'/);
});

test('Platform bridge explicitly enables demo safety before destructive reset',async()=>{
  const bridge=await read('supabase/functions/platform-bridge/index.ts');
  assert.match(bridge,/action==='reset_demo_data'/);
  assert.match(bridge,/external_actions_disabled:true/);
  assert.match(bridge,/managed_by:'platform'/);
  assert.match(bridge,/platform_reset_demo_workspace/);
});
