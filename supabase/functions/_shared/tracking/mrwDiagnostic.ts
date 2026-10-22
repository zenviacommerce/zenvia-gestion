// Temporary service-key-only diagnostic. No persistence, provider mutations or logs.
const ENDPOINT='https://trackingservice.mrw.es/TrackingService.svc/TrackingServices';
const ACTION='http://tempuri.org/ITrackingService/GetEnvios';
const clean=(v:unknown)=>typeof v==='string'?v.trim():'';
const escapeXml=(v:string)=>v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const xmlField=(xml:string,name:string)=>{
 const match=xml.match(new RegExp(`<(?:(?:\\w+):)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:\\w+):)?${name}>`,'i'));
 return clean(match?.[1]).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
};
type Shipment={NumAlbaran:string;Estado:string;EstadoDescripcion:string;Publicado:string;FechaEntrega:string;HoraEntrega:string;Intentos:number};
type Probe={mode:'exact'|'range';tipoInformacion:'0'|'1';httpStatus:number;MensajeSeguimiento:'OK'|'NO_DATA'|'REJECTED'|'HTTP_ERROR'|'INVALID_RESPONSE'|'UNAVAILABLE';historyCount:number;matchedHistoryCount:number;batchDistinctCount:number;matchedDistinctCount:number;FaultCode:null|'SOAP_FAULT'|'SOAP_CLIENT'|'SOAP_SERVER';shipments:Shipment[]};
export type MrwDiagnosticResult={code:'MRW_DIAGNOSTIC_COMPLETE'|'MRW_DIAGNOSTIC_UNAVAILABLE';results:Probe[]};
function records(xml:string){
 const stack:number[]=[],rows:string[]=[];const tags=/<(\/?)(?:\w+:)?Seguimiento(?:\s[^>]*)?>/gi;let match:RegExpExecArray|null;
 while((match=tags.exec(xml))){
  if(!match[1])stack.push(tags.lastIndex);
  else {const start=stack.pop();if(start===undefined)continue;const body=xml.slice(start,match.index);
   if(!/<(?:\w+:)?Seguimiento(?:\s|>)/i.test(body)&&xmlField(body,'NumAlbaran'))rows.push(body);
  }
 }
 return rows;
}
export async function runMrwDiagnostic(admin:any,request:typeof fetch=fetch,batchOnly=false):Promise<MrwDiagnosticResult>{
 const started=Date.now();
 const unavailable:MrwDiagnosticResult={code:'MRW_DIAGNOSTIC_UNAVAILABLE',results:[]};
 try{
  const selected=await admin.from('integration_accounts').select('id,owner_id,provider,secret_id,config').eq('provider','mrw').eq('enabled',true).neq('status','disabled').not('secret_id','is',null).limit(1).maybeSingle();
  const account=selected.data;if(selected.error||!account?.secret_id||account.config?.archivedAt)return unavailable;
  const workspace=await admin.from('workspaces').select('id').eq('id',account.owner_id).in('status',['active','trialing']).maybeSingle();
  if(workspace.error||!workspace.data)return unavailable;
  const query=()=>admin.from('fulfillment_orders').select('id,tracking_number,tracking_status_code').eq('owner_id',account.owner_id).eq('shipping_integration_account_id',account.id).eq('shipping_provider','mrw').is('pii_purged_at',null).is('label_cancelled_at',null).not('tracking_number','is',null).neq('tracking_number','');
  const exact=await query().eq('tracking_number','01009F045714').limit(1).maybeSingle();
  const sample=await query().order('label_created_at',{ascending:false}).limit(20);
  if(exact.error||sample.error)return unavailable;
  const orders=sample.data||[];
  const states=orders.length?await admin.from('shipment_tracking_state').select('order_id,normalized_state').eq('owner_id',account.owner_id).eq('account_id',account.id).eq('provider','mrw').in('order_id',orders.map((o:any)=>o.id)):{data:[],error:null};
  if(states.error)return unavailable;
  const terminal=(value:unknown)=>['DELIVERED','RETURNED','CANCELLED','CANCELED','ENTREGADO','ENTREGADA','DEVUELTO','ANULADO'].includes(String(value||'').trim().toUpperCase().replace(/ /g,'_'));
  const active=orders.filter((o:any)=>!terminal(o.tracking_status_code)&&!(states.data||[]).some((s:any)=>s.order_id===o.id&&terminal(s.normalized_state)));
  const numbers=[...new Set<string>([clean(exact.data?.tracking_number),...active.slice(0,3).map((o:any)=>clean(o.tracking_number))].filter(Boolean))].slice(0,4);
  if(!numbers.length)return unavailable;
  const secret=await admin.rpc('integration_read_secret',{p_secret_id:account.secret_id});if(secret.error)return unavailable;
  let c:any;try{c=JSON.parse(String(secret.data||'{}'))}catch{return unavailable}
  const login=clean(c.username)||clean(c.userName)||clean(c.usuario),password=clean(c.password);
  if(!login||!password)return unavailable;
  const subscriber=clean(c.subscriberCode)||clean(c.codigoAbonado),franchise=clean(c.franchiseCode)||clean(c.codigoFranquicia);
  const safe=(value:string,max=100)=>[login,password].reduce((text,credential)=>text.split(credential).join('[REDACTED]'),value).replace(/<[^>]*>/g,'').replace(/[\u0000-\u001f]/g,' ').slice(0,max);
  const temporal=(value:string)=>/^[0-9T:./ +Z-]{0,40}$/.test(value)?safe(value,40):'';
  const probes:Array<{mode:'exact'|'range';from:string;to:string;info:'0'|'1'}>=batchOnly?[]:numbers.flatMap(number=>(['0','1'] as const).map(info=>({mode:'exact' as const,from:number,to:info==='0'?'':number,info})));
  // Batch evidence must concern two selected owned numbers. Never synthesize
  // an adjacent number which may belong to an unrelated shipment.
  const sorted=[...numbers].sort();
  for(let i=0;i<sorted.length-1;i++){
   const from=sorted[i].match(/^(.*?)(\d{1,12})$/),to=sorted[i+1].match(/^(.*?)(\d{1,12})$/);
   if(from&&to&&from[1]===to[1]&&from[2].length===to[2].length&&Number(to[2])-Number(from[2])===1){probes.push({mode:'range',from:sorted[i],to:sorted[i+1],info:'1'});break}
  }
  const results:Probe[]=[];
  for(const probe of probes){
   const remaining=100000-(Date.now()-started);if(remaining<1000)break;
   const output:Probe={mode:probe.mode,tipoInformacion:probe.info,httpStatus:0,MensajeSeguimiento:'UNAVAILABLE',historyCount:0,matchedHistoryCount:0,batchDistinctCount:0,matchedDistinctCount:0,FaultCode:null,shipments:[]};
   try{
    const params={login,pass:password,codigoIdioma:'3082',tipoFiltro:'0',valorFiltroDesde:probe.from,valorFiltroHasta:probe.to,fechaDesde:'',fechaHasta:'',tipoInformacion:probe.info,codigoAbonado:subscriber,codigoFranquicia:franchise};
    const body='<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetEnvios xmlns="http://tempuri.org/">'+Object.entries(params).map(([name,value])=>`<${name}>${escapeXml(value)}</${name}>`).join('')+'</GetEnvios></soap:Body></soap:Envelope>';
    const response=await request(ENDPOINT,{method:'POST',headers:{'Content-Type':'text/xml; charset=utf-8',SOAPAction:'"'+ACTION+'"'},body,signal:AbortSignal.timeout(Math.min(10000,remaining)),redirect:'error'});
    output.httpStatus=response.status;
    {
     const xml=await response.text();
     if(/<(?:\w+:)?Fault(?:\s|>)/i.test(xml)){output.MensajeSeguimiento='REJECTED';const fault=xmlField(xml,'faultcode').split(':').pop();output.FaultCode=fault==='Client'?'SOAP_CLIENT':fault==='Server'?'SOAP_SERVER':'SOAP_FAULT'}
     else if(!response.ok)output.MensajeSeguimiento='HTTP_ERROR';
     else if(xml.length>1000000||!/<(?:\w+:)?GetEnviosResult(?:\s|>)/i.test(xml))output.MensajeSeguimiento='INVALID_RESPONSE';
     else{
      const allRows=records(xml);
      const rows=allRows.filter(row=>probe.mode==='range'?numbers.includes(xmlField(row,'NumAlbaran')):xmlField(row,'NumAlbaran')===probe.from);
      output.historyCount=allRows.length;output.matchedHistoryCount=rows.length;
      output.batchDistinctCount=new Set(allRows.map(row=>xmlField(row,'NumAlbaran')).filter(Boolean)).size;
      output.matchedDistinctCount=new Set(rows.map(row=>xmlField(row,'NumAlbaran')).filter(Boolean)).size;output.MensajeSeguimiento=rows.length?'OK':'NO_DATA';
      output.shipments=rows.slice(0,40).map(row=>({NumAlbaran:safe(xmlField(row,'NumAlbaran'),40),Estado:safe(xmlField(row,'Estado'),40),EstadoDescripcion:safe(xmlField(row,'EstadoDescripcion')),Publicado:temporal(xmlField(row,'Publicado')),FechaEntrega:temporal(xmlField(row,'FechaEntrega')),HoraEntrega:temporal(xmlField(row,'HoraEntrega')),Intentos:Math.max(0,Math.min(10000,Number(xmlField(row,'Intentos'))||0))}));
     }
    }
   }catch{/* Fixed UNAVAILABLE result; never expose exception/provider text. */}
   results.push(output);
  }
  return {code:'MRW_DIAGNOSTIC_COMPLETE',results};
 }catch{return unavailable}
}
