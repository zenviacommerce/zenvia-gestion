import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function transport(status=500){
 const exports={},calls=[];
 const credentials={clientId:'app',clientSecret:'secret',refreshToken:'own-token',sellerId:'own-seller'};
 const fetch=async(url,options)=>{calls.push({url:String(url),method:options.method});return String(url).includes('/auth/o2/token')?new Response(JSON.stringify({access_token:'token',expires_in:3600})):new Response(JSON.stringify({message:'controlled failure'}),{status});};
 const deps={readAmazonSpApiCredentials:()=>credentials,retryAfterMs:()=>0,sleep:async()=>{},sanitizeAmazonError:String};
 const code=ts.transpileModule(readFileSync(new URL('../supabase/functions/_shared/amazon/sp-api.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:()=>deps,fetch,Headers,URL,URLSearchParams,AbortSignal,Date});
 return {api:exports,calls,credentials};
}
for(const status of [400,429,500,504])test(`confirmation POST ${status} is attempted once even with maxAttempts=4`,async()=>{
 const {api,calls,credentials}=transport(status);
 await assert.rejects(api.spApiRequest('/orders/v0/orders/123-1234567-1234567/shipmentConfirmation',{method:'POST',body:{},maxAttempts:4},credentials));
 assert.equal(calls.filter(c=>c.url.includes('shipmentConfirmation')).length,1);
});
test('read-only GET retains bounded retries',async()=>{
 const {api,calls,credentials}=transport();
 await assert.rejects(api.spApiRequest('/orders/2026-01-01/orders/123-1234567-1234567',{maxAttempts:3},credentials));
 assert.equal(calls.filter(c=>c.method==='GET').length,3);
});
test('batch abort also cancels a hung LWA token request before any confirmation POST',async()=>{
 const exports={},controller=new AbortController(),calls=[];
 const code=ts.transpileModule(readFileSync(new URL('../supabase/functions/_shared/amazon/sp-api.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const fetch=(url,options)=>{calls.push(String(url));assert.ok(options.signal);return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));};
 vm.runInNewContext(code,{exports,require:()=>({sanitizeAmazonError:String,sleep:async()=>{},retryAfterMs:()=>1000}),fetch,Headers,URL,URLSearchParams,AbortSignal,Date,setTimeout,clearTimeout});
 const promise=exports.spApiRequest('/orders/v0/orders/123-1234567-1234567/shipmentConfirmation',{method:'POST',signal:controller.signal},{clientId:'app',clientSecret:'secret',refreshToken:'own',sellerId:'seller'});
 const timer=setTimeout(()=>controller.abort(new Error('verification budget expired')),5);
 try{await assert.rejects(promise,/budget expired/);assert.deepEqual(calls,['https://api.amazon.com/auth/o2/token']);}finally{clearTimeout(timer);}
});
test('a verification deadline interrupts retry backoff before another GET',async()=>{
 const exports={},controller=new AbortController(),calls=[];
 const code=ts.transpileModule(readFileSync(new URL('../supabase/functions/_shared/amazon/sp-api.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const fetch=async(url)=>{calls.push(String(url));return String(url).includes('/auth/o2/token')?new Response(JSON.stringify({access_token:'token',expires_in:3600})):new Response('{}',{status:500});};
 vm.runInNewContext(code,{exports,require:()=>({sanitizeAmazonError:String,sleep:async()=>{},retryAfterMs:()=>1000}),fetch,Headers,URL,URLSearchParams,AbortSignal,Date,setTimeout,clearTimeout});
 const promise=exports.spApiRequest('/orders/2026-01-01/orders/123-1234567-1234567',{signal:controller.signal},{clientId:'app',clientSecret:'secret',refreshToken:'own',sellerId:'seller'});
 const timer=setTimeout(()=>controller.abort(new Error('verification budget expired')),5);
 try{await assert.rejects(promise,/budget expired/);assert.equal(calls.filter(url=>url.includes('/orders/')).length,1);}finally{clearTimeout(timer);}
});
