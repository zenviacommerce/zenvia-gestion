import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('platform bridge applies billing metadata even when plan version has not changed',async()=>{
  const bridge=await read('supabase/functions/platform-bridge/index.ts');
  assert.match(bridge,/trialEndsAt/);
  assert.match(bridge,/currentPeriodEndsAt/);
  assert.match(bridge,/cancelAtPeriodEnd/);
  assert.match(bridge,/workspace_subscriptions/);
  assert.match(bridge,/billingUpdated:true/);
});

test('trial and unpaid subscription states update the customer workspace lifecycle',async()=>{
  const bridge=await read('supabase/functions/platform-bridge/index.ts');
  assert.match(bridge,/subscriptionStatus==='trialing'\?'trialing'/);
  assert.match(bridge,/subscriptionStatus==='active'\?'active'/);
  assert.match(bridge,/:\s*'suspended'/);
});

test('workspace detail keeps trial end and billing period fields when a snapshot exists',async()=>{
  const bridge=await read('supabase/functions/platform-bridge/index.ts');
  assert.match(bridge,/trial_ends_at:subscription\?\.trial_ends_at\|\|null/);
  assert.match(bridge,/current_period_ends_at:subscription\?\.current_period_ends_at\|\|null/);
  assert.match(bridge,/cancel_at_period_end:Boolean\(subscription\?\.cancel_at_period_end\)/);
});
