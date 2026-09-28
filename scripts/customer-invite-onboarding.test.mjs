import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('platform owner invites land in customer app and require password setup',async()=>{
  const platform=await read('supabase/functions/platform-bridge/index.ts');
  assert.match(platform,/CUSTOMER_APP_URL/);
  assert.match(platform,/https:\/\/gestion\.zenviacommerce\.com/);
  assert.match(platform,/inviteUserByEmail\(ownerEmail,\{/);
  assert.match(platform,/redirectTo:customerAppUrl/);
  assert.match(platform,/onboarding_pending:true/);
});

test('customer app blocks invited owners until they create a password',async()=>{
  const [app,screen]=await Promise.all([
    read('src/App.tsx'),
    read('src/components/InvitePasswordSetup.tsx'),
  ]);
  assert.match(app,/user_metadata\?\.onboarding_pending===true/);
  assert.match(app,/<InvitePasswordSetup/);
  assert.match(screen,/supabase\.auth\.updateUser\(\{password,data:metadata\}\)/);
  assert.match(screen,/onboarding_pending:false/);
  assert.match(screen,/password\.length<8/);
  assert.match(screen,/password!==confirm/);
});


test('managed user creation sends a temporary-password onboarding email and forces first-login change',async()=>{
  const [edge,admin]=await Promise.all([
    read('supabase/functions/admin-users/index.ts'),
    read('src/pages/Admin.tsx'),
  ]);
  assert.match(edge,/onboarding_pending:true/);
  assert.match(edge,/sendWelcomeEmail/);
  assert.match(edge,/RESEND_API_KEY/);
  assert.match(edge,/temporaryPassword/);
  assert.match(edge,/\?tenant=\$\{encodeURIComponent\(input\.workspaceSlug\)\}/);
  assert.match(edge,/Debes cambiar esta contraseña en tu primer acceso/);
  assert.match(admin,/Contraseña temporal/);
  assert.match(admin,/Se enviará por correo/);
});

test('identity route sync cannot roll back a successfully created managed user',async()=>{
  const edge=await read('supabase/functions/admin-users/index.ts');
  assert.match(edge,/trySyncIdentityRoute/);
  assert.doesNotMatch(edge,/await admin\.from\('app_users'\)\.delete\(\)[\s\S]{0,400}syncIdentityRoute/);
  assert.match(edge,/routeSynced/);
});


test('customer bridge exposes a lightweight active-user identity lookup for router self-heal',async()=>{
  const bridge=await read('supabase/functions/platform-bridge/index.ts');
  assert.match(bridge,/action==='resolve_identity'/);
  assert.match(bridge,/app_users/);
  assert.match(bridge,/active',true/);
  assert.match(bridge,/exists:Boolean/);
});


test('managed user creation reports duplicate emails instead of a generic Edge Function failure',async()=>{
  const [edge,access]=await Promise.all([
    read('supabase/functions/admin-users/index.ts'),
    read('src/services/access.ts'),
  ]);
  assert.match(edge,/Ya existe un usuario con ese correo electrónico/);
  assert.match(edge,/\.ilike\('email', email\)/);
  assert.match(edge,/already\|registered\|exists\|duplicate/);
  assert.match(access,/FunctionsHttpError/);
  assert.match(access,/payload\?\.error\s*\|\|\s*payload\?\.message/);
});
