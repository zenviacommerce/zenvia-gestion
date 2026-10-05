import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync('supabase/functions/_shared/amazon/orders.ts','utf8');
test('Amazon status and tracking update every existing copy without requiring an address',async()=>{
 const match=source.match(/export async function reconcileOperationalAmazonStates[\s\S]*?\n}\n/);assert.ok(match,'missing status reconciliation');
 const patches=[];
 const admin={from(){let patch;const q={update(p){patch=p;return q},eq(){return q},then(r){patches.push(patch);return Promise.resolve({error:null}).then(r)}};return q}};
 const fn=vm.runInNewContext(ts.transpile(match[0].replace('export ',''),{target:ts.ScriptTarget.ES2022})+'\nreconcileOperationalAmazonStates',{clean:v=>String(v??'').trim()});
 await fn(admin,[{orderId:'order',fulfillment:{fulfillmentStatus:'SHIPPED'},packages:[{trackingNumber:'TRACK',carrier:'MRW',shipTime:'2026-10-05T08:00:00Z'}]}],'owner');
 assert.equal(patches[0].source_status,'SHIPPED');assert.equal(patches[0].tracking_number,'TRACK');assert.equal(patches[0].fulfilled_at,'2026-10-05T08:00:00Z');
});
