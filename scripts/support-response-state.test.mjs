import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('customer workspace admins are still customer authors in support',async()=>{
  const migration=await read('supabase/migrations/20260927233000_support_response_state.sql');
  assert.match(migration,/new\.author_role:='user'/);
  assert.match(migration,/update public\.support_messages m[\s\S]*set author_role='user'[\s\S]*public\.app_users/);
});

test('support ticket tracks who owns the next response',async()=>{
  const migration=await read('supabase/migrations/20260927233000_support_response_state.sql');
  assert.match(migration,/last_author_role/);
  assert.match(migration,/last_author_role=new\.author_role/);
  assert.match(migration,/new\.author_role='user'[\s\S]*status='waiting_user'/);
});

test('Platform bootstrap exposes tickets awaiting an internal reply',async()=>{
  const bridge=await read('supabase/functions/platform-bridge/index.ts');
  assert.match(bridge,/ticketsAwaitingReply/);
  assert.match(bridge,/last_author_role/);
});
