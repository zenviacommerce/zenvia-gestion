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
