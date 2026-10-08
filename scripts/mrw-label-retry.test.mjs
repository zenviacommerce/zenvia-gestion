import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync('supabase/functions/mrw-shipping/index.ts','utf8').replace(/^import .*\n/gm,'');
test('PDF failure preserves shipment and retry never transmits a second shipment',async()=>{
 const order={id:'o',owner_id:'owner',order_number:'ref',shipping_address:{name:'Name',address_line_1:'Street',postal_code:'28026',city:'Madrid'},raw_payload:{shipping_details:{measurement:{weight:{value:2.3,unit:'kg'}}}}};
 const account={id:'account',secret_id:'secret',config:{serviceCode:'0200'}};
 let handler,transmits=0,labels=0;
 const admin={auth:{getUser:async()=>({data:{user:{id:'user'}}})},rpc:async(name)=>name==='integration_claim_order_shipping'?{data:true}:({data:JSON.stringify({franchiseCode:'f',subscriberCode:'s',username:'u',password:'p'})}),from(table){
  let patch=null,hasRemote=false;
  const q={select(){return q},eq(){return q},neq(){return q},order(){return q},limit(){return q},is(){return q},in(){return q},or(){return q},not(){hasRemote=true;return q},update(p){patch=p;return q},single(){return q.maybeSingle()},async maybeSingle(){
   if(patch){Object.assign(order,patch);return {data:{...order},error:null}}
   return {data:table==='app_users'?{active:true,role:'admin',data_owner_id:'owner'}:table==='integration_accounts'?account:table==='fulfillment_orders'?(hasRemote?null:{...order}):table==='app_settings'?{config:{shipping:{packageLengthCm:35,packageWidthCm:45,packageHeightCm:5}}}:{address_line1:'Origin',postal_code:'11660',city:'Prado'},error:null};
  },then(resolve,reject){return q.maybeSingle().then(resolve,reject)}};return q;
 }};
 const fetch=async(url,request)=>{
  if(request.body.includes('<TransmEnvio ')){transmits++;return new Response('<Result><Estado>1</Estado><NumeroEnvio>SHIP</NumeroEnvio></Result>')}
  labels++;assert.equal(order.shipping_remote_id,'SHIP','shipment must be saved before label request');
  if(labels===1)return new Response('<Result><Estado>0</Estado><Mensaje>Label unavailable</Mensaje></Result>');
  assert.match(request.body,/<TipoEtiquetaEnvio>0<\/TipoEtiquetaEnvio>/);
  return new Response('<Result><Estado>1</Estado><Mensaje>Warning</Mensaje><EtiquetaFile>JVBERi0=</EtiquetaFile></Result>');
 };
 const guards=vm.runInNewContext(ts.transpile(fs.readFileSync('supabase/functions/_shared/orderCancellation.ts','utf8').replaceAll('export ',''),{target:ts.ScriptTarget.ES2022})+'\n({claimOrderShipping,releaseOrderShipping,assertNoCancellation})',{crypto});
 vm.runInNewContext(ts.transpile(source,{target:ts.ScriptTarget.ES2022}),{...guards,createClient:()=>admin,Deno:{env:{get:n=>n==='SUPABASE_URL'?'https://db':n==='SUPABASE_SERVICE_ROLE_KEY'?'key':''},serve:fn=>handler=fn},Response,Request,fetch,atob,console});
 const req=()=>new Request('https://function',{method:'POST',headers:{Authorization:'Bearer user'},body:JSON.stringify({action:'create_label',orderId:'o'})});
 assert.equal((await handler(req())).status,500);
 assert.equal(order.shipping_remote_id,'SHIP');
 const retry=await handler(req());assert.equal(retry.status,200);assert.equal((await retry.json()).shipmentId,'SHIP');assert.equal(transmits,1);
});
