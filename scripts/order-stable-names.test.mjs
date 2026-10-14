import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {transform} from 'esbuild';
const edge=await readFile(new URL('../supabase/functions/envia-shipping/index.ts',import.meta.url),'utf8');
const body=edge.slice(edge.indexOf('function humanCarrier('),edge.indexOf('function parseEtaDays('));
const code=(await transform(body,{loader:'ts'})).code;
const name=new Function(code+';return humanCarrier')();
test('Envia camel-case and spaced carrier codes produce the same display name',()=>{assert.equal(name('correosExpress'),'Correos Express');assert.equal(name('correos express'),'Correos Express');assert.equal(name('mrw'),'MRW');});
test('Amazon sync writes the connected account name instead of overwriting it with the channel',async()=>{const s=await readFile(new URL('../supabase/functions/_shared/amazon/orders.ts',import.meta.url),'utf8');assert.match(s,/integration_name:.*display_name/);assert.doesNotMatch(s,/integration_name:'Amazon',integration_type/);});
test('orders use persisted account names without an extra lookup per refresh',async()=>{const s=await readFile(new URL('../src/services/orders.ts',import.meta.url),'utf8');const part=s.slice(s.indexOf('export function listFulfillmentOrders'),s.indexOf('export function getSendcloudStatus'));assert.doesNotMatch(part,/invokeFunction.*integration-accounts/);assert.doesNotMatch(part,/from\('integration_accounts'\)/);assert.match(part,/return publishOrdersSnapshot\(orders,snapshotVersion\)/);});
