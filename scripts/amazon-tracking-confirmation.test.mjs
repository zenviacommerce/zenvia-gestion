import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path){
  try{return await readFile(new URL(`../${path}`,import.meta.url),'utf8');}
  catch{return '';}
}

test('fulfillment orders persist Amazon tracking confirmation state',async()=>{
  const sql=await source('supabase/migrations/20260917103000_amazon_tracking_confirmation.sql');
  assert.match(sql,/amazon_tracking_synced_at\s+timestamptz/i);
  assert.match(sql,/amazon_tracking_last_attempt_at\s+timestamptz/i);
  assert.match(sql,/amazon_tracking_sync_error\s+text/i);
  assert.match(sql,/amazon_tracking_sync_attempts\s+integer/i);
});

test('Amazon tracking helper inspects packages and confirms shipment with the Orders API',async()=>{
  const helper=await source('supabase/functions/_shared/amazon/shipment-confirmation.ts');
  assert.match(helper,/includedData\s*:\s*\[['"]PACKAGES['"]\]/i);
  assert.match(helper,/packageReferenceId/i);
  assert.match(helper,/shipmentConfirmation/i);
  assert.match(helper,/trackingNumber/i);
  assert.match(helper,/orderItemId/i);
  assert.match(helper,/quantity/i);
});

test('automatic retry only reprocesses confirmations previously attempted by this integration',async()=>{
  const helper=await source('supabase/functions/_shared/amazon/shipment-confirmation.ts');
  assert.match(helper,/amazon_confirmation_due/);
  const ledger=await source('supabase/migrations/20261016063000_amazon_confirmation_ledger.sql');
  assert.match(ledger,/coalesce\(f\.amazon_tracking_sync_attempts,0\)>0 or p_include_fresh/);
  assert.doesNotMatch(helper,/TRACKING_BACKFILL_DAYS/);
});

test('Amazon tracking edge function supports one-order confirmation and retries',async()=>{
  const fn=await source('supabase/functions/amazon-confirm-shipment/index.ts');
  assert.match(fn,/syncAmazonTracking/i);
  assert.match(fn,/retryPendingAmazonTracking/i);
  assert.match(fn,/confirm_order_tracking/i);
  assert.match(fn,/retry_pending/i);
});

test('label creation keeps the label if Amazon confirmation fails and retries no longer depend on Sendcloud',async()=>{
  const [orders,worker,helper]=await Promise.all([
    source('src/services/orders.ts'),
    source('supabase/functions/amazon-sync-worker/index.ts'),
    source('supabase/functions/_shared/amazon/shipment-confirmation.ts'),
  ]);
  assert.match(orders,/amazon-confirm-shipment/i);
  assert.match(orders,/createOrderLabel[\s\S]{0,1800}confirmOrderTracking/i);
  assert.match(orders,/retryAmazonTrackingConfirmations/);
  assert.match(worker,/retryPendingAmazonTracking/);
  assert.match(helper,/legacy\?null:/);
  assert.match(helper,/executeAmazonConfirmation/);
  assert.doesNotMatch(helper,/Sendcloud no devolvió un parcel_id/);
});
