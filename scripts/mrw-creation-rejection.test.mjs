import {loadOrderWeightFixture} from './order-weight-fixture.mjs';
import {assertMfaWithClient} from './mfa-edge-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync('supabase/functions/mrw-shipping/index.ts','utf8').replace(/^import .*\n/gm,'');
const creation=fs.readFileSync('supabase/functions/_shared/shippingCreation.ts','utf8').replace(/^export /gm,'');
const eligibility=fs.readFileSync('supabase/functions/_shared/amazonShippingEligibility.ts','utf8').replaceAll('export function','function');
const piiRead=fs.readFileSync('supabase/functions/_shared/amazonPiiRead.ts','utf8').replaceAll('export async function','async function');
for(const mode of ['rejected','timeout','missing_number','http_error','soap_server'])test('MRW '+mode+' keeps safe retry state',async()=>{
 const order={source_channel:'amazon',source_status:'Shipped',tracking_status_code:'CANCELLED',label_cancelled_at:'2026-10-22T10:00:00Z',id:'o',owner_id:'owner',order_number:'ref',shipping_address:{name:'Name',address_line_1:'Street',postal_code:'28026',city:'Madrid'},raw_payload:{shipping_details:{measurement:{weight:{value:2.3,unit:'kg'}}}}};
 const account={id:'account',secret_id:'secret',config:{serviceCode:'0200'}};
 let handler,transmits=0,labels=0,transmittedBody;
 const admin={auth:{getUser:async()=>({data:{user:{id:'user'}}})},rpc:async(name,args)=>name==='shipping_creation_begin'?(Object.assign(order,{tracking_status_code:'MRW_CREATING'}),{data:'10000000-0000-0000-0000-000000000001',error:null}):name==='shipping_creation_note'?(args.p_result==='rejected'&&Object.assign(order,{tracking_status_code:null}),{data:null,error:null}):name==='security_mfa_assert'?{data:null,error:null}:name==='integration_claim_order_shipping'?{data:true,error:null}:name==='amazon_pii_claim_external_read'?{data:'claimed',error:null}:({data:JSON.stringify({franchiseCode:'f',subscriberCode:'s',username:'u',password:'p'})}),from(table){
  let patch=null,hasRemote=false;
  const q={select(){return q},eq(){return q},neq(){return q},order(){return q},limit(){return q},is(){return q},or(){return q},not(){hasRemote=true;return q},update(p){patch=p;return q},async maybeSingle(){
   if(patch){Object.assign(order,patch);return {data:{...order},error:null}}
   return {data:table==='app_users'?{active:true,role:'admin',data_owner_id:'owner'}:table==='integration_accounts'?account:table==='fulfillment_orders'?(hasRemote?null:{...order}):table==='app_settings'?{config:{shipping:{packageLengthCm:35,packageWidthCm:45,packageHeightCm:5}}}:{address_line1:'Origin',postal_code:'11660',city:'Prado'},error:null};
  },then(resolve,reject){return q.maybeSingle().then(resolve,reject)}};return q;
 }};
 const fetch=async(url,request)=>{
  transmits++;
  transmittedBody=request.body;
  if(mode==='timeout')throw new TypeError('Network unavailable');
  if(mode==='http_error')return new Response('<html>Upstream error</html>',{status:500});
  if(mode==='soap_server')return new Response('<soap:Fault><faultcode>soap:Server</faultcode><faultstring>campo no es válido</faultstring><detail><Estado>0</Estado></detail></soap:Fault>',{status:500});
  if(mode==='missing_number')return new Response('<Result><Estado>1</Estado></Result>');
  return new Response('<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><TransmEnvioResponse xmlns="http://www.mrw.es/"><TransmEnvioResult><Estado>0</Estado><Message>El código de tipo de Mercancía no es válido. Códigos permitidos DOC,IMP,MCV,MSV,ATV,BJV,MUE</Message></TransmEnvioResult></TransmEnvioResponse></soap:Body></soap:Envelope>');
 };
 vm.runInNewContext(ts.transpile(creation+'\n'+piiRead+'\n'+eligibility+'\n'+source,{target:ts.ScriptTarget.ES2022}),{resolveOrderPackageWeight:loadOrderWeightFixture().resolveOrderPackageWeight,assertQuotedPackageWeight:loadOrderWeightFixture().assertQuotedPackageWeight,assertHumanMfa:(req,recent)=>assertMfaWithClient(req,recent,()=>admin),createClient:()=>admin,Deno:{env:{get:n=>n==='SUPABASE_URL'?'https://db':n==='SUPABASE_SERVICE_ROLE_KEY'?'key':''},serve:fn=>handler=fn},Response,Request,fetch,atob,TextEncoder,console,crypto:globalThis.crypto});
 const req=()=>new Request('https://function',{method:'POST',headers:{Authorization:'Bearer user'},body:JSON.stringify({action:'create_label',orderId:'o'})});
 const result=await handler(req());
 assert.equal(result.status,500);
 assert.equal(transmits,1);
 assert.match(transmittedBody,/<TipoMercancia>MCV<\/TipoMercancia>/);
 assert.equal(order.shipping_remote_id,undefined);
 assert.equal(order.tracking_status_code,mode==='rejected'?null:'MRW_CREATING');
});
