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
function xmlValue(s:string,name:string){const m=s.match(new RegExp(`<(?:(?:\\w+):)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:\\w+):)?${name}>`,'i'));return clean(m?.[1]).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&')}
function madridDate(day:string,hour:string){
 const d=day.match(/^(\d{2})\/(\d{2})\/(\d{4})$/),t=hour.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);if(!d||!t)return null;
 const local=Date.UTC(+d[3],+d[2]-1,+d[1],+t[1],+t[2],+(t[3]||0));let utc=local;
 for(let i=0;i<2;i++){const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(utc);const p=Object.fromEntries(parts.map(v=>[v.type,v.value]));utc=local-(Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)-utc)}
 return new Date(utc).toISOString();
}
export function parseMrw(xml:string,tracking:string):Movement{
 if(/<Estado>\s*false\s*<\/Estado>/i.test(xml)||/<(?:\w+:)?Fault[\s>]/i.test(xml))throw Error('MRW_TRACKING_REJECTED');
 const rows=[...xml.matchAll(/<(?:\w+:)?Envio(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?Envio>/gi)].map(v=>v[1]);
 const row=rows.find(v=>xmlValue(v,'Numero')===tracking);if(!row)throw Error('TRACKING_RESPONSE_MISMATCH');
 const code=xmlValue(row,'Estado'),message=xmlValue(row,'EstadoDescripcion'),state=normalizeStatus('mrw',code,message);
 // Fecha is shipment creation. Only FechaEntrega + HoraEntrega proves delivery time.
 const eventAt=state==='delivered'?madridDate(xmlValue(row,'FechaEntrega'),xmlValue(row,'HoraEntrega')):null;
 return {state,code,message:message.slice(0,500),eventAt};
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
  const password=clean(credentials.trackingPassword||credentials.tracking_password);
  if(!password)throw new TrackingError('MRW_TRACKING_PASSWORD_REQUIRED');
  const esc=(v:unknown)=>clean(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  url='https://seguimiento.mrw.es/swc/wssgmntnvs.asmx';options.method='POST';
  options.headers={'Content-Type':'text/xml; charset=utf-8',SOAPAction:'"http://www.mrw.es/webservices/seguimiento/SeguimientoNumeroEnvioMRWNacional"'};
  options.body=`<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><SeguimientoNumeroEnvioMRWNacional xmlns="http://www.mrw.es/webservices/seguimiento"><Franquicia>${esc(credentials.franchiseCode||credentials.codigoFranquicia)}</Franquicia><Cliente>${esc(credentials.subscriberCode||credentials.codigoAbonado)}</Cliente><Password>${esc(password)}</Password><NumeroMRW>${esc(tracking)}</NumeroMRW><Referencia></Referencia><Agrupado>N</Agrupado></SeguimientoNumeroEnvioMRWNacional></soap:Body></soap:Envelope>`;
 }else throw new TrackingError('UNSUPPORTED_PROVIDER');
 const r=await request(url,options);
 if(!r.ok){const retry=r.headers.get('Retry-After')||'';const seconds=/^\d+$/.test(retry)?Number(retry):Math.max(0,(Date.parse(retry)-Date.now())/1000);throw new TrackingError('PROVIDER_HTTP_'+r.status,r.status,Number.isFinite(seconds)?seconds:0)}
 const body=await r.text();if(body.length>1000000)throw new TrackingError('TRACKING_RESPONSE_TOO_LARGE');
 if(account.provider==='mrw')return parseMrw(body,tracking);
 let json;try{json=JSON.parse(body)}catch{throw new TrackingError('TRACKING_INVALID_JSON')}
 return account.provider==='sendcloud'?parseSendcloud(json):parseEnvia(json,tracking);
}
