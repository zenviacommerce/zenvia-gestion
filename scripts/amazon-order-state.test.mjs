import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync('supabase/functions/_shared/amazon/orders.ts','utf8');
test('Amazon status and tracking update every existing copy without requiring an address',async()=>{
 const match=source.match(/export async function reconcileOperationalAmazonStates[\s\S]*?\n}\n/);assert.ok(match,'missing status reconciliation');
 const patches=[];
 const admin={from(table){let patch;const q={select(){return q},in(){return q},update(p){patch=p;return q},eq(){return q},then(r){if(patch)patches.push(patch);return Promise.resolve({data:table==='fulfillment_orders'?[{id:'one',order_number:'order'},{id:'two',order_number:'order'}]:[],error:null}).then(r)}};return q}};
 const exp={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exp,require:()=>({}),console});const fn=exp.reconcileOperationalAmazonStates;
 await fn(admin,[{orderId:'order',fulfillment:{fulfillmentStatus:'SHIPPED'},packages:[{trackingNumber:'TRACK',carrier:'MRW',shipTime:'2026-10-05T08:00:00Z'}]}],'owner');
 assert.equal(patches.length,2);assert.equal(patches[0].source_status,'SHIPPED');assert.equal(patches[0].tracking_number,'TRACK');assert.equal(patches[0].fulfilled_at,'2026-10-05T08:00:00Z');
});
