import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('auth tenant resolution supports explicit URL, remembered tenant and email fallback',async()=>{
  const tenant=await read('src/services/tenant.ts');
  assert.match(tenant,/export async function resolveTenantForAuthentication/);
  assert.match(tenant,/tenantSlugFromUrl/);
  assert.match(tenant,/readRememberedTenantConnection/);
  assert.match(tenant,/resolveTenant\(\{email/);
  assert.match(tenant,/status==='multiple'/);
  assert.match(tenant,/más de una empresa/);
  assert.match(tenant,/enlace de acceso no es válido/);
});

test('switching tenants signs out the previous local session before activation',async()=>{
  const source=await read('src/services/supabase.ts');
  assert.match(source,/export async function activateTenant/);
  assert.match(source,/scope:'local'/);
  assert.match(source,/previous\.auth\.signOut/);
  assert.match(source,/setActiveTenant\(connection/);
});

test('password and passkey authenticate only after tenant resolution',async()=>{
  const source=await read('src/components/AuthScreen.tsx');
  assert.match(source,/resolveTenantForAuthentication/);
  assert.match(source,/activateTenant/);
  assert.match(source,/getActiveSupabase/);
  assert.match(source,/signInWithPassword/);
  assert.match(source,/signInWithPasskey/);
  assert.match(source,/onAuthenticated/);
  assert.doesNotMatch(source,/import \{ supabase \} from '..\/services\/supabase'/);
});

test('App boot resolves URL tenant before reading or subscribing to auth state',async()=>{
  const source=await read('src/App.tsx');
  assert.match(source,/bootstrapTenantForAuthentication/);
  assert.match(source,/hasActiveTenant/);
  assert.match(source,/getActiveSupabase/);
  assert.match(source,/tenantRevision/);
  assert.match(source,/onAuthenticated/);
});

test('customer invitations preserve tenant slug in the redirect',async()=>{
  const bridge=await read('supabase/functions/platform-bridge/index.ts');
  assert.match(bridge,/tenant=/);
  assert.match(bridge,/workspaceSlug/);
  assert.match(bridge,/inviteUserByEmail/);
});


test('invalid explicit tenant detaches the previous active data plane without forgetting the remembered choice',async()=>{
  const app=await read('src/App.tsx');
  const authBoot=app.slice(app.indexOf('bootstrapTenantForAuthentication'),app.indexOf('},[tenantRevision])'));
  assert.match(authBoot,/clearActiveTenant\(\{forget:false\}\)/);
  assert.match(authBoot,/setTenantBootError/);
});
