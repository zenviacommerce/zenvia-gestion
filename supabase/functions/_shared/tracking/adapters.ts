import {normalizeStatus,type Movement} from './policy.ts';
const clean=(v:unknown)=>typeof v==='string'||typeof v==='number'?String(v).trim():'';
const dated=(v:unknown)=>typeof v==='string'&&/(Z|[+-]\d{2}:?\d{2})$/i.test(v)&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
export function parseSendcloud(payload:any):Movement{
 const p=payload?.data||payload;
 const events=(Array.isArray(p?.events)?p.events:[]).filter((e:any)=>e.event_type==='carrier');
 events.sort((a:any,b:any)=>(Date.parse(b.event_at)||0)-(Date.parse(a.event_at)||0));
 const e=events[0];if(!e)throw Error('TRACKING_NO_CARRIER_EVENTS');
 return {state:normalizeStatus('sendcloud',e.phase,e.exception,e.event_type),code:[e.phase,e.exception,e.sub_status].map(clean).filter(Boolean).join(':'),message:clean(e.description).slice(0,500),eventAt:dated(e.event_at)};
}
export function parseEnvia(payload:any,tracking:string):Movement{
 const source=payload?.data??payload;
 const rows=Array.isArray(source)?source:Array.isArray(source?.shipments)?source.shipments:[source];
 const row=rows.find((r:any)=>clean(r?.trackingNumber||r?.tracking_number||r?.tracking||r?.guide)===tracking);
 if(!row)throw Error('TRACKING_RESPONSE_MISMATCH');
 const history=Array.isArray(row.eventHistory)?row.eventHistory:Array.isArray(row.history)?row.history:Array.isArray(row.events)?row.events:Array.isArray(row.trackingHistory)?row.trackingHistory:[];
 const civil=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(v)?v.replace('T',' '):null;
 const all=history.map((e:any)=>{const raw=e.date||e.eventDate||e.timestamp||e.event_at;return {e,at:dated(raw),civil:civil(raw)}});
 all.sort((a:any,b:any)=>String(b.at||b.civil||'').localeCompare(String(a.at||a.civil||'')));
 const h=all.find((v:any)=>v.at||v.civil),e=h?.e||row;
 const eventCode=clean(e.status?.id??e.statusId??e.status_id??e.status?.code??e.statusCode??(h?null:e.status));
 const parentCode=clean(row.content?.status_parent_id??row.status?.id??row.statusId??row.status_id??row.status?.code??row.statusCode??row.status);
 const code=eventCode||parentCode;
 const message=clean(e.status?.name||e.status?.description||e.description||e.status||e.message||e.event||row.status).slice(0,500);
 return {state:normalizeStatus('envia',code)||normalizeStatus('envia',parentCode),code,message,eventAt:h?.at||dated(e.eventDate||e.event_at||e.statusDate),eventTimeRaw:h?.civil||null};
}
// WSDL retrieved without credentials on 2026-10-22. The advertised SOAP address
// differs from the former /TrackingServices/TrackingService.svc URL (HTTP 404).
export const MRW_TRACKING_ENDPOINT='https://trackingservice.mrw.es/TrackingService.svc/TrackingServices';
export function buildMrwTrackingEnvelope(credentials:any,tracking:string,tipoInformacion='1'){
 const esc=(v:unknown)=>clean(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
 const username=clean(credentials?.username)||clean(credentials?.userName)||clean(credentials?.usuario);
 if(!username||!clean(credentials?.password))throw new TrackingError('MRW_CREDENTIALS_REQUIRED');
 if(!['0','1'].includes(tipoInformacion))throw new TrackingError('MRW_TRACKING_INVALID_INFORMATION_TYPE');
 // Exact-number filtering has no date window. WSDL declares both dates as
 // optional nullable strings; leaving them empty avoids excluding older labels.
 return `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetEnvios xmlns="http://tempuri.org/"><login>${esc(username)}</login><pass>${esc(credentials.password)}</pass><codigoIdioma>3082</codigoIdioma><tipoFiltro>0</tipoFiltro><valorFiltroDesde>${esc(tracking)}</valorFiltroDesde><valorFiltroHasta></valorFiltroHasta><fechaDesde></fechaDesde><fechaHasta></fechaHasta><tipoInformacion>${tipoInformacion}</tipoInformacion><codigoAbonado>${esc(credentials.subscriberCode||credentials.codigoAbonado)}</codigoAbonado><codigoFranquicia>${esc(credentials.franchiseCode||credentials.codigoFranquicia)}</codigoFranquicia></GetEnvios></soap:Body></soap:Envelope>`;
}
type XmlNode={name:string;qualified:string;text:string;children:XmlNode[]};
function xmlTree(xml:string):XmlNode{
 if(xml.length>1000000||/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('TRACKING_INVALID_XML');
 const root:XmlNode={name:'',qualified:'',text:'',children:[]},stack=[root];let end=0;
 const decode=(value:string)=>value.replace(/&(?:lt|gt|quot|apos|amp|#\d+|#x[\da-f]+);/gi,entity=>{
  const known:Record<string,string>={'&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&amp;':'&'};if(known[entity])return known[entity];
  const n=entity[2].toLowerCase()==='x'?parseInt(entity.slice(3,-1),16):Number(entity.slice(2,-1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';
 });
 for(const match of xml.matchAll(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]+>|[^<]+/g)){
  if(match.index!==end)throw Error('TRACKING_INVALID_XML');end=match.index+match[0].length;const token=match[0];
  if(token.startsWith('<!--')||token.startsWith('<?'))continue;
  if(token.startsWith('<![CDATA[')){stack.at(-1)!.text+=token.slice(9,-3);continue;}
  if(token.startsWith('</')){const name=token.match(/^<\/([\w.:-]+)\s*>$/)?.[1];if(stack.length===1||name!==stack.at(-1)!.qualified)throw Error('TRACKING_INVALID_XML');stack.pop();continue;}
  if(token.startsWith('<')){const name=token.match(/^<([\w.:-]+)(?:\s[^<>]*|\s*\/?)>$/)?.[1];if(!name||stack.length>64)throw Error('TRACKING_INVALID_XML');const node:XmlNode={name:name.split(':').pop()!,qualified:name,text:'',children:[]};stack.at(-1)!.children.push(node);if(!/\/\s*>$/.test(token))stack.push(node);continue;}
  stack.at(-1)!.text+=decode(token);
 }
 if(end!==xml.length||stack.length!==1||root.children.length!==1||root.text.trim())throw Error('TRACKING_INVALID_XML');return root.children[0];
}
const child=(node:XmlNode,name:string)=>node.children.find(value=>value.name===name);
const value=(node:XmlNode,name:string)=>clean(child(node,name)?.text);
function descendants(node:XmlNode,name:string):XmlNode[]{return [...(node.name===name?[node]:[]),...node.children.flatMap(item=>descendants(item,name))]}
function madridDate(day:string,hour:string){
 const d=day.match(/^(\d{2})(\d{2})(\d{4})$/),t=hour.match(/^(\d{2})(\d{2})$/);if(!d||!t)return null;
 const local=Date.UTC(+d[3],+d[2]-1,+d[1],+t[1],+t[2]);
 const expected=`${d[3]}-${d[2]}-${d[1]} ${t[1]}:${t[2]}`;
 const fmt=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 // Both possible Madrid offsets are checked. Zero matches is an invalid or DST
 // missing time; two matches is ambiguous. Neither permits an invented instant.
 const candidates=[local-3600000,local-7200000].filter(utc=>fmt.format(utc)===expected);
 return candidates.length===1?new Date(candidates[0]).toISOString():null;
}
export function parseMrw(xml:string,tracking:string):Movement{
 const root=xmlTree(xml);
 if(descendants(root,'Fault').length)throw Error('MRW_TRACKING_REJECTED');
 const result=descendants(root,'GetEnviosResult')[0];if(!result)throw Error('TRACKING_RESPONSE_MISMATCH');
 const notice=value(result,'MensajeSeguimiento');
 if(/acceso|credencial|login|password|contrase[nñ]a|usuario/i.test(notice))throw Error('MRW_TRACKING_ACCESS_DENIED');
 const matching=descendants(result,'Seguimiento').filter(node=>value(node,'NumAlbaran')===tracking);
 if(!matching.length)throw Error(notice?'MRW_TRACKING_REJECTED':'TRACKING_RESPONSE_MISMATCH');
 const events=matching.map(row=>{
  // Restrict machine codes before they reach warning logs or persisted errors.
  const raw=value(row,'Estado'),code=/^\d{1,4}$/.test(raw)?raw:'UNKNOWN';
  const message=value(row,'EstadoDescripcion').slice(0,500);
  let state=normalizeStatus('mrw',code,message);
  const attempts=value(row,'Intentos');if(state!=='delivered'&&/^\d+$/.test(attempts)&&Number(attempts)>0)state='exception';
  const eventAt=dated(value(row,'Publicado'))||(state==='delivered'?madridDate(value(row,'FechaEntrega'),value(row,'HoraEntrega')):null);
  return {state,code,message,eventAt,...(!state?{warningCode:'MRW_UNKNOWN_STATUS_'+code}:{})};
 });
 events.sort((a,b)=>(Date.parse(b.eventAt||'')||0)-(Date.parse(a.eventAt||'')||0));
 // Only state, machine code, description and event time leave this parser.
 // PersonaEntrega, Referencia and subscriber fields are intentionally discarded.
 return {...events[0],history:[...events].sort((a,b)=>(Date.parse(a.eventAt||'')||0)-(Date.parse(b.eventAt||'')||0)).slice(-200)};
}
export class TrackingError extends Error {constructor(public code:string,public status=0,public retryAfterSeconds=0){super(code)}}
export async function pollShipment(account:any,credentials:any,tracking:string,request:typeof fetch=fetch):Promise<Movement>{
 const options:RequestInit={signal:AbortSignal.timeout(12000),redirect:'error'};
 let url:string;
 if(account.provider==='sendcloud'){
  const publicKey=clean(credentials.publicKey||credentials.public_key),secretKey=clean(credentials.secretKey||credentials.secret_key);
  if(!publicKey||!secretKey)throw new TrackingError('SENDCLOUD_CREDENTIALS_REQUIRED');
  url='https://panel.sendcloud.sc/api/v3/parcels/tracking/'+encodeURIComponent(tracking);options.headers={Authorization:'Basic '+btoa(publicKey+':'+secretKey)};
 }else if(account.provider==='envia'){
  const token=clean(credentials.token||credentials.apiToken||credentials.api_token);if(!token)throw new TrackingError('ENVIA_CREDENTIALS_REQUIRED');
  url=(account.config?.environment==='production'?'https://api.envia.com':'https://api-test.envia.com')+'/ship/generaltrack/';
  options.method='POST';options.headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};options.body=JSON.stringify({trackingNumbers:[tracking]});
 }else if(account.provider==='mrw'){
  url=MRW_TRACKING_ENDPOINT;options.method='POST';
  options.headers={'Content-Type':'text/xml; charset=utf-8',SOAPAction:'"http://tempuri.org/ITrackingService/GetEnvios"'};
  options.body=buildMrwTrackingEnvelope(credentials,tracking);
 }else throw new TrackingError('UNSUPPORTED_PROVIDER');
 const r=await request(url,options);
 if(!r.ok){const retry=r.headers.get('Retry-After')||'';const seconds=/^\d+$/.test(retry)?Number(retry):Math.max(0,(Date.parse(retry)-Date.now())/1000);throw new TrackingError('PROVIDER_HTTP_'+r.status,r.status,Number.isFinite(seconds)?seconds:0)}
 const body=await r.text();if(body.length>1000000)throw new TrackingError('TRACKING_RESPONSE_TOO_LARGE');
 if(account.provider==='mrw')return parseMrw(body,tracking);
 let json;try{json=JSON.parse(body)}catch{throw new TrackingError('TRACKING_INVALID_JSON')}
 return account.provider==='sendcloud'?parseSendcloud(json):parseEnvia(json,tracking);
}
