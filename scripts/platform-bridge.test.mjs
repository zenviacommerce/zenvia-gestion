import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('Gestion exposes Platform access only through the server-to-server bridge',async()=>{
  const bridge=await read('supabase/functions/platform-bridge/index.ts');
  const notify=await read('supabase/functions/support-notify/index.ts');
  assert.match(bridge,/platform_bridge_secrets/);
  assert.match(bridge,/x-platform-token/);
  assert.match(bridge,/sha256\(supplied\)/);
  assert.match(notify,/x-platform-token/);
  assert.match(notify,/platform_bridge_secrets/);
});


test('Platform bridge can generate a silent recovery token and still supports tenant cleanup',async()=>{
  const bridge=await read('supabase/functions/platform-bridge/index.ts');
  const recovery=bridge.slice(bridge.indexOf("if(action==='reset_workspace_user_password')"),bridge.indexOf("if(action==='delete_workspace_full')"));
  assert.match(recovery,/body\?\.delivery==='custom'/);
  assert.match(recovery,/auth\.admin\.generateLink/);
  assert.match(recovery,/type:'recovery'/);
  assert.match(recovery,/properties\?\.hashed_token/);
  assert.match(recovery,/recoveryTokenHash/);
  assert.match(recovery,/resetPasswordForEmail/);
  assert.match(bridge,/action==='delete_workspace_full'/);
  assert.match(bridge,/purgeWorkspaceStorage/);
  assert.match(bridge,/admin\.auth\.admin\.deleteUser/);
  assert.match(bridge,/from\('workspaces'\)\.delete\(\)/);
});

test('dedicated schemas provision the company branding bucket',async()=>{
  const migration=await read('supabase/migrations/20260928211500_company_assets_bucket.sql');
  assert.match(migration,/company-assets/);
  assert.match(migration,/5\*1024\*1024/);
  assert.match(migration,/company_assets_select/);
  assert.match(migration,/company_assets_insert/);
});


test('shared support reads are isolated by workspace for Platform aggregation',async()=>{
  const bridge=await read('supabase/functions/platform-bridge/index.ts');
  const bootstrap=bridge.slice(bridge.indexOf("if(action==='bootstrap')"),bridge.indexOf("if(action==='list_workspaces')"));
  const tickets=bridge.slice(bridge.indexOf("if(action==='list_tickets')"),bridge.indexOf("if(action==='ticket_detail')"));
  assert.match(bootstrap,/workspaceId=asText\(body\?\.workspaceId,80\)/);
  assert.match(bootstrap,/support_tickets'[\s\S]*eq\('owner_id',workspaceId\)/);
  assert.match(tickets,/workspaceId=asText\(body\?\.workspaceId,80\)/);
  assert.match(tickets,/eq\('owner_id',workspaceId\)/);
  assert.match(tickets,/workspace\?\.name/);
});


test('Platform can request a silent invite token so ZENVIA can deliver its own branded email',async()=>{
  const bridge=await read('supabase/functions/platform-bridge/index.ts');
  const block=bridge.slice(bridge.indexOf("if(action==='invite_workspace_user')"),bridge.indexOf("if(action==='update_workspace_user')"));
  assert.match(block,/body\?\.delivery==='custom'/);
  assert.match(block,/auth\.admin\.generateLink/);
  assert.match(block,/type:'invite'/);
  assert.match(block,/properties\?\.hashed_token/);
  assert.match(block,/inviteUserByEmail/);
  assert.match(block,/inviteTokenHash:customDelivery\?inviteTokenHash:null/);
});
