import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
test('orders refresh does not wait for Amazon queue before reconciling local orders',async()=>{
 const source=fs.readFileSync('src/pages/Orders.tsx','utf8');
 const line=source.split('\n').find(l=>l.includes('runAmazon?(async()=>'));
 const expression=line.trim().replace(/,$/,'');const calls=[];
 const promise=vm.runInNewContext(stripTypeScriptTypes(expression),{runAmazon:true,automatic:false,silent:false,requestAmazonSync:()=>{calls.push('queued');return new Promise(()=>{})},reconcileAmazonOrders:async()=>{calls.push('reconciled');return {processed:1}},showInfo:()=>{},errorMessage:()=>'',Promise});
 const result=await Promise.race([promise,new Promise(resolve=>setTimeout(()=>resolve(null),40))]);
 assert.equal(result?.processed,1);assert.deepEqual(calls,['queued','reconciled']);
});
