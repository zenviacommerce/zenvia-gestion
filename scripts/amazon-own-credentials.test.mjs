import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function config(){
 const exports={};
 const source=readFileSync(new URL('../supabase/functions/_shared/amazon/config.ts',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,Deno:{env:{get:()=>JSON.stringify({clientId:'app',clientSecret:'app-secret',refreshToken:'GLOBAL-MUST-NEVER-BE-USED',sellerId:'global-seller'})}}});
 return exports;
}
function admin(secret,source='environment'){
 return {from(table){const row=table==='amazon_accounts'?{owner_id:'owner',seller_id:'own-seller',integration_account_id:'integration'}:{owner_id:'owner',external_account_id:'own-seller',credential_source:source,secret_id:secret?'secret':null};return {select(){return this},eq(){return this},async maybeSingle(){return {data:row,error:null}}}},async rpc(){return {data:JSON.stringify(secret),error:null}}};
}
for(const source of ['environment','vault'])test(`${source} account without its own refresh token fails explicitly`,async()=>{
 await assert.rejects(config().loadAmazonSpApiCredentials(admin(null,source),{amazonAccountId:'account',ownerId:'owner'}),/cuenta Amazon sin credenciales/);
});
test('legacy environment helper cannot use a global seller token',()=>{
 assert.throws(()=>config().readAmazonSpApiCredentials(),/cuenta Amazon sin credenciales/);
});
for(const key of ['refreshToken','refresh_token'])test(`own ${key} works with shared application credentials`,async()=>{
 const result=await config().loadAmazonSpApiCredentials(admin({[key]:'OWN-TOKEN'}),{amazonAccountId:'account',ownerId:'owner'});
 assert.equal(result.refreshToken,'OWN-TOKEN');assert.equal(result.clientId,'app');assert.equal(result.sellerId,'own-seller');
});
test('whitespace refresh token is rejected without global fallback',async()=>{
 await assert.rejects(config().loadAmazonSpApiCredentials(admin({refreshToken:'  '}),{amazonAccountId:'account',ownerId:'owner'}),/cuenta Amazon sin credenciales/);
});
