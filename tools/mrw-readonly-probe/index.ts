// Temporary internal diagnostic only. Deploy explicitly, invoke once, then remove.
// Never returns raw XML, tracking numbers, recipient data, credentials or IDs.
import {createClient} from 'npm:@supabase/supabase-js@2.105.0';
const accountId='5ede8208-fa76-4d1a-83f3-76a3e0d30c26';
const endpoint='https://seguimiento.mrw.es/swc/wssgmntnvs.asmx';
const method='SeguimientoNumeroEnvioMRWNacional';
const esc=(v:unknown)=>String(v??'').trim().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const value=(xml:string,tag:string)=>xml.match(new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`,'i'))?.[1]||'';
function key(){try{const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');if(keys.default)return keys.default}catch{}return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''}
Deno.serve(async(req:Request)=>{
 const secret=key();if(req.method!=='POST')return Response.json({error:'METHOD_NOT_ALLOWED'},{status:405});
 if(!secret||req.headers.get('apikey')!==secret)return Response.json({error:'UNAUTHORIZED'},{status:401});
 const admin=createClient(Deno.env.get('SUPABASE_URL')||'',secret,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const account=await admin.from('integration_accounts').select('id,owner_id,provider,secret_id').eq('id',accountId).eq('provider','mrw').eq('enabled',true).neq('status','disabled').single();
  if(account.error||!account.data?.secret_id)throw Error('ACCOUNT_NOT_AVAILABLE');
  const vault=await admin.rpc('integration_read_secret',{p_secret_id:account.data.secret_id});if(vault.error)throw Error('CREDENTIAL_READ_FAILED');
  const c=JSON.parse(String(vault.data||'{}'));
  const franchise=c.franchiseCode||c.codigoFranquicia,subscriber=c.subscriberCode||c.codigoAbonado,password=c.password,username=c.username||c.userName||c.usuario;
  const configured={franchise:Boolean(franchise),subscriber:Boolean(subscriber),username:Boolean(username),sagecPassword:Boolean(password),trackingOverride:Boolean(c.trackingPassword||c.tracking_password)};
  if(!franchise||!subscriber||!password)return Response.json({endpoint,method,configured,error:'SAGEC_FIELDS_MISSING'});
  const orders=await admin.from('fulfillment_orders').select('tracking_number').eq('owner_id',account.data.owner_id).eq('shipping_integration_account_id',accountId).eq('shipping_provider','mrw').is('label_cancelled_at',null).is('pii_purged_at',null).not('tracking_number','is',null).or('tracking_status_code.is.null,tracking_status_code.not.in.(DELIVERED,RETURNED,CANCELLED,CANCELED,DELIVERED_AT_ORIGIN,SHIPMENT_COLLECTED_BY_CUSTOMER)').order('label_created_at',{ascending:false}).limit(3);
  if(orders.error)throw Error('ORDER_READ_FAILED');
  const results=[];
  for(const [index,order] of (orders.data||[]).entries()){
   const tracking=String(order.tracking_number||'').trim();if(!tracking)continue;
   const body=`<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${method} xmlns="http://www.mrw.es/webservices/seguimiento"><Franquicia>${esc(franchise)}</Franquicia><Cliente>${esc(subscriber)}</Cliente><Password>${esc(password)}</Password><NumeroMRW>${esc(tracking)}</NumeroMRW><Referencia></Referencia><Agrupado>N</Agrupado></${method}></soap:Body></soap:Envelope>`;
   try{
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'text/xml; charset=utf-8',SOAPAction:`"http://www.mrw.es/webservices/seguimiento/${method}"`},body,redirect:'error',signal:AbortSignal.timeout(12000)});
    const xml=await response.text();if(xml.length>1000000){results.push({sample:index+1,http:response.status,error:'RESPONSE_TOO_LARGE'});continue}
    // Only provider's top-level error fields; never shipment message/PII fields.
    let error=value(xml,'faultstring')||value(xml,'Mensaje');
    for(const sensitive of [...Object.values(c),tracking].filter(v=>typeof v==='string'&&v))error=error.split(String(sensitive)).join('[redacted]').split(esc(sensitive)).join('[redacted]');
    error=error.replace(/<[^>]*>/g,'').replace(/[\w.+-]+@[\w.-]+/g,'[email]').replace(/\d+/g,'[n]').slice(0,300);
    results.push({sample:index+1,http:response.status,providerEstado:value(xml,'Estado').match(/^(true|false)$/i)?.[0]||null,matchedShipment:xml.includes(`<Numero>${tracking}</Numero>`),shipmentCount:[...xml.matchAll(/<(?:\w+:)?Envio(?:\s[^>]*)?>/g)].length,soapFault:/<(?:\w+:)?Fault[\s>]/.test(xml),error:error||null});
   }catch{results.push({sample:index+1,error:'REQUEST_FAILED_OR_TIMEOUT'})}
  }
  let sagec:any={endpoint:'https://sagec.mrw.es/MRWEnvio.asmx?WSDL'};
  try{const r=await fetch(sagec.endpoint,{redirect:'error',signal:AbortSignal.timeout(12000)});const xml=await r.text();sagec={...sagec,http:r.status,methods:[...new Set([...xml.matchAll(/<(?:\w+:)?operation\s+name="([A-Za-z][A-Za-z0-9_]{0,80})"/g)].map(m=>m[1]))].slice(0,40)}}catch{sagec.error='WSDL_REQUEST_FAILED'}
  return Response.json({endpoint,method,credentialMode:'existing_sagec_password',configured,samples:results.length,results,sagec});
 }catch{return Response.json({error:'MRW_READONLY_PROBE_FAILED'},{status:503})}
});
