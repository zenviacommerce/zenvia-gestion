import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {transform} from 'esbuild';
const service=await readFile(new URL('../src/services/amazon.ts',import.meta.url),'utf8');
const source=service.slice(service.indexOf('async function rpc<'),service.indexOf('export async function loadAmazonStatus'));
const code=(await transform(source,{loader:'ts'})).code;
const queueCode=(await transform(await readFile(new URL('../src/services/amazonReadQueue.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm'})).code;
const {createAmazonReadQueue}=await import('data:text/javascript;base64,'+Buffer.from(queueCode).toString('base64'));
function api(current,queue){return new Function('getActiveSupabase','getActiveTenant','analyticsReads','invalidateAmazonAnalytics','startActivity','withAmazonTimeout','message','notifyAmazonConnectivityError','AMAZON_ACTIVITY_LABELS','navigator',code+';return {rpc};')(()=>current.client,()=>({workspace_id:current.workspace}),queue,()=>queue.clear(),()=>({finish(){},update(){}}),p=>Promise.resolve(p),(d,e,f)=>e?.message||f,()=>{},{},{onLine:true})}
const client=(id,calls,load=()=>id)=>({auth:{getSession:async()=>({data:{session:{user:{id}}}})},rpc(name){calls.push(id);return {abortSignal:()=>Promise.resolve(load(name)).then(data=>({data,error:null}))}}});
test('queued analytics stays bound to its original workspace client',async()=>{
 const queue=createAmazonReadQueue(1);let unblock;const blocker=queue.read('block',()=>new Promise(r=>unblock=r));await Promise.resolve();
 const calls=[];const current={workspace:'a',client:client('a',calls)};const {rpc}=api(current,queue);const result=rpc('amazon_analytics_summary',{},'error');await Promise.resolve();await Promise.resolve();
 current.workspace='b';current.client=client('b',calls);unblock(0);await blocker;assert.equal(await result,'a');assert.deepEqual(calls,['a']);
});
test('mapping commit invalidates reads cached during the write',async()=>{
 const queue=createAmazonReadQueue();let finish;const calls=[];let value='old';const current={workspace:'a',client:client('a',calls,name=>name==='amazon_add_product_mapping'?new Promise(r=>finish=r):value)};
 const {rpc}=api(current,queue);const write=rpc('amazon_add_product_mapping',{},'error');await Promise.resolve();
 assert.equal(await rpc('amazon_analytics_summary',{},'error'),'old');value='new';finish({ok:true});await write;
 assert.equal(await rpc('amazon_analytics_summary',{},'error'),'new');
});
