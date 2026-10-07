import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import vm from 'node:vm';
test('manual orders-only sync returns the actual job IDs and keeps other sources unchanged',async()=>{
 let handler,sources;
 const chain=data=>({select(){return this},eq(){return this},neq(){return this},in(){return this},order(){return this},then(resolve){return Promise.resolve({data,error:null}).then(resolve)}});
 const admin={from(table){return chain(table==='integration_accounts'?[{id:'integration'}]:[{id:'order-job'}])}};
 const deps={authenticateAdminUser:async()=>({role:'admin',data_owner_id:'owner'}),createAdminClient:()=>admin,getAdminKey:()=>'',ensureAmazonAccountAndMarketplaces:async()=>({account:{id:'account'},marketplaces:[{marketplace_id:'ES'}]}),loadAmazonAutomaticSyncSettings:async()=>({enabledSources:['orders','finances','inventory'],activeMarketplaceIds:[]}),filterAutomaticMarketplaces:x=>x,enqueueHourlySync:async(_a,_b,_c,_d,_e,input)=>{sources=input;return input.map(source=>({source,job_key:source}))}};
 const source=await readFile(new URL('../supabase/functions/amazon-sync-manual/index.ts',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:{},require:()=>deps,Deno:{serve:fn=>{handler=fn},env:{get:()=>''}},Response,Date,AbortController,setTimeout,clearTimeout});
 const response=await handler({method:'POST',json:async()=>({ordersOnly:true})});
 const body=await response.json();assert.equal(response.status,200);assert.deepEqual(Array.from(sources),['orders']);assert.deepEqual(body.orderJobIds,['order-job']);assert.equal(body.jobs,1);
 await handler({method:'POST',json:async()=>({})});assert.deepEqual(Array.from(sources),['orders','finances','inventory']);
});
