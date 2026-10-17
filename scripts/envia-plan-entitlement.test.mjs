import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

test('Envia plan entitlement is independent from Sendcloud when creating or reactivating accounts',async()=>{
 const previousDeno=globalThis.Deno,previousAdmin=globalThis.__enviaPlanAdmin;
 let handler;
 globalThis.Deno={env:{get:key=>key==='SUPABASE_URL'?'https://example.supabase.co':key==='SUPABASE_SERVICE_ROLE_KEY'?'test-key':undefined},serve:fn=>{handler=fn;}};
 const queried=[];
 const entitlements={'integration.envia':{enabled:false},'integration.sendcloud':{enabled:true}};
 globalThis.__enviaPlanAdmin={auth:{getUser:async()=>({data:{user:{id:'user'}}})},from:table=>{
   queried.push(table);
   const data={app_users:{user_id:'user',data_owner_id:'workspace',role:'admin',active:true},workspaces:{status:'active'},app_subscription_state:{status:'active',entitlements},integration_accounts:{id:'account',owner_id:'workspace',provider:'envia',enabled:false,config:{}}}[table];
   const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data,error:null}),single:async()=>({data,error:null})};return query;
 }};
 try{
   const output=await build({entryPoints:['supabase/functions/integration-accounts/index.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'test-client',setup(b){b.onResolve({filter:/^npm:/},()=>({path:'client',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const createClient=()=>globalThis.__enviaPlanAdmin;'}));}}]});
   await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
   for(const body of [{action:'create',provider:'envia'},{action:'update',id:'account',enabled:true}]){
     const response=await handler(new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify(body)}));
     const result=await response.json();
     assert.match(result.error,/Tu plan no incluye la integración con Envia.com/,body.action);
     assert.equal(response.ok,false);
   }
   assert.ok(queried.includes('app_subscription_state'));
   entitlements['integration.envia'].enabled=true;
   entitlements['integration.sendcloud'].enabled=false;
   const allowed=await handler(new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({action:'create',provider:'envia'})}));
   assert.equal((await allowed.json()).error,'Indica el token API de Envia.com.');
 }finally{globalThis.Deno=previousDeno;globalThis.__enviaPlanAdmin=previousAdmin;}
});
