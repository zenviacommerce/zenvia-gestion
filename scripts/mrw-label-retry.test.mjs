import {loadOrderWeightFixture} from './order-weight-fixture.mjs';
import {assertMfaWithClient} from './mfa-edge-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync('supabase/functions/mrw-shipping/index.ts','utf8').replace(/^import .*\n/gm,'');
const eligibility=fs.readFileSync('supabase/functions/_shared/amazonShippingEligibility.ts','utf8').replaceAll('export function','function');
const piiRead=fs.readFileSync('supabase/functions/_shared/amazonPiiRead.ts','utf8').replaceAll('export async function','async function');
test('PDF failure preserves shipment and retry never transmits a second shipment',async()=>{
 const order={source_channel:'amazon',source_status:'Shipped',tracking_status_code:'CANCELLED',label_cancelled_at:'2026-10-22T10:00:00Z',id:'o',owner_id:'owner',order_number:'ref',shipping_address:{name:'Name',address_line_1:'Street',postal_code:'28026',city:'Madrid'},raw_payload:{shipping_details:{measurement:{weight:{value:2.3,unit:'kg'}}}}};
 const account={id:'account',secret_id:'secret',config:{serviceCode:'0200'}};
 let handler,transmits=0,labels=0;
 const admin={auth:{getUser:async()=>({data:{user:{id:'user'}}})},rpc:async(name)=>name==='security_mfa_assert'?{data:null,error:null}:name==='integration_claim_order_shipping'?{data:true,error:null}:name==='amazon_pii_claim_external_read'?{data:'claimed',error:null}:({data:JSON.stringify({franchiseCode:'f',subscriberCode:'s',username:'u',password:'p'})}),from(table){
  let patch=null,hasRemote=false;
  const q={select(){return q},eq(){return q},neq(){return q},order(){return q},limit(){return q},is(){return q},or(){return q},not(){hasRemote=true;return q},update(p){patch=p;return q},async maybeSingle(){
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
 vm.runInNewContext(ts.transpile(piiRead+'\n'+eligibility+'\n'+source,{target:ts.ScriptTarget.ES2022}),{resolveOrderPackageWeight:loadOrderWeightFixture().resolveOrderPackageWeight,assertQuotedPackageWeight:loadOrderWeightFixture().assertQuotedPackageWeight,assertHumanMfa:(req,recent)=>assertMfaWithClient(req,recent,()=>admin),createClient:()=>admin,Deno:{env:{get:n=>n==='SUPABASE_URL'?'https://db':n==='SUPABASE_SERVICE_ROLE_KEY'?'key':''},serve:fn=>handler=fn},Response,Request,fetch,atob,console,crypto:globalThis.crypto});
 const req=()=>new Request('https://function',{method:'POST',headers:{Authorization:'Bearer user'},body:JSON.stringify({action:'create_label',orderId:'o'})});
 assert.equal((await handler(req())).status,500);
 assert.equal(order.shipping_remote_id,'SHIP');assert.equal(order.label_cancelled_at,null,'replacement must poll even when its PDF initially fails');assert.ok(order.label_created_at,'persist the accepted shipment date before downloading its PDF');
 const retry=await handler(req());assert.equal(retry.status,200);assert.equal((await retry.json()).shipmentId,'SHIP');assert.equal(transmits,1);
});
