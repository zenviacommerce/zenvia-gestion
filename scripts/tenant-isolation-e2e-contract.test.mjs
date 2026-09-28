import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Gestion activation uses tenant-aware Supabase auth with no historical runtime fallback',async()=>{
  const [supabase,auth,app]=await Promise.all([
    read('src/services/supabase.ts'),
    read('src/components/AuthScreen.tsx'),
    read('src/App.tsx'),
  ]);
  assert.match(supabase,/tenant-router/);
  assert.match(supabase,/getActiveSupabase/);
  assert.match(supabase,/storageKey:tenantStorageKey/);
  assert.doesNotMatch(supabase,/sjkxxbedkkmgmqnvaqjh/);
  assert.match(auth,/resolveAndActivateTenant/);
  assert.match(auth,/signInWithPassword/);
  assert.match(auth,/signInWithPasskey/);
  assert.match(app,/bootstrapTenantFromLocation/);
});

test('Gestion receives central plan snapshots and exposes workspace context',async()=>{
  const [snapshot,bridge]=await Promise.all([
    read('supabase/migrations/20260928013000_subscription_snapshot.sql'),
    read('supabase/functions/platform-bridge/index.ts'),
  ]);
  assert.match(snapshot,/app_subscription_state/);
  assert.match(snapshot,/get_workspace_context/);
  assert.match(bridge,/apply_plan_snapshot/);
  assert.match(bridge,/planVersion/);
  assert.match(bridge,/entitlements/);
});

test('Gestion bridge exposes the operations Platform needs per tenant',async()=>{
  const bridge=await read('supabase/functions/platform-bridge/index.ts');
  for(const action of ['bootstrap','workspace_detail','update_workspace_profile','list_tickets','ticket_detail','reply_ticket']){
    assert.ok(bridge.includes("action==='"+action+"'"),'Missing '+action);
  }
});

test('managed users synchronize tenant identity routes with the caller workspace on shared hosts',async()=>{
  const adminUsers=await read('supabase/functions/admin-users/index.ts');
  assert.match(adminUsers,/PLATFORM_CONTROL_PLANE_URL/);
  assert.match(adminUsers,/PLATFORM_BRIDGE_TOKEN/);
  assert.match(adminUsers,/trySyncIdentityRoute\(action:'register_identity'\|'unregister_identity',workspaceId:string,email:string\)/);
  assert.doesNotMatch(adminUsers,/const workspaceId=Deno\.env\.get\('PLATFORM_WORKSPACE_ID'\)/);
  assert.match(adminUsers,/register_identity/);
  assert.match(adminUsers,/unregister_identity/);
});
