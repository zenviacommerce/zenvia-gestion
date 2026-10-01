import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('Orders sync uses v2026-01-01 searchOrders with the recipient datasets needed for direct fulfillment',async()=>{
  const orders=await source('supabase/functions/_shared/amazon/orders.ts');
  assert.match(orders,/\/orders\/2026-01-01\/orders/);
  assert.match(orders,/createdAfter/);
  assert.match(orders,/createdBefore/);
  assert.match(orders,/lastUpdatedAfter/);
  assert.match(orders,/lastUpdatedBefore/);
  assert.match(orders,/paginationToken/);
  assert.match(orders,/nextToken/);
  for(const dataset of ['PROCEEDS','EXPENSE','PROMOTION','CANCELLATION','FULFILLMENT','TAX','BUYER','RECIPIENT'])assert.match(orders,new RegExp(dataset));
  assert.match(orders,/OPERATIONAL_INCLUDED_DATA/);
  assert.match(orders,/Amazon SP-API \\(403\\)/);
});

test('Orders sync upserts orders and line items with stable conflict keys',async()=>{
  const orders=await source('supabase/functions/_shared/amazon/orders.ts');
  assert.match(orders,/amazon_orders/);
  assert.match(orders,/amazon_order_items/);
  assert.match(orders,/owner_id,amazon_account_id,marketplace_id,amazon_order_id/);
  assert.match(orders,/owner_id,amazon_account_id,marketplace_id,amazon_order_id,order_item_id/);
  assert.match(orders,/seller_sku/);
  assert.match(orders,/asin/);
  assert.match(orders,/quantity_ordered/);
  assert.match(orders,/AMAZON_BUSINESS/);
  assert.match(orders,/is_business_order/);
  assert.match(orders,/programs/);
});

test('Orders analytics normalization remains separate while operational Amazon orders persist only the shipping PII required for fulfillment',async()=>{
  const orders=await source('supabase/functions/_shared/amazon/orders.ts');
  assert.match(orders,/normalizeAmazonOrder/);
  assert.match(orders,/upsertOperationalAmazonOrders/);
  assert.match(orders,/recipient\?\.deliveryAddress/);
  assert.match(orders,/buyer\?\.buyerEmail/);
  assert.match(orders,/source_channel:'amazon'/);
  assert.match(orders,/integration_type:'amazon-direct'/);
  assert.match(orders,/amazon:/);
  assert.match(orders,/fulfillment_orders/);
});

test('Orders Edge Function is internal-only and delegates one job',async()=>{
  const edge=await source('supabase/functions/amazon-sync-orders/index.ts');
  assert.match(edge,/requireInternalSecret/);
  assert.match(edge,/syncOrdersJob/);
});


test('direct Amazon operational sync preserves existing logistics state instead of replacing labels or tracking',async()=>{
  const orders=await source('supabase/functions/_shared/amazon/orders.ts');
  assert.match(orders,/existingByOrder/);
  assert.match(orders,/current\?\.raw_payload/);
  assert.match(orders,/mergeOperationalItems/);
  assert.doesNotMatch(orders,/shipping_provider:'amazon'/);
});
