import {parseSendcloudCancellation,parseEnviaCancellation,parseMrwCancellation,type CancellationOutcome} from './carrierCancellationPolicy.ts';
import {pollShipment} from './tracking/adapters.ts';
export class CancellationRejected extends Error {}
const clean=(v:unknown)=>String(v??'').trim();
const esc=(v:unknown)=>clean(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
export async function cancellationAccount(admin:any,order:any,provider:string,source=false){
 const id=source?order.source_integration_account_id:order.shipping_integration_account_id;
 if(!id)throw new CancellationRejected('El pedido no tiene una cuenta de integración asociada.');
 const result=await admin.from('integration_accounts').select('*').eq('id',id).eq('owner_id',order.owner_id).eq('provider',provider).eq('enabled',true).neq('status','disabled').maybeSingle();
 if(result.error)throw result.error;if(!result.data)throw new CancellationRejected('La cuenta de integración está desconectada.');
 let stored:any={};if(result.data.secret_id){const secret=await admin.rpc('integration_read_secret',{p_secret_id:result.data.secret_id});if(secret.error)throw secret.error;stored=JSON.parse(String(secret.data||'{}'));}
 return {account:result.data,stored};
}
async function jsonRequest(url:string,headers:any,body?:any){
 const res=await fetch(url,{method:body===undefined?'GET':'POST',headers:{...headers,Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(25000),redirect:'error'});
 const payload=await res.json().catch(()=>({}));
 if(!res.ok){if(res.status>=400&&res.status<500&&res.status!==408&&res.status!==429)throw new CancellationRejected(`El transportista rechazó la solicitud (${res.status}).`);throw new Error('CARRIER_RESPONSE_UNCONFIRMED');}
 return {payload,status:res.status};
}
const pending=():CancellationOutcome=>({status:'pending',message:'Cancelación solicitada; pendiente de confirmación del transportista.'});
const unknown=():CancellationOutcome=>({status:'unknown',message:'El resultado no está confirmado. Comprueba el estado antes de volver a solicitarlo.'});
function accepted(result:CancellationOutcome){if(result.status==='rejected')throw new CancellationRejected(result.message);return result;}
const phase=(v:unknown)=>clean(v).toLowerCase().replace(/[ -]+/g,'_');
const transported=new Set(['delivered','returned_to_sender','shipment_picked_up_by_driver','parcel_en_route','driver_en_route','being_sorted','at_sorting_centre','en_route_to_sorting_center']);
export async function cancelCarrier(admin:any,order:any,refresh=false,beforeMutation:()=>Promise<void>=async()=>{}){
 const provider=order.shipping_provider||'sendcloud';const {account,stored}=await cancellationAccount(admin,order,provider);
 if(provider==='sendcloud'){
  const pub=stored.publicKey||stored.public_key||(account.credential_source==='environment'?(Deno.env.get('SENDCLOUD_PUBLIC_KEY')||Deno.env.get('SENDCLOUD_API_KEY')):''),secret=stored.secretKey||stored.secret_key||(account.credential_source==='environment'?(Deno.env.get('SENDCLOUD_SECRET_KEY')||Deno.env.get('SENDCLOUD_API_SECRET')):'');
  if(!pub||!secret||!order.sendcloud_parcel_id)throw new CancellationRejected('Faltan las claves o el identificador de parcela Sendcloud.');
  const headers={Authorization:`Basic ${btoa(`${pub}:${secret}`)}`},url=`https://panel.sendcloud.sc/api/v2/parcels/${encodeURIComponent(order.sendcloud_parcel_id)}`;
  const {payload}=await jsonRequest(url,headers),parcel=payload.parcel||payload;
  if(String(parcel.id)!==String(order.sendcloud_parcel_id)||(order.tracking_number&&clean(parcel.tracking_number)!==clean(order.tracking_number)))return unknown();
  const catalog=await jsonRequest('https://panel.sendcloud.sc/api/v2/parcels/statuses',headers);
  const statuses=Array.isArray(catalog.payload)?catalog.payload:catalog.payload.statuses||catalog.payload.parcel_statuses||[];
  const state=phase(statuses.find((item:any)=>String(item.id)===String(parcel.status?.id))?.message);
  if(['cancelled','canceled'].includes(state))return {status:'confirmed',message:'Sendcloud confirma la cancelación.'};
  if(['cancelled_upstream','cancellation_request','submitting_cancellation_request'].includes(state))return pending();
  if(transported.has(state))throw new CancellationRejected('El envío ya está en la red del transportista y no admite esta anulación.');
  if(refresh)return state?pending():unknown();
  const label=parcel.label,announced=clean(label?.label_printer)||(Array.isArray(label?.normal_printer)&&label.normal_printer.some((value:any)=>clean(value)));
  if(!announced||!clean(parcel.tracking_number))throw new CancellationRejected('Sendcloud no confirma una etiqueta anunciada. No se enviará una solicitud que pueda borrar la parcela.');
  await beforeMutation();const result=await jsonRequest(`${url}/cancel`,headers,{});return accepted(parseSendcloudCancellation(result.status,result.payload));
 }
 if(provider==='envia'){
  const token=stored.token||stored.apiToken||stored.api_token;if(!token||!order.carrier_code||!order.tracking_number)throw new CancellationRejected('Faltan el token, transportista o tracking de Envia.com.');
  if(refresh){const movement=await pollShipment({...account,provider},stored,order.tracking_number);return movement.state==='cancelled'?{status:'confirmed',message:'Envia.com confirma la cancelación.'}:movement.state?pending():unknown();}
  await beforeMutation();const result=await jsonRequest(`${account.config?.environment==='production'?'https://api.envia.com':'https://api-test.envia.com'}/ship/cancel/`,{Authorization:`Bearer ${token}`},{carrier:order.carrier_code,trackingNumber:order.tracking_number});
  return accepted(parseEnviaCancellation(result.payload,order.tracking_number,order.carrier_code));
 }
 if(provider!=='mrw')throw new CancellationRejected('Este proveedor no admite anulación desde ZENVIA.');
 const c={franchise:stored.franchiseCode||stored.codigoFranquicia,subscriber:stored.subscriberCode||stored.codigoAbonado,department:stored.departmentCode||stored.codigoDepartamento,user:stored.username||stored.userName||stored.usuario,password:stored.password};
 const ref=order.shipping_remote_id||order.tracking_number;if(!c.franchise||!c.subscriber||!c.user||!c.password||!ref)throw new CancellationRejected('Faltan las credenciales o el número de envío MRW.');
 if(refresh){const movement=await pollShipment({...account,provider},stored,ref);return movement.state==='cancelled'?{status:'confirmed',message:'MRW confirma la cancelación.'}:movement.state?pending():unknown();}
 const body=`<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Header><AuthInfo xmlns="http://www.mrw.es/"><CodigoFranquicia>${esc(c.franchise)}</CodigoFranquicia><CodigoAbonado>${esc(c.subscriber)}</CodigoAbonado><CodigoDepartamento>${esc(c.department)}</CodigoDepartamento><UserName>${esc(c.user)}</UserName><Password>${esc(c.password)}</Password></AuthInfo></soap:Header><soap:Body><CancelarEnvio xmlns="http://www.mrw.es/"><request><CancelaEnvio><NumeroEnvioOriginal>${esc(ref)}</NumeroEnvioOriginal></CancelaEnvio></request></CancelarEnvio></soap:Body></soap:Envelope>`;
 const environment=account.config?.environment==='test'?'test':'production',gateway=Deno.env.get('MRW_GATEWAY_URL'),key=Deno.env.get('MRW_GATEWAY_SECRET');let xml='',status=200;
 await beforeMutation();
 if(gateway&&key){const result=await jsonRequest(gateway,{'X-Zenvia-Gateway-Key':key},{environment,method:'POST',operation:'CancelarEnvio',soapVersion:'1.1',body});status=Number(result.payload.status)||500;try{xml=result.payload.bodyBase64?atob(result.payload.bodyBase64):''}catch{return unknown()}}
 else{const res=await fetch(`https://${environment==='test'?'sagec-test':'sagec'}.mrw.es/mrwenvio.asmx`,{method:'POST',headers:{'Content-Type':'text/xml; charset=utf-8',SOAPAction:'"http://www.mrw.es/CancelarEnvio"'},body,signal:AbortSignal.timeout(25000),redirect:'error'});status=res.status;xml=await res.text();}
 const result=parseMrwCancellation(xml,ref);if(result.status==='rejected')return accepted(result);if(status<200||status>=300)return unknown();return result;
}
