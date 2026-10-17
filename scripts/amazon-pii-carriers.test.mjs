import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

for(const slug of ['mrw-shipping','envia-shipping','sendcloud-orders','sendcloud-order-tools','order-logistics-state'])for(const action of ['create_label','fetch_label','update_order','validate_address']){
 test(`${slug} refuses ${action} on a purged order before external transport calls`,async()=>{
  let handler,calls=0;
  const row={id:'order',owner_id:'owner',source_channel:'amazon',source_status:'Unshipped',pii_purged_at:'2026-01-01T00:00:00Z',shipping_address:{},raw_payload:{},items:[]};
  const admin={auth:{getUser:async()=>({data:{user:{id:'user'}}})},rpc:async()=>({data:JSON.stringify({franchiseCode:'1',subscriberCode:'1',username:'test',password:'synthetic'})}),from(table){const q={select(){return q},eq(){return q},neq(){return q},order(){return q},limit(){return q},async maybeSingle(){return {data:table==='fulfillment_orders'?row:table==='app_users'?{user_id:'user',data_owner_id:'owner',active:true,role:'admin',permissions:[]}:table==='workspaces'?{status:'active'}:table==='app_settings'?{config:{}}:{id:'account',secret_id:'secret',enabled:true,config:{serviceCode:'1'}},error:null}}};return q}};
  const exp={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../supabase/functions/${slug}/index.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{
   exports:exp,require:name=>name.startsWith('npm:')?{createClient:()=>admin}:{assertAmazonOrderShippable:()=>{}},
   Deno:{env:{get:name=>name==='SUPABASE_URL'?'https://synthetic.test/':'synthetic'},serve:f=>{handler=f}},
   fetch:async()=>{calls++;throw Error('External transport must never be called')},Request,Response,Headers,URL,URLSearchParams,console,Uint8Array,TextEncoder,TextDecoder,AbortSignal,setTimeout,clearTimeout,btoa,atob
  });
  const res=await handler(new Request('https://synthetic.test/',{method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify({action,orderId:'order'})}));
  assert.equal(res.status,410,await res.text());assert.equal(calls,0);
 });
}
