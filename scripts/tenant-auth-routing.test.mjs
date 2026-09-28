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

test('runtime tenant routing has no hardcoded legacy Gestion project fallback',async()=>{
  const source=await read('src/services/supabase.ts');
  assert.doesNotMatch(source,/sjkxxbedkkmgmqnvaqjh/);
  assert.doesNotMatch(source,/7461b2b7-f383-460d-b1c7-6ccbb52e42b2/);
  assert.match(source,/getActiveSupabase/);
  assert.match(source,/clearActiveTenant/);
});

test('explicit invalid invitation tenant never falls back to another tenant',async()=>{
  const source=await read('src/services/supabase.ts');
  assert.match(source,/TenantResolutionError/);
  assert.match(source,/No se ha encontrado la empresa indicada/);
  assert.match(source,/tenantFromUrl/);
  assert.match(source,/throw new TenantResolutionError/);
});

test('switching tenants clears the previous local auth session',async()=>{
  const source=await read('src/services/supabase.ts');
  assert.match(source,/signOut\(\{scope:'local'\}\)/);
  assert.match(source,/activeTenant\.workspace_id!==tenant\.workspace_id/);
});

test('two tenant clients use isolated project-scoped auth storage keys',async()=>{
  const source=await read('src/services/supabase.ts');
  assert.match(source,/storageKey:tenantStorageKey\(tenant\)/);
  assert.match(source,/zenvia-gestion-auth-/);
});

test('only the tenant Supabase boundary creates browser Supabase clients',async()=>{
  const {readdir,readFile}=await import('node:fs/promises');
  const path=await import('node:path');
  const root=path.resolve(new URL('../src',import.meta.url).pathname);
  const offenders=[];
  async function walk(dir){
    for(const entry of await readdir(dir,{withFileTypes:true})){
      const full=path.join(dir,entry.name);
      if(entry.isDirectory())await walk(full);
      else if(/\.(ts|tsx)$/.test(entry.name)){
        const text=await readFile(full,'utf8');
        if(text.includes('createClient(')&&!full.endsWith(path.join('services','supabase.ts')))offenders.push(full);
      }
    }
  }
  await walk(root);
  assert.deepEqual(offenders,[]);
});

test('remembered tenant allows passkey without probing other Supabases',async()=>{
  const auth=await read('src/components/AuthScreen.tsx');
  assert.match(auth,/getActiveTenant/);
  assert.match(auth,/if\(!email\.trim\(\)&&activeTenant\)/);
  assert.match(auth,/signInWithPasskey/);
});
