import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
test('Shopify refresh retries pending marketplace confirmations before refreshing the list',async()=>{
 const source=fs.readFileSync('src/services/orders.ts','utf8');
 const code=source.slice(source.indexOf('export async function syncShopifyOrders'),source.indexOf('export function createManualOrder')).replace('export ','');
 const calls=[];
 const run=vm.runInNewContext(stripTypeScriptTypes(code)+';syncShopifyOrders',{invokeFunction:async(...args)=>{calls.push(args[0]);return {ok:true,configured:true,synced:1}},retryAmazonTrackingConfirmations:async()=>calls.push('retry')});
 const result=await run(false);assert.equal(result.synced,1);assert.deepEqual(calls,['shopify-orders','retry']);
 calls.length=0;await run(false,false);assert.deepEqual(calls,['shopify-orders']);
});
