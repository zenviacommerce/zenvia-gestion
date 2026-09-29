import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('platform user invites expose a token hash instead of an auto-login action link',async()=>{
  const platform=await read('supabase/functions/platform-bridge/index.ts');
  const block=platform.slice(platform.indexOf("if(action==='invite_workspace_user')"),platform.indexOf("if(action==='update_workspace_user')"));
  assert.match(block,/auth\.admin\.generateLink/);
  assert.match(block,/properties\?\.hashed_token/);
  assert.match(block,/inviteTokenHash/);
  assert.doesNotMatch(block,/properties\?\.action_link/);
  assert.match(block,/onboarding_pending:true/);
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


test('managed user creation sends a password-first branded invitation',async()=>{
  const [edge,admin,access]=await Promise.all([
    read('supabase/functions/admin-users/index.ts'),
    read('src/pages/Admin.tsx'),
    read('src/services/access.ts'),
  ]);
  assert.match(edge,/auth\.admin\.generateLink/);
  assert.match(edge,/properties\?\.hashed_token/);
  assert.match(edge,/sendInviteViaPlatform/);
  assert.match(edge,/send_user_invite/);
  assert.match(edge,/onboarding_pending:true/);
  assert.doesNotMatch(edge,/temporaryPassword/);
  assert.doesNotMatch(edge,/sendWelcomeEmail/);
  assert.doesNotMatch(admin,/Contraseña temporal/);
  assert.match(admin,/El usuario creará su contraseña/);
  assert.match(admin,/Enviar invitación/);
  assert.doesNotMatch(access,/createManagedUser\(input: \{ email: string; fullName: string; password:/);
});

test('failed invitation delivery rolls back the newly created managed user',async()=>{
  const edge=await read('supabase/functions/admin-users/index.ts');
  assert.match(edge,/trySyncIdentityRoute/);
  assert.match(edge,/sendInviteViaPlatform/);
  assert.match(edge,/if\(!invitation\.delivered\)/);
  assert.match(edge,/unregister_identity/);
  assert.match(edge,/deleteUser\(generated\.user\.id\)/);
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
