import {carrierCancellationResult} from './orderCancellation.ts';
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
 const res=await fetch(url,{method:body===undefined?'GET':'POST',headers:{...headers,Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
 const payload=await res.json().catch(()=>({}));
 if(!res.ok){if(res.status>=400&&res.status<500&&res.status!==408&&res.status!==429)throw new CancellationRejected(`El transportista rechazó la solicitud (${res.status}). ${clean(payload.message||payload.error?.message).slice(0,500)}`);throw new Error(`No se pudo confirmar la respuesta del transportista (${res.status}).`);}
 return payload;
}
export async function cancelCarrier(admin:any,order:any,refresh=false,beforeMutation:()=>Promise<void>=async()=>{}){
 const provider=order.shipping_provider||'sendcloud';const {account,stored}=await cancellationAccount(admin,order,provider);
 if(provider==='sendcloud'){
  const pub=stored.publicKey||stored.public_key||(account.credential_source==='environment'?(Deno.env.get('SENDCLOUD_PUBLIC_KEY')||Deno.env.get('SENDCLOUD_API_KEY')):''),secret=stored.secretKey||stored.secret_key||(account.credential_source==='environment'?(Deno.env.get('SENDCLOUD_SECRET_KEY')||Deno.env.get('SENDCLOUD_API_SECRET')):'');
  if(!pub||!secret||!order.sendcloud_parcel_id)throw new CancellationRejected('Faltan las claves o el identificador de parcela Sendcloud.');
  const headers={Authorization:`Basic ${btoa(`${pub}:${secret}`)}`};const url=`https://panel.sendcloud.sc/api/v2/parcels/${encodeURIComponent(order.sendcloud_parcel_id)}`;
  if(refresh){const payload=await jsonRequest(url,headers);const parcel=payload.parcel||payload;const statuses=await jsonRequest('https://panel.sendcloud.sc/api/v2/parcels/statuses',headers);const confirmed=(Array.isArray(statuses)?statuses:statuses.statuses||[]).some((state:any)=>String(state.id)===String(parcel.status?.id)&&['cancelled','canceled'].includes(clean(state.message).toLowerCase()));return confirmed?{status:'confirmed',message:'Sendcloud confirma la anulación.'}:{status:'pending',message:'Sendcloud todavía no confirma la anulación.'};}
  await beforeMutation();
  const payload=await jsonRequest(`${url}/cancel`,headers,{});
  // Sendcloud's cancelled flag acknowledges the request; parcel state confirms completion.
  if(payload.cancelled===false)throw new CancellationRejected('Sendcloud rechazó la anulación.');
  return {status:'pending',message:'Anulación solicitada a Sendcloud. Comprueba el estado para confirmar su finalización.'};
 }
 if(refresh&&provider==='envia'){
  const token=stored.token||stored.apiToken||stored.api_token;if(!token||!order.tracking_number)throw new Error('Faltan los datos para comprobar Envia.com.');
  const payload=await jsonRequest(`${account.config?.environment==='production'?'https://queries.envia.com':'https://queries.test.envia.com'}/guide/${encodeURIComponent(order.tracking_number)}`,{Authorization:`Bearer ${token}`});
  const raw=Array.isArray(payload.data)?payload.data[0]:payload.data||payload;
  const status=clean(raw?.status?.name||raw?.status?.description||raw?.status||raw?.shipmentStatus||raw?.trackingStatus).toLowerCase();
  return ['cancelled','canceled','cancelado','cancelada'].includes(status)?{status:'confirmed',message:'Envia.com confirma la anulación.'}:{status:'pending',message:'Envia.com todavía no confirma la anulación.'};
 }
 if(refresh)return {status:'unknown',message:'Comprueba la anulación con tu agencia MRW. No se reenviará la solicitud.'};
 if(provider==='envia'){
  const token=stored.token||stored.apiToken||stored.api_token;if(!token||!order.carrier_code||!order.tracking_number)throw new CancellationRejected('Faltan el token, transportista o tracking de Envia.com.');
  await beforeMutation();
  const payload=await jsonRequest(`${account.config?.environment==='production'?'https://api.envia.com':'https://api-test.envia.com'}/ship/cancel/`,{Authorization:`Bearer ${token}`},{carrier:order.carrier_code,trackingNumber:order.tracking_number});
  try{return carrierCancellationResult('envia',payload)}catch(error){throw new CancellationRejected(error instanceof Error?error.message:'Envia.com rechazó la anulación.');}
 }
 if(provider!=='mrw')throw new CancellationRejected('Este proveedor no admite anulación desde ZENVIA.');
 const c={franchise:stored.franchiseCode||stored.codigoFranquicia,subscriber:stored.subscriberCode||stored.codigoAbonado,department:stored.departmentCode||stored.codigoDepartamento,user:stored.username||stored.userName||stored.usuario,password:stored.password};
 const ref=order.shipping_remote_id||order.tracking_number;if(!c.franchise||!c.subscriber||!c.user||!c.password||!ref)throw new CancellationRejected('Faltan las credenciales o el número de envío MRW.');
 const body=`<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Header><AuthInfo xmlns="http://www.mrw.es/"><CodigoFranquicia>${esc(c.franchise)}</CodigoFranquicia><CodigoAbonado>${esc(c.subscriber)}</CodigoAbonado><CodigoDepartamento>${esc(c.department)}</CodigoDepartamento><UserName>${esc(c.user)}</UserName><Password>${esc(c.password)}</Password></AuthInfo></soap:Header><soap:Body><CancelarEnvio xmlns="http://www.mrw.es/"><request><CancelaEnvio><NumeroEnvioOriginal>${esc(ref)}</NumeroEnvioOriginal></CancelaEnvio></request></CancelarEnvio></soap:Body></soap:Envelope>`;
 const environment=account.config?.environment==='test'?'test':'production',gateway=Deno.env.get('MRW_GATEWAY_URL'),key=Deno.env.get('MRW_GATEWAY_SECRET');let xml='';
 await beforeMutation();
 if(gateway&&key){const payload=await jsonRequest(gateway,{'X-Zenvia-Gateway-Key':key},{environment,method:'POST',operation:'CancelarEnvio',soapVersion:'1.1',body});if(Number(payload.status)>=500)throw new Error('MRW no confirmó la respuesta.');xml=payload.bodyBase64?atob(payload.bodyBase64):'';}
 else{const res=await fetch(`https://${environment==='test'?'sagec-test':'sagec'}.mrw.es/mrwenvio.asmx`,{method:'POST',headers:{'Content-Type':'text/xml; charset=utf-8',SOAPAction:'"http://www.mrw.es/CancelarEnvio"'},body,signal:AbortSignal.timeout(25000)});xml=await res.text();if(!res.ok)throw new Error(`MRW no confirmó la respuesta (${res.status}).`);}
 if(/<(?:\w+:)?(?:faultstring|DescripcionError|Mensaje)>[^<]+/i.test(xml))throw new CancellationRejected('MRW rechazó la anulación. Comprueba las condiciones del envío con tu agencia.');
 return /<(?:\w+:)?NumeroEnvio>\s*[^<]+/i.test(xml)?{status:'confirmed',message:'MRW confirmó la anulación del envío.'}:{status:'unknown',message:'MRW no devolvió una confirmación de anulación. Compruébalo con tu agencia.'};
}
