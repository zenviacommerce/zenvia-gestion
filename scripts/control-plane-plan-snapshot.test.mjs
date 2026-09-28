import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Gestion stores a read-only local subscription snapshot from Platform',async()=>{
  const sql=await read('supabase/migrations/20260928013000_subscription_snapshot.sql');
  assert.match(sql,/create table if not exists public\.app_subscription_state/);
  assert.match(sql,/workspace_id uuid primary key/);
  assert.match(sql,/plan_version integer not null/);
  assert.match(sql,/entitlements jsonb not null/);
  assert.match(sql,/alter table public\.app_subscription_state enable row level security/);
  assert.match(sql,/revoke insert,update,delete on public\.app_subscription_state from authenticated/);
  assert.match(sql,/app_subscription_state_member_read/);
});

test('workspace context prefers the Platform snapshot and falls back to legacy plans',async()=>{
  const sql=await read('supabase/migrations/20260928013000_subscription_snapshot.sql');
  assert.match(sql,/left join public\.app_subscription_state ss on ss\.workspace_id=w\.id/);
  assert.match(sql,/coalesce\(ss\.plan_key,ws\.plan_key,'internal'\)/);
  assert.match(sql,/coalesce\(ss\.plan_name,bp\.name,'Interno'\)/);
  assert.match(sql,/coalesce\(ss\.status,ws\.status,'active'\)/);
  assert.match(sql,/coalesce\(\s*ss\.entitlements,[\s\S]*jsonb_object_agg/);
  assert.match(sql,/7461b2b7-f383-460d-b1c7-6ccbb52e42b2/);
});

test('workspace context keeps its existing public return signature',async()=>{
  const sql=await read('supabase/migrations/20260928013000_subscription_snapshot.sql');
  for(const field of ['workspace_id uuid','workspace_name text','workspace_slug text','workspace_status text','plan_key text','plan_name text','subscription_status text','is_platform_admin boolean','entitlements jsonb']){
    assert.ok(sql.includes(field),'Missing context field '+field);
  }
});
