import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('central Platform mailer owns branded invitation delivery through Resend',async()=>{
  const mailer=await read('supabase/functions/platform-mailer/index.ts');
  assert.match(mailer,/RESEND_API_KEY/);
  assert.match(mailer,/x-platform-token/);
  assert.match(mailer,/platform_bridge_secrets/);
  assert.match(mailer,/ZENVIA/);
  assert.match(mailer,/Activar mi cuenta/);
  assert.match(mailer,/app==='platform'/);
  assert.match(mailer,/app==='gestion'/);
  assert.match(mailer,/https:\/\/api\.resend\.com\/emails/);
});

test('Platform-created customer users only prepare an invite token when custom delivery is requested',async()=>{
  const bridge=await read('supabase/functions/platform-bridge/index.ts');
  const block=bridge.slice(bridge.indexOf("if(action==='invite_workspace_user')"),bridge.indexOf("if(action==='update_workspace_user')"));
  assert.match(block,/body\?\.delivery==='custom'/);
  assert.match(block,/auth\.admin\.generateLink/);
  assert.match(block,/properties\?\.hashed_token/);
  assert.match(block,/inviteTokenHash:customDelivery\?inviteTokenHash:null/);
});


test('central mailer sends password recovery through Resend instead of Supabase email delivery',async()=>{
  const mailer=await read('supabase/functions/platform-mailer/index.ts');
  assert.match(mailer,/\['invite','recovery','billing_invoice'\]\.includes\(event\)/);
  assert.match(mailer,/Restablece tu contraseña/);
  assert.match(mailer,/Crear nueva contraseña/);
  assert.match(mailer,/recoveryUrl/);
  assert.match(mailer,/https:\/\/api\.resend\.com\/emails/);
});
