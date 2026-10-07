import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const path=new URL('../src/services/amazonJobWait.ts',import.meta.url);
async function module(){const s=await readFile(path,'utf8');return import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));}
test('manual order sync waits for every queued and running job',async()=>{
 const {waitForAmazonJobs}=await module();let reads=0,time=0;
 await waitForAmazonJobs(['a','b'],{load:async()=>{reads++;return [{id:'a',status:'success'},{id:'b',status:reads===1?'queued':reads===2?'running':'success'}]},now:()=>time,pause:async ms=>{time+=ms}});
 assert.equal(reads,3);
});
test('failed, invisible, and timed out jobs never report success',async()=>{
 const {waitForAmazonJobs}=await module();
 await assert.rejects(waitForAmazonJobs(['a'],{load:async()=>[{id:'a',status:'failed'}]}),/fallado/);
 await assert.rejects(waitForAmazonJobs(['a'],{load:async()=>[]}),/comprobar/);
 let time=0;
 await assert.rejects(waitForAmazonJobs(['a'],{load:async()=>[{id:'a',status:'queued'}],now:()=>time,pause:async ms=>{time+=ms},timeoutMs:1000}),/sigue en curso/);
});
