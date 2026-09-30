import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const headers={...corsHeaders,'Content-Type':'application/json'};

type Caller={user_id:string;data_owner_id:string;role:string;active:boolean;permissions:string[]|null};

function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers});}
function fail(message:string,status=400){return response({error:message},status);}
function clean(value:unknown){return String(value??'').trim();}
function number(value:unknown,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function asRows(payload:any){
  if(Array.isArray(payload))return payload;
  const direct=[
    payload?.data,payload?.rates,payload?.guides,payload?.shipments,payload?.rows,payload?.results,payload?.items,
    payload?.data?.rates,payload?.data?.guides,payload?.data?.shipments,payload?.data?.rows,payload?.data?.results,payload?.data?.items,payload?.data?.data,
  ];
  for(const value of direct)if(Array.isArray(value))return value;
  return [];
}
function responseMetaError(payload:any){
  if(!payload||typeof payload!=='object')return '';
  if(String(payload?.meta||'').toLowerCase()!=='error')return '';
  const error=payload?.error;
  return clean(error?.message||error?.description||payload?.message||'Envia.com devolvió un error.');
}
function getAdminKey(){
  const raw=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(raw){try{const parsed=JSON.parse(raw);if(typeof parsed?.default==='string'&&parsed.default.trim())return parsed.default.trim()}catch{}}
  return clean(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
}
async function authenticate(req:Request,admin:any):Promise<Caller>{
  const token=clean(req.headers.get('Authorization')).replace(/^Bearer\s+/i,'');
  if(!token)throw new Error('Sesión no válida.');
  const {data:userData,error:userError}=await admin.auth.getUser(token);
  if(userError||!userData?.user)throw new Error('Sesión no válida.');
  const {data:caller,error}=await admin.from('app_users')
    .select('user_id,data_owner_id,role,active,permissions')
    .eq('user_id',userData.user.id).maybeSingle();
  if(error)throw error;
  if(!caller?.active)throw new Error('Tu acceso está desactivado.');
  const permissions=Array.isArray(caller.permissions)?caller.permissions:[];
  if(caller.role!=='admin'&&!permissions.includes('orders'))throw new Error('No tienes permiso para gestionar pedidos.');
  return caller as Caller;
}
async function readVault(admin:any,secretId:string|null){
  if(!secretId)return {};
  const {data,error}=await admin.rpc('integration_read_secret',{p_secret_id:secretId});
  if(error)throw error;
  try{return JSON.parse(String(data||'{}'))}catch{throw new Error('Las credenciales de Envia.com no tienen un formato válido.')}
}
async function enviaAccounts(admin:any,ownerId:string,preferredId=''){
  let query=admin.from('integration_accounts').select('*').eq('owner_id',ownerId).eq('provider','envia').eq('enabled',true).neq('status','disabled');
  if(preferredId)query=query.eq('id',preferredId);
  else query=query.order('is_default',{ascending:false}).order('updated_at',{ascending:false});
  const {data,error}=await query;
  if(error)throw error;
  return data||[];
}
async function credentials(admin:any,account:any){
  const stored=await readVault(admin,account.secret_id);
  const token=clean(stored?.token||stored?.apiToken||stored?.api_token);
  if(!token)throw new Error(`Falta el token API de Envia.com para ${account.display_name||'la cuenta'}.`);
  const production=account.config?.environment==='production';
  return {
    token,
    shipBase:production?'https://api.envia.com':'https://api-test.envia.com',
    queryBase:production?'https://queries.envia.com':'https://queries.test.envia.com',
    environment:production?'production':'sandbox',
  };
}
async function enviaJson(url:string,token:string,init:RequestInit={}){
  const h=new Headers(init.headers||{});
  h.set('Authorization',`Bearer ${token}`);
  h.set('Accept','application/json');
  if(init.body)h.set('Content-Type','application/json');
  const res=await fetch(url,{...init,headers:h});
  const raw=await res.text();
  let data:any=null;try{data=raw?JSON.parse(raw):null}catch{data=raw}
  if(!res.ok){
    const detail=data?.message||data?.error?.message||data?.error?.description||data?.error||data?.meta?.message||raw||'Error desconocido';
    throw new Error(`Envia.com (${res.status}): ${String(detail).slice(0,800)}`);
  }
  const metaError=responseMetaError(data);
  if(metaError)throw new Error(`Envia.com: ${metaError}`);
  return data;
}
async function workspaceConfig(admin:any,ownerId:string){
  const [{data:settings,error:settingsError},{data:business,error:businessError}]=await Promise.all([
    admin.from('app_settings').select('config').eq('owner_id',ownerId).maybeSingle(),
    admin.from('business_settings').select('*').eq('owner_id',ownerId).maybeSingle(),
  ]);
  if(settingsError)throw settingsError;if(businessError)throw businessError;
  const config=settings?.config&&typeof settings.config==='object'?settings.config:{};
  return {shipping:(config as any).shipping||{},business:business||{}};
}
function normalizePhone(value:unknown,countryCode:string){
  const raw=clean(value);if(!raw)return '';
  if(raw.startsWith('+'))return '+'+raw.slice(1).replace(/\D/g,'');
  const digits=raw.replace(/\D/g,'');
  const country=clean(countryCode).toUpperCase();
  if(country==='ES'){
    if(digits.startsWith('0034'))return '+'+digits.slice(2);
    if(digits.startsWith('34')&&digits.length===11)return '+'+digits;
    if(digits.length===9)return '+34'+digits;
  }
  return digits;
}
function enviaStateCode(value:unknown){
  const raw=clean(typeof value==='object'&&value?(value as any).code:value).toUpperCase();
  return /^[A-Z0-9]{2}$/.test(raw)?raw:'';
}
function normalizeEnviaAddress(address:any){
  const normalized={...address};
  const state=enviaStateCode(address?.state);
  if(state)normalized.state=state;
  else delete normalized.state;
  return normalized;
}
function geocodeRows(payload:any):any[]{
  const found:any[]=[];
  const seen=new Set<any>();
  const visit=(value:any,depth=0)=>{
    if(value==null||depth>5||seen.has(value))return;
    if(typeof value!=='object')return;
    seen.add(value);
    if(Array.isArray(value)){for(const item of value)visit(item,depth+1);return}
    const state=enviaStateCode(
      value.stateCode||value.state_code||value.state?.code?.['2digit']||value.state?.code?.['1digit']||
      value.state?.code||value.state?.abbreviation||value.state?.shortCode||value.state?.short_name||value.state||
      value.provinceCode||value.province_code||value.province?.code?.['2digit']||value.province?.code||value.province?.abbreviation
    );
    const city=clean(value.city||value.locality||value.municipality||value.regions?.region_4);
    const postalCode=clean(value.zipcode||value.zip_code||value.postalCode||value.postal_code||value.zipCode||value.zip);
    if(state||city||postalCode)found.push({...value,__state:state,__city:city,__postalCode:postalCode});
    for(const key of ['data','result','results','locations','location','zip_codes','zipCodes','items'])visit(value[key],depth+1);
  };
  visit(payload);
  return found;
}
function bestGeocodeRow(payload:any,postal:string,city:string){
  const rows=geocodeRows(payload);
  if(!rows.length)return null;
  const wantedPostal=clean(postal).replace(/\s+/g,'').toUpperCase();
  const wantedCity=clean(city).toLowerCase();
  return rows.sort((a,b)=>{
    const score=(row:any)=>{
      let value=0;
      if(row.__state)value+=8;
      if(wantedPostal&&clean(row.__postalCode).replace(/\s+/g,'').toUpperCase()===wantedPostal)value+=6;
      if(wantedCity&&clean(row.__city).toLowerCase()===wantedCity)value+=3;
      return value;
    };
    return score(b)-score(a);
  })[0]||null;
}
async function geocodeLookup(country:string,postal:string,city:string){
  const urls:string[]=[];
  if(postal)urls.push(`https://geocodes.envia.com/zipcode/${encodeURIComponent(country)}/${encodeURIComponent(postal)}`);
  if(city)urls.push(`https://geocodes.envia.com/locate/${encodeURIComponent(country)}/${encodeURIComponent(city)}`);
  for(const url of urls){
    try{
      const res=await fetch(url,{headers:{Accept:'application/json'}});
      if(!res.ok)continue;
      const payload=await res.json().catch(()=>null);
      const row=bestGeocodeRow(payload,postal,city);
      if(row?.__state)return row;
    }catch{/* try the next canonical Envia geocoder */}
  }
  return null;
}
async function geocodeAddress(address:any){
  const country=clean(address?.country).toUpperCase(),postal=clean(address?.postalCode),city=clean(address?.city);
  const fallback=normalizeEnviaAddress(address);
  if(!country)return fallback;
  const row=await geocodeLookup(country,postal,city);
  if(!row)return fallback;
  return normalizeEnviaAddress({
    ...address,
    city:row.__city||address.city,
    state:row.__state||address.state,
    country:clean(row.country?.code||row.countryCode||row.country).toUpperCase()||address.country,
    postalCode:row.__postalCode||address.postalCode,
    district:clean(row.district||row.locality)||address.district,
  });
}
function orderWeightKg(order:any,shipping:any){
  const raw=order?.raw_payload?.shipping_details?.measurement?.weight;
  const value=number(raw?.value,0),unit=clean(raw?.unit).toLowerCase();
  if(value>0)return unit==='g'?value/1000:(unit==='lb'||unit==='lbs'?value*0.45359237:value);
  return Math.max(.001,number(shipping?.fallbackWeightKg,1));
}
function contentName(order:any){
  const items=Array.isArray(order?.items)?order.items:[];
  const labels=items.map((item:any)=>clean(item?.name||item?.description||item?.sku)).filter(Boolean);
  return labels.slice(0,3).join(', ').slice(0,80)||'Mercancía';
}
function sender(config:any){
  const s=config.shipping||{},b=config.business||{};
  const country=clean(s.senderCountryCode||b.country_code||'ES').toUpperCase();
  return {
    name:clean(s.senderName||b.trade_name||b.legal_name)||'Remitente',
    company:clean(b.trade_name||b.legal_name)||undefined,
    phone:normalizePhone(b.phone,country),
    email:clean(b.email)||undefined,
    street:clean(s.senderAddress||b.address_line1),
    city:clean(s.senderCity||b.city),
    state:clean(b.province)||undefined,
    country,
    postalCode:clean(s.senderPostalCode||b.postal_code),
  };
}
function destination(order:any){
  const a=order.shipping_address||{},country=clean(a.country_code).toUpperCase();
  return {
    name:clean(order.customer_name||a.name)||'Cliente',
    company:clean(a.company_name)||undefined,
    phone:normalizePhone(order.customer_phone||a.phone_number,country),
    email:clean(order.customer_email||a.email)||undefined,
    street:[clean(a.address_line_1),clean(a.house_number)].filter(Boolean).join(' '),
    city:clean(a.city),
    state:clean(a.state_province_code||a.state)||undefined,
    country,
    postalCode:clean(a.postal_code),
  };
}
function packageFor(order:any,shipping:any){
  return {
    type:'box',
    content:contentName(order),
    amount:1,
    declaredValue:Math.max(0,number(order.total_amount,0)),
    lengthUnit:'CM',
    weightUnit:'KG',
    weight:Number(orderWeightKg(order,shipping).toFixed(3)),
    dimensions:{
      length:Math.max(1,number(shipping?.packageLengthCm,30)),
      width:Math.max(1,number(shipping?.packageWidthCm,20)),
      height:Math.max(1,number(shipping?.packageHeightCm,10)),
    },
  };
}
function validatePayload(origin:any,dest:any){
  const missing:string[]=[];
  if(!origin.street)missing.push('dirección del remitente');
  if(!origin.city)missing.push('ciudad del remitente');
  if(!origin.postalCode)missing.push('código postal del remitente');
  if(!origin.phone)missing.push('teléfono del remitente');
  if(!dest.street)missing.push('dirección del destinatario');
  if(!dest.city)missing.push('ciudad del destinatario');
  if(!dest.postalCode)missing.push('código postal del destinatario');
  if(!dest.country)missing.push('país del destinatario');
  if(!dest.phone)missing.push('teléfono del destinatario');
  if(missing.length)throw new Error(`Faltan datos para cotizar en Envia.com: ${missing.join(', ')}.`);
}
function humanCarrier(value:string){
  return value.replace(/[-_]+/g,' ').replace(/\b\w/g,letter=>letter.toUpperCase());
}
function parseEtaDays(item:any){
  const direct=Number(item?.deliveryDate?.dateDifference??item?.days??item?.estimatedDays);
  if(Number.isFinite(direct)&&direct>0)return direct;
  const raw=clean(item?.deliveryEstimate??item?.delivery_estimate);
  const nums=(raw.match(/\d+(?:[.,]\d+)?/g)||[]).map(value=>Number(value.replace(',','.'))).filter(Number.isFinite);
  return nums.length?Math.max(...nums):null;
}
function normalizeRate(item:any,account:any){
  const carrier=clean(item?.carrier||item?.carrierName||item?.carrier_code||item?.carrierCode||item?.provider);
  const service=clean(item?.service||item?.serviceName||item?.service_code||item?.serviceCode||item?.product);
  const name=clean(item?.serviceDescription||item?.service_description||item?.description||service)||'Servicio';
  const price=number(item?.totalPrice??item?.total_price??item?.price??item?.amount,NaN);
  const currency=clean(item?.currency||item?.currencyCode||item?.currency_code)||'EUR';
  const carrierLabel=clean(item?.carrierDescription||item?.carrier_description||item?.carrierDisplayName||item?.carrierName)||humanCarrier(carrier)||'Transportista';
  return {
    provider:'envia',
    providerName:'Envia.com',
    integrationAccountId:String(account.id),
    integrationAccountName:String(account.display_name||'Envia.com'),
    code:service,
    name,
    carrierCode:carrier,
    carrierName:carrierLabel,
    contractId:null,
    price:Number.isFinite(price)?price:null,
    currency,
    billedWeightKg:null,
    etaDays:parseEtaDays(item),
    raw:item,
  };
}
async function listCarriers(c:any,originCountry:string,destinationCountry:string){
  const international=originCountry!==destinationCountry?'1':'0';
  try{
    const detailed=await enviaJson(`${c.queryBase}/available-carrier/${encodeURIComponent(originCountry)}/${international}/1`,c.token);
    const rows=asRows(detailed);
    const names=rows.filter((x:any)=>x?.active!==false).map((x:any)=>clean(x?.carrier||x?.code||x?.carrierCode||x?.name)).filter(Boolean);
    if(names.length)return [...new Set(names)];
  }catch(error){console.warn('Envia available-carrier fallback',error instanceof Error?error.message:error)}
  const payload=await enviaJson(`${c.queryBase}/carrier?country_code=${encodeURIComponent(originCountry)}`,c.token);
  const rows=asRows(payload);
  return [...new Set(rows.filter((x:any)=>x?.active!==false).map((x:any)=>clean(x?.carrier||x?.code||x?.carrierCode||x?.name)).filter(Boolean))];
}
async function quoteAccount(admin:any,account:any,order:any,config:any){
  const c=await credentials(admin,account);
  let origin=sender(config),dest=destination(order);const pkg=packageFor(order,config.shipping);
  validatePayload(origin,dest);
  [origin,dest]=await Promise.all([geocodeAddress(origin),geocodeAddress(dest)]);
  if(!origin.state)throw new Error(`Envia.com no pudo resolver el código de provincia/estado del remitente (${origin.postalCode||origin.city||origin.country}).`);
  if(!dest.state)throw new Error(`Envia.com no pudo resolver el código de provincia/estado del destinatario (${dest.postalCode||dest.city||dest.country}).`);
  const enabled=Array.isArray(config.shipping?.enabledCarriers)?config.shipping.enabledCarriers.map((x:any)=>clean(x).toLowerCase()).filter(Boolean):[];

  // Envia documents one carrier per rate request. Query the available carriers
  // first and quote each independently so carrier/service identities never bleed
  // into each other in the comparison UI.
  let carriers=await listCarriers(c,origin.country||'ES',dest.country||origin.country||'ES');
  if(enabled.length)carriers=carriers.filter((carrier:string)=>enabled.some((wanted:string)=>carrier.toLowerCase().includes(wanted)||wanted.includes(carrier.toLowerCase())));
  carriers=carriers.slice(0,30);
  const settled=await Promise.all(carriers.map(async(carrier:string)=>{
    try{
      const data=await enviaJson(`${c.shipBase}/ship/rate/`,c.token,{
        method:'POST',
        body:JSON.stringify({origin,destination:dest,packages:[pkg],shipment:{type:1,carrier}}),
      });
      const options=asRows(data).map((row:any)=>normalizeRate(row,account)).filter((option:any)=>option.carrierCode&&option.code);
      return {carrier,options,error:null};
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      console.warn('Envia rate failed',carrier,message);
      return {carrier,options:[],error:message};
    }
  }));
  const options=settled.flatMap(item=>item.options);
  const errors=settled.filter(item=>item.error).map(item=>({carrier:item.carrier,message:item.error as string}));
  return {options,errors,carriers,environment:c.environment};
}
function trackingOf(row:any){return clean(row?.tracking_number||row?.trackingNumber||row?.tracking||row?.guideNumber||row?.guide||row?.shipment?.trackingNumber);}
function shipmentCreatedAt(row:any){
  const raw=clean(row?.created_at||row?.createdAt||row?.creationDate||row?.dateCreated||row?.date||row?.shipment?.createdAt);
  const parsed=raw?new Date(raw):null;
  return parsed&&!Number.isNaN(parsed.getTime())?parsed.toISOString():new Date().toISOString();
}
function shipmentDestination(row:any){
  const d=row?.destination||row?.to||row?.receiver||row?.shipment?.destination||{};
  return {
    name:clean(d?.name||d?.receiverName),
    company_name:clean(d?.company)||null,
    phone_number:clean(d?.phone)||null,
    email:clean(d?.email)||null,
    address_line_1:clean(d?.street||d?.address||d?.address1),
    address_line_2:clean(d?.address2)||null,
    house_number:clean(d?.number)||null,
    postal_code:clean(d?.postalCode||d?.postal_code||d?.zipCode),
    city:clean(d?.city),
    state_province_code:clean(d?.state)||null,
    country_code:clean(d?.country||d?.countryCode).toUpperCase(),
  };
}
function shipmentStatus(row:any){return clean(row?.status?.name||row?.status?.description||row?.status||row?.shipmentStatus||row?.trackingStatus);}
function shipmentCarrier(row:any){return clean(row?.carrierDescription||row?.carrierName||row?.carrier||row?.shipment?.carrier);}
function shipmentService(row:any){return clean(row?.serviceDescription||row?.serviceName||row?.service||row?.shipment?.service);}
function shipmentPrice(row:any){
  const value=number(row?.totalPrice??row?.total_price??row?.price??row?.amount,NaN);
  return Number.isFinite(value)?value:null;
}
function monthKeys(count:number){
  const result:Array<{month:string;year:string}>=[];
  const now=new Date();
  for(let index=0;index<count;index+=1){
    const date=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-index,1));
    result.push({month:String(date.getUTCMonth()+1).padStart(2,'0'),year:String(date.getUTCFullYear())});
  }
  return result;
}
async function syncAccountShipments(admin:any,ownerId:string,account:any,months:number){
  const c=await credentials(admin,account);let synced=0,found=0;
  for(const period of monthKeys(Math.max(1,Math.min(months,12)))){
    const payload=await enviaJson(`${c.queryBase}/guide/${period.month}/${period.year}`,c.token);
    const rows=asRows(payload);found+=rows.length;
    for(const summary of rows){
      const tracking=trackingOf(summary);if(!tracking)continue;
      let row=summary;
      try{
        const detail=await enviaJson(`${c.queryBase}/guide/${encodeURIComponent(tracking)}`,c.token);
        row=asRows(detail)[0]||(detail?.data&&typeof detail.data==='object'&&!Array.isArray(detail.data)?detail.data:detail)||summary;
      }catch(error){
        console.warn('Envia shipment detail fallback',tracking,error instanceof Error?error.message:error);
      }
      const createdAt=shipmentCreatedAt(row),destination=shipmentDestination(row),status=shipmentStatus(row);
      const carrierCode=clean(row?.carrier||row?.carrierCode||row?.shipment?.carrier);
      const carrierName=shipmentCarrier(row)||humanCarrier(carrierCode);
      const service=shipmentService(row);
      const price=shipmentPrice(row);
      const currency=clean(row?.currency||row?.currencyCode||row?.currency_code)||'EUR';
      const labelUrl=clean(row?.label||row?.labelUrl||row?.label_url);
      const trackingUrl=clean(row?.trackUrl||row?.trackingUrl||row?.tracking_url);
      const orderNumber=clean(row?.orderNumber||row?.order_number||row?.reference||row?.referenceNumber||row?.shipmentId)||`ENVIA-${tracking}`;

      let {data:existing,error:existingError}=await admin.from('fulfillment_orders').select('id,shipping_provider')
        .eq('owner_id',ownerId).eq('shipping_remote_id',tracking).limit(1).maybeSingle();
      if(existingError)throw existingError;
      if(!existing){
        const fallback=await admin.from('fulfillment_orders').select('id,shipping_provider')
          .eq('owner_id',ownerId).eq('tracking_number',tracking).limit(1).maybeSingle();
        if(fallback.error)throw fallback.error;
        existing=fallback.data;
      }
      const patch:any={
        shipping_provider:'envia',
        shipping_remote_id:tracking,
        shipping_label_url:labelUrl||null,
        shipping_integration_account_id:account.id,
        tracking_number:tracking,
        tracking_url:trackingUrl||null,
        tracking_status_code:clean(row?.status?.code||row?.statusCode)||status||null,
        tracking_status_message:status||null,
        tracking_updated_at:new Date().toISOString(),
        shipping_option_code:clean(row?.service||row?.serviceCode)||service||null,
        carrier_code:carrierCode||null,
        carrier_name:carrierName||null,
        shipping_service_name:service||null,
        shipping_cost_amount:price,
        shipping_cost_currency:price==null?null:currency,
        shipping_cost_source:price==null?null:'provider_actual',
        shipping_cost_recorded_at:price==null?null:createdAt,
        label_created_at:createdAt,
        last_synced_at:new Date().toISOString(),
      };
      if(existing?.id){
        if(existing.shipping_provider&&existing.shipping_provider!=='envia')continue;
        const {error:updateError}=await admin.from('fulfillment_orders').update(patch).eq('id',existing.id).eq('owner_id',ownerId);
        if(updateError)throw updateError;
      }else{
        const insert={
          owner_id:ownerId,
          sendcloud_id:`envia:${account.id}:${tracking}`,
          order_id:null,
          order_number:orderNumber,
          integration_id:0,
          integration_name:`Envia.com · ${account.display_name||'Cuenta'}`,
          integration_type:'API',
          source_channel:'other',
          source_status:status||'shipment',
          order_created_at:createdAt,
          order_updated_at:createdAt,
          customer_name:destination.name||null,
          customer_email:destination.email||null,
          customer_phone:destination.phone_number||null,
          shipping_address:destination,
          billing_address:{},
          items:[],
          total_amount:null,
          currency,
          raw_payload:{...row,provider:'envia',integration_account_id:account.id},
          ...patch,
        };
        const {error:insertError}=await admin.from('fulfillment_orders').insert(insert);
        if(insertError){
          if(!String(insertError.message||'').toLowerCase().includes('duplicate'))throw insertError;
        }
      }
      synced+=1;
    }
  }
  return {accountId:String(account.id),accountName:String(account.display_name||'Envia.com'),environment:c.environment,found,synced};
}
function bytesToBase64(bytes:Uint8Array){
  let binary='';const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));
  return btoa(binary);
}
async function labelPdf(url:string){
  if(!url)return {mimeType:'application/pdf',base64:''};
  const res=await fetch(url);
  if(!res.ok)throw new Error(`No se pudo descargar la etiqueta de Envia.com (${res.status}).`);
  const bytes=new Uint8Array(await res.arrayBuffer());
  return {mimeType:res.headers.get('content-type')||'application/pdf',base64:bytesToBase64(bytes)};
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return fail('Método no permitido.',405);
  const url=clean(Deno.env.get('SUPABASE_URL')),key=getAdminKey();
  if(!url||!key)return fail('Configuración del backend no disponible.',500);
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    const caller=await authenticate(req,admin);
    const body=await req.json().catch(()=>({}));
    const action=clean(body?.action);

    if(action==='status'){
      const accounts=await enviaAccounts(admin,caller.data_owner_id,clean(body?.integrationAccountId));
      const rows=[] as any[];
      for(const account of accounts){
        const c=await credentials(admin,account);
        rows.push({id:String(account.id),displayName:String(account.display_name||'Envia.com'),environment:c.environment,isDefault:Boolean(account.is_default)});
      }
      return response({ok:true,configured:rows.length>0,accounts:rows});
    }

    if(action==='sync_shipments'){
      const accounts=await enviaAccounts(admin,caller.data_owner_id,clean(body?.integrationAccountId));
      if(!accounts.length)return response({ok:true,configured:false,found:0,synced:0,accounts:[],message:'Envia.com no está conectado.'});
      const results=await Promise.all(accounts.map((account:any)=>syncAccountShipments(admin,caller.data_owner_id,account,number(body?.months,2))));
      return response({
        ok:true,configured:true,
        found:results.reduce((sum,item)=>sum+item.found,0),
        synced:results.reduce((sum,item)=>sum+item.synced,0),
        accounts:results,
      });
    }

    const orderId=clean(body?.orderId);
    if(!orderId)return fail('Falta el pedido.');
    const {data:order,error:orderError}=await admin.from('fulfillment_orders').select('*').eq('id',orderId).eq('owner_id',caller.data_owner_id).maybeSingle();
    if(orderError)throw orderError;if(!order)return fail('Pedido no encontrado.',404);

    if(action==='rates'){
      const accounts=await enviaAccounts(admin,caller.data_owner_id,clean(body?.integrationAccountId));
      if(!accounts.length)return response({ok:true,configured:false,options:[],message:'Envia.com no está conectado.',diagnostics:[]});
      const config=await workspaceConfig(admin,caller.data_owner_id);
      const results=await Promise.allSettled(accounts.map((account:any)=>quoteAccount(admin,account,order,config)));
      const options=results.flatMap((result:any)=>result.status==='fulfilled'?result.value.options:[]).sort((a:any,b:any)=>(a.price??Number.MAX_VALUE)-(b.price??Number.MAX_VALUE));
      const diagnostics=results.flatMap((result:any,index:number)=>{
        if(result.status==='rejected')return [{account:String(accounts[index]?.display_name||'Envia.com'),carrier:null,message:result.reason instanceof Error?result.reason.message:String(result.reason)}];
        return result.value.errors.map((item:any)=>({account:String(accounts[index]?.display_name||'Envia.com'),...item}));
      });
      const firstDiagnostic=diagnostics[0]?.message?String(diagnostics[0].message).replace(/^Envia\.com \(\d+\):\s*/,''):'';
      const message=options.length
        ?(diagnostics.length?`${options.length} opciones disponibles; ${diagnostics.length} cotizaciones de transportista no aplican a esta ruta.`:null)
        :(firstDiagnostic?`Envia.com no devolvió tarifas. ${firstDiagnostic}`:'Envia.com no devolvió tarifas para este envío.');
      return response({ok:true,configured:true,options,message,diagnostics});
    }

    if(action==='create_label'){
      if(order.sendcloud_parcel_id||order.shipping_remote_id||order.label_created_at)return fail('Este pedido ya tiene una etiqueta.',409);
      const option=body?.shippingOption||{};
      const accountId=clean(option?.integrationAccountId);
      const accounts=await enviaAccounts(admin,caller.data_owner_id,accountId);
      const account=accounts[0];if(!account)return fail('La cuenta de Envia.com seleccionada no está disponible.',409);
      const config=await workspaceConfig(admin,caller.data_owner_id);
      const c=await credentials(admin,account);
      let origin=sender(config),dest=destination(order);const pkg=packageFor(order,config.shipping);
      validatePayload(origin,dest);
      [origin,dest]=await Promise.all([geocodeAddress(origin),geocodeAddress(dest)]);
      if(!origin.state||!dest.state)return fail('Envia.com no pudo validar la provincia/estado del remitente o destinatario. Revisa los códigos postales.',422);
      const carrier=clean(option?.carrierCode),service=clean(option?.code);
      if(!carrier||!service)return fail('Selecciona un transportista y servicio de Envia.com.');
      const labelSize=clean(config.shipping?.labelSize);
      const printSize=labelSize==='A4'?'PAPER_A4':'PAPER_4X6';
      const payload=await enviaJson(`${c.shipBase}/ship/generate/`,c.token,{
        method:'POST',
        body:JSON.stringify({
          origin,destination:dest,packages:[pkg],
          settings:{printFormat:'PDF',printSize},
          shipment:{type:1,carrier,service},
        }),
      });
      const rows=asRows(payload);
      const data=rows[0]||(payload?.data&&typeof payload.data==='object'?payload.data:payload);
      const tracking=clean(data?.trackingNumber||data?.tracking_number||data?.tracking);
      const labelUrl=clean(data?.label||data?.labelUrl||data?.label_url||data?.url);
      if(!tracking||!labelUrl)throw new Error('Envia.com no devolvió tracking o PDF de etiqueta.');
      const pdf=await labelPdf(labelUrl);
      const now=new Date().toISOString();
      const generatedPrice=number(data?.totalPrice??data?.total_price,NaN);
      const quotedPrice=option?.price==null?NaN:number(option.price,NaN);
      const price=Number.isFinite(generatedPrice)?generatedPrice:(Number.isFinite(quotedPrice)?quotedPrice:null);
      const currency=clean(data?.currency||option?.currency)||'EUR';
      const patch:any={
        shipping_provider:'envia',
        shipping_remote_id:tracking,
        shipping_label_url:labelUrl,
        shipping_integration_account_id:account.id,
        tracking_number:tracking,
        tracking_url:clean(data?.trackUrl||data?.trackingUrl||data?.tracking_url)||null,
        shipping_option_code:service,
        carrier_code:carrier,
        carrier_name:clean(option?.carrierName)||humanCarrier(carrier),
        shipping_service_name:clean(option?.name)||service,
        shipping_cost_amount:price,
        shipping_cost_currency:price==null?null:currency,
        shipping_cost_source:price==null?null:'provider_actual',
        shipping_cost_recorded_at:price==null?null:now,
        label_created_at:now,
        last_synced_at:now,
      };
      const {error:updateError}=await admin.from('fulfillment_orders').update(patch).eq('id',order.id).eq('owner_id',caller.data_owner_id);
      if(updateError)throw updateError;
      return response({
        parcelId:0,shipmentId:clean(data?.shipmentId)||tracking,trackingNumber:tracking,trackingUrl:patch.tracking_url,
        shippingOptionCode:service,contractId:null,carrierCode:carrier,carrierName:patch.carrier_name,
        shippingServiceName:patch.shipping_service_name,mimeType:pdf.mimeType,base64:pdf.base64,
        provider:'envia',integrationAccountId:String(account.id),labelUrl,
      });
    }

    if(action==='fetch_label'){
      if(order.shipping_provider!=='envia'||!order.shipping_label_url)return fail('Este pedido no tiene una etiqueta de Envia.com.',404);
      const pdf=await labelPdf(String(order.shipping_label_url));
      return response({
        parcelId:0,shipmentId:order.shipping_remote_id||order.tracking_number||null,
        trackingNumber:order.tracking_number||null,trackingUrl:order.tracking_url||null,
        shippingOptionCode:order.shipping_option_code||null,contractId:null,
        carrierCode:order.carrier_code||null,carrierName:order.carrier_name||null,
        shippingServiceName:order.shipping_service_name||null,mimeType:pdf.mimeType,base64:pdf.base64,
        provider:'envia',integrationAccountId:order.shipping_integration_account_id||null,labelUrl:order.shipping_label_url,
      });
    }
    return fail('Acción no válida.');
  }catch(error){
    const message=error instanceof Error?error.message:String(error||'Error interno.');
    const status=/Sesión no válida/.test(message)?401:/permiso|desactivado/.test(message)?403:/ya tiene una etiqueta/.test(message)?409:500;
    return fail(message,status);
  }
});
