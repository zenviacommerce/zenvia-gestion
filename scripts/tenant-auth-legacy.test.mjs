import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Gestion runtime has no hardcoded fallback to the original customer Supabase',async()=>{
  const [tenant,supabase,client]=await Promise.all([
    read('src/services/tenant.ts'),read('src/services/supabase.ts'),read('src/services/tenantSupabase.ts'),
  ]);
  for(const source of [tenant,supabase,client]){
    assert.doesNotMatch(source,/sjkxxbedkkmgmqnvaqjh/);
    assert.doesNotMatch(source,/sb_publishable_rlMfpeedWWvOnu70ZjPdjA_ydz4QFYI/);
  }
  assert.match(tenant,/tenant-router/);
});

test('logout can keep remembered tenant while company switching clears it',async()=>{
  const [app,auth,supabase]=await Promise.all([
    read('src/App.tsx'),read('src/components/AuthScreen.tsx'),read('src/services/supabase.ts'),
  ]);
  assert.match(app,/supabase\.auth\.signOut\(\)/);
  assert.match(auth,/deactivateTenant/);
  assert.match(supabase,/clearRememberedTenantConnection/);
  assert.match(supabase,/scope:'local'/);
});
