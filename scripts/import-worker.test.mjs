import test from 'node:test';import assert from 'node:assert/strict';
const api=await import('../shared/imports/worker.ts').catch(()=>({}));
test('isolates one failed item and continues processing remaining work',async()=>{
 assert.equal(typeof api.runImportBatch,'function');const saved=[];
 const repo={claim:async()=>[{id:'a',attempts:1,max_attempts:5},{id:'b',attempts:1,max_attempts:5}],finish:async(i,o)=>{saved.push([i.id,o]);return true;}};
 await api.runImportBatch(repo,async i=>{if(i.id==='a')throw new Error('HTTP 429');return {status:'imported',result:{id:'invoice'}};});
 assert.equal(saved.length,2);assert.equal(saved[0][1].status,'queued');assert.equal(saved[1][1].status,'imported');
});
test('stale lease does not count as a committed result',async()=>{
 assert.equal(typeof api.runImportBatch,'function');
 const result=await api.runImportBatch({claim:async()=>[{id:'a',attempts:1,max_attempts:5}],finish:async()=>false},async()=>({status:'imported'}));
 assert.deepEqual(result,{claimed:1,committed:0});
});
test('an exhausted temporary error is visible and remains manually retryable',async()=>{
 assert.equal(typeof api.runImportBatch,'function');let saved;
 await api.runImportBatch({claim:async()=>[{id:'a',attempts:5,max_attempts:5}],finish:async(_,o)=>{saved=o;return true}},async()=>{throw new Error('HTTP 503')});
 assert.equal(saved.status,'error');assert.equal(saved.retryable,true);
});
test('a failed acknowledgement does not abort acknowledgement of another item',async()=>{const saved=[];const result=await api.runImportBatch({claim:async()=>[{id:'a',attempts:1,max_attempts:5},{id:'b',attempts:1,max_attempts:5}],finish:async(item)=>{if(item.id==='a')throw new Error('Database unavailable');saved.push(item.id);return true}},async()=>({status:'imported'}));assert.deepEqual(saved,['b']);assert.deepEqual(result,{claimed:2,committed:1})});
