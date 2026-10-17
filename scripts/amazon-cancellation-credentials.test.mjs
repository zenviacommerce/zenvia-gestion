import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const GLOBAL='GLOBAL-SECRET-CANARY',OWN='OWN-SECRET-CANARY';
function config(allowed='legacy-integration'){
 const exports={},logs=[];
 const source=readFileSync(new URL(process.env.AMAZON_CREDENTIAL_TEST_FILE||'../supabase/functions/_shared/amazon/config.ts',import.meta.url),'utf8');
 const env={AMAZON_LEGACY_FALLBACK_ACCOUNT_ID:allowed,AMAZON_SPAPI_CREDENTIALS:JSON.stringify({clientId:'app',clientSecret:'app-secret',refreshToken:GLOBAL,sellerId:'legacy-seller'})};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,Deno:{env:{get:k=>env[k]}},console:{warn:(...args)=>logs.push(args)}});
 return {...exports,logs};
}
function admin({id='legacy-integration',secret=null,source='environment',seller='legacy-seller',owner='owner',extra=[]}={}){
 const tables={amazon_accounts:[{id:'amazon-account',owner_id:owner,seller_id:seller,integration_account_id:id}],integration_accounts:[{id,owner_id:owner,external_account_id:seller,credential_source:source,secret_id:secret?'secret':null,provider:'amazon'},...extra]};
 return {from(table){let filters=[];return {select(){return this},eq(k,v){filters.push([k,v]);return this},async maybeSingle(){return {data:tables[table].find(r=>filters.every(([k,v])=>r[k]===v))||null,error:null}}}},async rpc(){return {data:JSON.stringify(secret),error:null}}};
}
const options={amazonAccountId:'amazon-account',ownerId:'owner'};
test('authorized integration uses fallback and logs safe account metadata every load',async()=>{
 const c=config();for(let n=0;n<2;n++)assert.equal((await c.loadAmazonSpApiCredentials(admin(),options)).refreshToken,GLOBAL);
 assert.equal(c.logs.length,2);assert.match(JSON.stringify(c.logs),/legacy-integration/);assert.doesNotMatch(JSON.stringify(c.logs),/SECRET-CANARY|app-secret/);
});
test('authorized integration-only marketplace path uses same scoped fallback',async()=>{
 assert.equal((await config().loadAmazonSpApiCredentials(admin(),{integrationAccountId:'legacy-integration',ownerId:'owner'})).refreshToken,GLOBAL);
});
for(const source of ['environment','vault'])test(`second ${source} account cannot use global even with same seller`,async()=>{
 const c=config();await assert.rejects(c.loadAmazonSpApiCredentials(admin({id:'other',source}),options),/cuenta Amazon sin credenciales/);assert.equal(c.logs.length,0);
});
for(const key of ['refreshToken','refresh_token'])test(`own ${key} always wins even for authorized account`,async()=>{
 const c=config();assert.equal((await c.loadAmazonSpApiCredentials(admin({secret:{[key]:OWN}}),options)).refreshToken,OWN);assert.equal(c.logs.length,0);
});
test('own token works on nonlegacy account',async()=>{assert.equal((await config().loadAmazonSpApiCredentials(admin({id:'other',secret:{refreshToken:OWN}}),options)).refreshToken,OWN)});
test('unset allowlist denies fallback',async()=>{await assert.rejects(config('').loadAmazonSpApiCredentials(admin(),options),/cuenta Amazon sin credenciales/)});
test('whitespace own token is missing and only allowed account may fallback',async()=>{assert.equal((await config().loadAmazonSpApiCredentials(admin({secret:{refreshToken:'  '}}),options)).refreshToken,GLOBAL)});
test('environment-only helper still fails closed',()=>{assert.throws(()=>config().readAmazonSpApiCredentials(),/cuenta Amazon sin credenciales/)});
test('mismatched explicit integration cannot redirect a job to authorized legacy credentials',async()=>{await assert.rejects(config().loadAmazonSpApiCredentials(admin({id:'other',extra:[{id:'legacy-integration',owner_id:'owner',external_account_id:'legacy-seller',provider:'amazon'}]}),{...options,integrationAccountId:'legacy-integration'}))});
test('wrong owner cannot use allowlisted integration',async()=>{await assert.rejects(config().loadAmazonSpApiCredentials(admin(),{...options,ownerId:'other-owner'}))});
