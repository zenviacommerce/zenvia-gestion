import {normalizeStatus} from './tracking/policy.ts';
import {xmlTree,descendants,value,MRW_TRACKING_ENDPOINT} from './tracking/adapters.ts';
export type CreationAttempt={id:string;ownerId?:string;orderId?:string;accountId:string;provider:string;reference:string;startedAt:string;context:Record<string,any>};
export type RecoveredShipment={remoteId:string;trackingNumber:string;parcelId?:number;shipmentId?:string;labelUrl?:string;trackingUrl?:string|null};
export type ReferenceResult={status:'absent'}|{status:'found';shipment:RecoveredShipment};
const clean=(v:unknown)=>typeof v==='string'||typeof v==='number'?String(v).trim():'';
const esc=(v:unknown)=>clean(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const lookupStart=(a:CreationAttempt)=>a.context?.legacy===true&&typeof a.context.lookupStartedAt==='string'?a.context.lookupStartedAt:a.startedAt;
const madridDate=(date:Date)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Madrid',day:'2-digit',month:'2-digit',year:'numeric'}).format(date);
const excluded=(attempt:CreationAttempt)=>new Set<string>(Array.isArray(attempt.context?.excludedIdentities)?attempt.context.excludedIdentities.filter((s:unknown)=>typeof s==='string'):[]);
export function buildMrwReferenceEnvelope(credentials:any,attempt:CreationAttempt,now=new Date()):string{
 const login=clean(credentials.username||credentials.userName||credentials.usuario),pass=clean(credentials.password);
 if(!login||!pass)throw Error('CREATION_LOOKUP_CREDENTIALS');
 const started=new Date(lookupStart(attempt));if(!Number.isFinite(started.getTime())||started>now)throw Error('CREATION_LOOKUP_DATE');
 const params={login,pass,codigoIdioma:'3082',tipoFiltro:'1',valorFiltroDesde:attempt.reference,valorFiltroHasta:attempt.reference,fechaDesde:madridDate(started),fechaHasta:madridDate(now),tipoInformacion:'1',codigoAbonado:credentials.subscriberCode||credentials.codigoAbonado,codigoFranquicia:credentials.franchiseCode||credentials.codigoFranquicia};
 return '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetEnvios xmlns="http://tempuri.org/">'+Object.entries(params).map(([key,v])=>`<${key}>${esc(v)}</${key}>`).join('')+'</GetEnvios></soap:Body></soap:Envelope>';
}
export function parseMrwReference(xml:string,reference:string,exclude:string[]=[],startedAt?:string):ReferenceResult{
 const tree=xmlTree(xml);if(descendants(tree,'Fault').length)throw Error('CREATION_LOOKUP_REJECTED');
 const results=descendants(tree,'GetEnviosResult');if(results.length!==1)throw Error('CREATION_LOOKUP_INVALID');
 const result=results[0],notice=value(result,'MensajeSeguimiento').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
 if(!/^Busqueda correcta por Referencia de Envio\.?$/i.test(notice))throw Error('CREATION_LOOKUP_REJECTED');
 if(!result.children.some(row=>row.name==='Seguimiento'))throw Error('CREATION_LOOKUP_INVALID');
 const rows=descendants(result,'Seguimiento').filter(row=>!row.children.some(child=>child.name==='Seguimiento'));
 const numbers=new Set<string>();
 for(const row of rows){
  const number=value(row,'NumAlbaran'),ref=value(row,'Referencia');
  if(!number){if(row.children.length||row.text.trim())throw Error('CREATION_LOOKUP_INVALID');continue;}
  if(ref&&ref!==reference)throw Error('CREATION_LOOKUP_REFERENCE_MISMATCH');
  if(!ref)throw Error('CREATION_LOOKUP_REFERENCE_MISSING');
  if(!/^[A-Za-z0-9-]{4,200}$/.test(number))throw Error('CREATION_LOOKUP_INVALID');
  if(exclude.includes(number))continue;
  if(/anulad|cancelad|cancelled|canceled/i.test(value(row,'EstadoDescripcion')))throw Error('CREATION_LOOKUP_CANCELLED');
  if(startedAt){const published=value(row,'Publicado');if(!/(Z|[+-]\d{2}:?\d{2})$/i.test(published)||!Number.isFinite(Date.parse(published))||Date.parse(published)<Date.parse(startedAt)-120000)throw Error('CREATION_LOOKUP_OLD_OR_UNDATED');}
  numbers.add(number);
 }
 if(numbers.size>1)throw Error('CREATION_REFERENCE_AMBIGUOUS');
 const number=[...numbers][0];return number?{status:'found',shipment:{remoteId:number,trackingNumber:number}}:{status:'absent'};
}
function urlOrNull(v:unknown):string|null{
 const text=clean(v);if(!text)return null;try{const url=new URL(text);if(url.protocol==='https:'&&!url.username&&!url.password)return url.href}catch{/* fail closed below */}throw Error('CREATION_LOOKUP_INVALID_URL');
}
const hasProviderErrors=(v:any)=>Boolean(v?.error||v?.success===false||(Array.isArray(v?.errors)?v.errors.length:v?.errors&&Object.keys(v.errors).length));
async function readResponse(res:Response):Promise<any>{
 if(!res.ok)throw Error('CREATION_LOOKUP_HTTP');
 const text=await res.text();if(text.length>8000000)throw Error('CREATION_LOOKUP_TOO_LARGE');
 let payload:any;try{payload=JSON.parse(text)}catch{throw Error('CREATION_LOOKUP_INVALID_JSON')}
 if(hasProviderErrors(payload))throw Error('CREATION_LOOKUP_REJECTED');return payload;
}
function nextLink(res:Response,payload:any,base:string,pathPrefix:string):string|null{
 const link=res.headers.get('Link')||'',header=link.match(/<([^>]+)>\s*;\s*rel="?next"?/i)?.[1];
 const raw=header||payload?.links?.next||payload?.next||payload?.meta?.next_page_url||null;
 const meta=payload?.meta||payload?.pagination||{};
 if(!raw&&(Number(meta.last_page||meta.total_pages||1)>Number(meta.current_page||meta.page||1)||meta.has_more===true))throw Error('CREATION_LOOKUP_PAGINATION');
 if(!raw)return null;
 if(typeof raw!=='string')throw Error('CREATION_LOOKUP_PAGINATION');
 const target=new URL(raw,base),expected=new URL(base);
 if(target.origin!==expected.origin||!target.pathname.startsWith(pathPrefix)||target.username||target.password)throw Error('CREATION_LOOKUP_PAGINATION');
 return target.href;
}
function freshCreated(raw:unknown,attempt:CreationAttempt,envia=false){
 const text=clean(raw),civil=/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text);
 const at=Date.parse(envia&&civil?text.replace(' ','T')+'-06:00':text);
 if(!Number.isFinite(at)||at<Date.parse(lookupStart(attempt))-120000)throw Error('CREATION_LOOKUP_OLD_OR_UNDATED');
}
function unique(matches:RecoveredShipment[]):ReferenceResult{
 const dedup=new Map(matches.map(m=>[m.parcelId||m.remoteId,m]));if(dedup.size>1)throw Error('CREATION_REFERENCE_AMBIGUOUS');return dedup.size?{status:'found',shipment:[...dedup.values()][0]}:{status:'absent'};
}
export async function lookupCarrierReference(attempt:CreationAttempt,account:any,credentials:any,request:typeof fetch=fetch,now=new Date()):Promise<ReferenceResult>{
 if(!attempt.reference||account.provider!==attempt.provider)throw Error('CREATION_LOOKUP_ACCOUNT_MISMATCH');
 const old=excluded(attempt);
 if(attempt.provider==='mrw'){
  if(account.config?.environment==='test')throw Error('CREATION_LOOKUP_ENVIRONMENT_UNSUPPORTED');
  const body=buildMrwReferenceEnvelope(credentials,attempt,now);
  const res=await request(MRW_TRACKING_ENDPOINT,{method:'POST',headers:{'Content-Type':'text/xml; charset=utf-8',SOAPAction:'"http://tempuri.org/ITrackingService/GetEnvios"'},body,signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!res.ok)throw Error('CREATION_LOOKUP_HTTP');return parseMrwReference(await res.text(),attempt.reference,[...old],lookupStart(attempt));
 }
 if(attempt.provider==='sendcloud'){
  const publicKey=clean(credentials.publicKey||credentials.public_key),secretKey=clean(credentials.secretKey||credentials.secret_key);if(!publicKey||!secretKey)throw Error('CREATION_LOOKUP_CREDENTIALS');
  const base='https://panel.sendcloud.sc/api/v3/shipments',url=new URL(base);url.searchParams.set('order_number',attempt.reference);
  if(attempt.context.integrationId)url.searchParams.set('integration_id',clean(attempt.context.integrationId));
  let next:string|null=url.href;const seen=new Set<string>(),matches:RecoveredShipment[]=[];
  while(next){
   if(seen.has(next)||seen.size>=5)throw Error('CREATION_LOOKUP_PAGINATION');seen.add(next);
   const res=await request(next,{method:'GET',headers:{Authorization:`Basic ${btoa(publicKey+':'+secretKey)}`,Accept:'application/json'},signal:AbortSignal.timeout(8000),redirect:'error'}),payload=await readResponse(res);
   if(!Array.isArray(payload?.data))throw Error('CREATION_LOOKUP_INVALID_JSON');
   for(const shipment of payload.data){
    if(hasProviderErrors(shipment))throw Error('CREATION_LOOKUP_REJECTED');
    if(clean(shipment.order_number)!==attempt.reference)throw Error('CREATION_LOOKUP_REFERENCE_MISMATCH');
    if(shipment.integration_id!=null&&attempt.context.integrationId&&clean(shipment.integration_id)!==clean(attempt.context.integrationId))throw Error('CREATION_LOOKUP_ACCOUNT_MISMATCH');
    if(!Array.isArray(shipment.parcels)||!shipment.parcels.length)throw Error('CREATION_LOOKUP_NOT_ANNOUNCED');
    for(const parcel of shipment.parcels){
     if(hasProviderErrors(parcel))throw Error('CREATION_LOOKUP_REJECTED');
     const id=Number(parcel.id),number=clean(parcel.tracking_number);
     if(old.has(String(id))||old.has(number)||old.has(clean(shipment.id)))continue;
     if(['CANCELLED','CANCELED'].includes(clean(parcel.status?.code).toUpperCase()))throw Error('CREATION_LOOKUP_CANCELLED');
     if(!Number.isSafeInteger(id)||id<=0||!number||!clean(shipment.id))throw Error('CREATION_LOOKUP_NOT_ANNOUNCED');
     freshCreated(parcel.created_at,attempt);
     matches.push({remoteId:clean(shipment.id),shipmentId:clean(shipment.id),parcelId:id,trackingNumber:number,trackingUrl:urlOrNull(parcel.tracking_url)});
    }
   }
   next=nextLink(res,payload,base,'/api/v3/shipments');
  }
  return unique(matches);
 }
 if(attempt.provider==='envia'){
  const token=clean(credentials.token||credentials.apiToken||credentials.api_token);if(!token)throw Error('CREATION_LOOKUP_CREDENTIALS');
  const base=account.config?.environment==='production'?'https://queries.envia.com':'https://queries.test.envia.com';
  const period=(d:Date)=>{const wall=new Date(d.getTime()-21600000);return `${String(wall.getUTCMonth()+1).padStart(2,'0')}/${wall.getUTCFullYear()}`};
  const start=new Date(lookupStart(attempt));if(!Number.isFinite(start.getTime())||start>now||now.getTime()-start.getTime()>28*86400000)throw Error('CREATION_LOOKUP_DATE');
  const months=[...new Set([period(start),period(now)])],matches:RecoveredShipment[]=[];
  const get=async(url:string)=>{const res=await request(url,{method:'GET',headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(8000),redirect:'error'});return {res,payload:await readResponse(res)}};
  for(const month of months){
   let next:string|null=base+'/guide/'+month;const seen=new Set<string>();
   while(next){
    if(seen.has(next)||seen.size>=5)throw Error('CREATION_LOOKUP_PAGINATION');seen.add(next);
    const {res,payload}=await get(next);
    if(payload?.meta==='error'||payload?.error)throw Error('CREATION_LOOKUP_REJECTED');
    const rows=Array.isArray(payload)?payload:Array.isArray(payload?.data)?payload.data:Array.isArray(payload?.guides)?payload.guides:null;
    if(!rows)throw Error('CREATION_LOOKUP_INVALID_JSON');
    for(const row of rows){
     const ref=clean(row.orderReference||row.order_reference||row.reference||row.referenceNumber||row.orderNumber||row.order_number||row.shipment?.orderReference||row.shipment?.reference);
     if(!ref)throw Error('CREATION_LOOKUP_REFERENCE_MISSING');
     if(ref!==attempt.reference)continue;
     const number=clean(row.tracking_number||row.trackingNumber||row.tracking||row.guideNumber||row.guide);
     if(old.has(number))continue;if(!number)throw Error('CREATION_LOOKUP_INVALID');
     freshCreated(row.created_at||row.createdAt||row.creationDate||row.dateCreated,attempt,true);
     const {payload:detail}=await get(base+'/guide/'+encodeURIComponent(number));
     if(detail?.meta==='error'||detail?.error)throw Error('CREATION_LOOKUP_REJECTED');
     const d=Array.isArray(detail?.data)?detail.data[0]:detail?.data||detail;
     const detailNumber=clean(d?.tracking_number||d?.trackingNumber||d?.tracking||d?.guideNumber||d?.guide);
     if(detailNumber!==number)throw Error('CREATION_LOOKUP_REFERENCE_MISMATCH');
     if(normalizeStatus('envia',d.status?.code??d.status)==='cancelled'||/anulad|cancelad|cancelled|canceled/i.test(clean(d.status?.code??d.status)))throw Error('CREATION_LOOKUP_CANCELLED');
     const label=urlOrNull(d.label||d.labelUrl||d.label_url||d.label_file);if(!label)throw Error('CREATION_LOOKUP_LABEL_PENDING');
     matches.push({remoteId:number,trackingNumber:number,labelUrl:label,trackingUrl:urlOrNull(d.trackUrl||d.trackingUrl||d.tracking_url)});
    }
    next=nextLink(res,payload,base,'/guide/');
   }
  }
  return unique(matches);
 }
 throw Error('CREATION_LOOKUP_PROVIDER_UNSUPPORTED');
}
