import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('tenant connections are safe public metadata with isolated auth storage',async()=>{
  const [tenant,client]=await Promise.all([
    read('src/services/tenant.ts'),
    read('src/services/tenantSupabase.ts'),
  ]);
  assert.match(tenant,/export type TenantConnection=/);
  assert.match(tenant,/workspaceId:string/);
  assert.match(tenant,/publishableKey:string/);
  assert.doesNotMatch(tenant,/serviceRole|secretKey/);
  assert.match(client,/tenantAuthStorageKey/);
  assert.match(client,/workspaceId/);
  assert.match(client,/storageKey:/);
  assert.match(client,/createClient/);
});

test('supabase facade routes existing imports through the active tenant',async()=>{
  const source=await read('src/services/supabase.ts');
  assert.match(source,/export function setActiveTenant/);
  assert.match(source,/export function clearActiveTenant/);
  assert.match(source,/export function getActiveSupabase/);
  assert.match(source,/new Proxy/);
  assert.doesNotMatch(source,/sjkxxbedkkmgmqnvaqjh/);
  assert.doesNotMatch(source,/VITE_SUPABASE_URL/);
});

test('remembered tenant metadata is validated before reuse',async()=>{
  const source=await read('src/services/tenant.ts');
  assert.match(source,/readRememberedTenantConnection/);
  assert.match(source,/rememberTenantConnection/);
  assert.match(source,/clearRememberedTenantConnection/);
  assert.match(source,/https:/);
  assert.match(source,/workspaceId/);
  assert.match(source,/slug/);
});

test('tenant router client supports explicit tenant and email resolution without probing data planes',async()=>{
  const source=await read('src/services/tenant.ts');
  assert.match(source,/resolveTenant/);
  assert.match(source,/tenant-router/);
  assert.match(source,/status:'resolved'/);
  assert.match(source,/status:'multiple'/);
  assert.doesNotMatch(source,/sjkxxbedkkmgmqnvaqjh/);
});
