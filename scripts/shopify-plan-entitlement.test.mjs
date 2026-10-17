import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

test('Shopify connection paths reject a disabled plan before credentials or network access',async()=>{
 const previousDeno=globalThis.Deno,previousAdmin=globalThis.__shopifyPlanAdmin;
 let handler;
 globalThis.Deno={env:{get:key=>key==='SUPABASE_URL'?'https://example.supabase.co':key==='SUPABASE_SERVICE_ROLE_KEY'?'test-key':undefined},serve:fn=>{handler=fn;}};
 const queried=[];
 globalThis.__shopifyPlanAdmin={auth:{getUser:async()=>({data:{user:{id:'user'}}})},from:table=>{
   queried.push(table);
   const data={app_users:{user_id:'user',data_owner_id:'workspace',role:'admin',active:true},workspaces:{status:'active'},app_subscription_state:{status:'active',entitlements:{'integration.shopify':{enabled:false}}},integration_accounts:{id:'account',owner_id:'workspace',provider:'shopify',enabled:false,config:{}}}[table];
   const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data,error:null}),single:async()=>({data,error:null})};return query;
 }};
 try{
   const output=await build({entryPoints:['supabase/functions/integration-accounts/index.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'test-client',setup(b){b.onResolve({filter:/^npm:/},()=>({path:'client',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const createClient=()=>globalThis.__shopifyPlanAdmin;'}));}}]});
   await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
   for(const body of [{action:'shopify_oauth_start'},{action:'shopify_install_connect'},{action:'shopify_client_connect'},{action:'create',provider:'shopify'},{action:'update',id:'account',enabled:true}]){
     const response=await handler(new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify(body)}));
     const result=await response.json();
     assert.match(result.error,/Tu plan no incluye la integración con Shopify/,body.action);
     assert.equal(response.ok,false);
   }
   assert.ok(queried.includes('app_subscription_state'));
 }finally{globalThis.Deno=previousDeno;globalThis.__shopifyPlanAdmin=previousAdmin;}
});
