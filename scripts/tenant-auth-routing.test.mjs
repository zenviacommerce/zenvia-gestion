import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Gestion Supabase client can switch to a resolved customer data plane',async()=>{
  const source=await read('src/services/supabase.ts');
  assert.match(source,/export let supabase/);
  assert.match(source,/export async function resolveAndActivateTenant/);
  assert.match(source,/tenant-router/);
  assert.match(source,/createClient\(tenant\.supabase_url,tenant\.publishable_key/);
  assert.match(source,/zenvia-gestion-active-tenant/);
  assert.match(source,/export async function bootstrapTenantFromLocation/);
  assert.match(source,/new URLSearchParams\(window\.location\.search\)/);
  assert.doesNotMatch(source,/const url = import\.meta\.env\.VITE_SUPABASE_URL/);
});

test('tenant cache contains only public connection material',async()=>{
  const source=await read('src/services/supabase.ts');
  assert.match(source,/supabase_url/);
  assert.match(source,/publishable_key/);
  assert.doesNotMatch(source,/service_role|secret_key|customer_secret_key/);
});

test('password login resolves tenant before authenticating',async()=>{
  const auth=await read('src/components/AuthScreen.tsx');
  assert.match(auth,/resolveAndActivateTenant/);
  assert.match(auth,/signInWithPassword/);
  assert.ok(auth.indexOf('resolveAndActivateTenant')<auth.indexOf('signInWithPassword'));
  assert.match(auth,/multiple/);
  assert.match(auth,/Selecciona tu empresa/);
});

test('passkey login resolves tenant from email or cached tenant first',async()=>{
  const auth=await read('src/components/AuthScreen.tsx');
  assert.match(auth,/signInWithPasskey/);
  assert.match(auth,/resolveAndActivateTenant/);
  assert.match(auth,/Indica tu email/);
});

test('App bootstraps tenant before reading the Auth session and rebinds on tenant changes',async()=>{
  const app=await read('src/App.tsx');
  assert.match(app,/bootstrapTenantFromLocation/);
  assert.match(app,/authClientVersion/);
  assert.match(app,/onTenantChanged/);
  const bootstrap=app.indexOf('bootstrapTenantFromLocation');
  const getSession=app.indexOf('supabase.auth.getSession()',bootstrap);
  assert.ok(bootstrap>=0&&getSession>bootstrap);
});

test('invitation and passkey setup continue using the live tenant Supabase binding',async()=>{
  const [invite,passkey]=await Promise.all([
    read('src/components/InvitePasswordSetup.tsx'),
    read('src/components/PasskeySetup.tsx'),
  ]);
  assert.match(invite,/supabase\.auth\.updateUser/);
  assert.match(passkey,/supabase\.auth\.registerPasskey/);
});

test('managed user lifecycle syncs tenant identity routes server-to-server',async()=>{
  const source=await read('supabase/functions/admin-users/index.ts');
  assert.match(source,/syncIdentityRoute/);
  assert.match(source,/PLATFORM_CONTROL_PLANE_URL/);
  assert.match(source,/PLATFORM_WORKSPACE_ID/);
  assert.match(source,/PLATFORM_BRIDGE_TOKEN/);
  assert.match(source,/register_identity/);
  assert.match(source,/unregister_identity/);
  assert.match(source,/previous_email/);
});
