import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/pages/Orders.tsx',import.meta.url),'utf8');
test('order refreshes share an in-flight request and can run again after it completes',async()=>{
 const start=source.indexOf('  const refresh=useCallback');const end=source.indexOf('  useEffect(()=>watchFulfillmentOrders',start);
 let resolve;let calls=0;const ref={current:null};
 const context=vm.createContext({useCallback:fn=>fn,refreshRequest:ref,listFulfillmentOrders:()=>{calls++;return new Promise(r=>{resolve=r})},setOrders:()=>{},setError:()=>{},errorMessage:()=>''});
 vm.runInContext(ts.transpile(source.slice(start,end))+';globalThis.refresh=refresh;',context);
 const first=context.refresh(),second=context.refresh();assert.equal(calls,1);assert.equal(first,second);resolve([]);await first;await Promise.resolve();const third=context.refresh();assert.equal(calls,2);resolve([]);await third;
});
test('initial order loading finishes while carrier requests remain pending',async()=>{
 const start=source.indexOf('  useEffect(()=>{(async()=>{setLoading(true);');
 const end=source.indexOf('\n',start);
 const states=[];const never=new Promise(()=>{});const context=vm.createContext({useEffect:fn=>fn(),setLoading:value=>states.push(value),refresh:async()=>{},refreshStatus:()=>never,refreshEnviaStatus:()=>never,refreshTariffs:()=>never});
 vm.runInContext(ts.transpile(source.slice(start,end)),context);
 await new Promise(r=>setTimeout(r,0));assert.equal(states.at(-1),false);
});

test('carrier discovery is cancelled instead of blocking indefinitely',async()=>{
 const backend=fs.readFileSync(new URL('../supabase/functions/sendcloud-orders/index.ts',import.meta.url),'utf8');
 const start=backend.indexOf('async function integrations('),end=backend.indexOf('\nfunction daysAgo',start);
 const context=vm.createContext({AbortSignal:{timeout:()=>AbortSignal.timeout(1)},sendcloudJson:(_credentials,_path,options)=>new Promise((resolve,reject)=>{options?.signal?.addEventListener('abort',()=>reject(Error('timeout')),{once:true})})});
 vm.runInContext(ts.transpile(backend.slice(start,end))+';globalThis.run=integrations;',context);
 const result=await Promise.race([context.run({}).then(()=> 'resolved',()=> 'cancelled'),new Promise(resolve=>setTimeout(()=>resolve('blocked'),30))]);
 assert.equal(result,'cancelled');
});
