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
  const text=await res.text();
  let data:any=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!res.ok){
    const detail=data?.message||data?.error||data?.meta?.message||text||'Error desconocido';
    throw new Error(`Envia.com (${res.status}): ${String(detail).slice(0,800)}`);
  }
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
  return {
    name:clean(s.senderName||b.trade_name||b.legal_name)||'Remitente',
    company:clean(b.trade_name||b.legal_name)||undefined,
    phone:clean(b.phone)||'000000000',
    email:clean(b.email)||undefined,
    street:clean(s.senderAddress||b.address_line1),
    city:clean(s.senderCity||b.city),
    state:clean(b.province)||undefined,
    country:clean(s.senderCountryCode||b.country_code||'ES').toUpperCase(),
    postalCode:clean(s.senderPostalCode||b.postal_code),
  };
}
function destination(order:any){
  const a=order.shipping_address||{};
  return {
    name:clean(order.customer_name||a.name)||'Cliente',
    company:clean(a.company_name)||undefined,
    phone:clean(order.customer_phone||a.phone_number)||'000000000',
    email:clean(order.customer_email||a.email)||undefined,
    street:[clean(a.address_line_1),clean(a.house_number)].filter(Boolean).join(' '),
    city:clean(a.city),
    state:clean(a.state_province_code||a.state)||undefined,
    country:clean(a.country_code).toUpperCase(),
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
  if(!dest.street)missing.push('dirección del destinatario');
  if(!dest.city)missing.push('ciudad del destinatario');
  if(!dest.postalCode)missing.push('código postal del destinatario');
  if(!dest.country)missing.push('país del destinatario');
  if(missing.length)throw new Error(`Faltan datos para cotizar en Envia.com: ${missing.join(', ')}.`);
}
function carrierName(item:any){return clean(item?.description||item?.carrierDescription||item?.carrier||item?.carrierName||item?.carrier_code||item?.carrierCode);}
function normalizeRate(item:any,account:any){
  const carrier=clean(item?.carrier||item?.carrierName||item?.carrier_code||item?.carrierCode||item?.provider);
  const service=clean(item?.service||item?.serviceName||item?.service_code||item?.serviceCode||item?.product);
  const name=clean(item?.serviceDescription||item?.service_description||item?.description||service)||'Servicio';
  const price=number(item?.totalPrice??item?.total_price??item?.price??item?.amount,NaN);
  const currency=clean(item?.currency||item?.currencyCode||item?.currency_code)||'EUR';
  return {
    provider:'envia',
    providerName:'Envia.com',
    integrationAccountId:String(account.id),
    integrationAccountName:String(account.display_name||'Envia.com'),
    code:service,
    name,
    carrierCode:carrier,
    carrierName:carrierName(item)||carrier||'Transportista',
    contractId:null,
    price:Number.isFinite(price)?price:null,
    currency,
    billedWeightKg:null,
    etaDays:number(item?.deliveryEstimate??item?.delivery_estimate??item?.days??item?.estimatedDays,0)||null,
    raw:item,
  };
}
async function listCarriers(c:any,country:string){
  const payload=await enviaJson(`${c.queryBase}/carrier?country_code=${encodeURIComponent(country)}`,c.token);
  const rows=Array.isArray(payload?.data)?payload.data:Array.isArray(payload)?payload:[];
  return rows.filter((x:any)=>x?.active!==false).map((x:any)=>clean(x?.name||x?.carrier||x?.code)).filter(Boolean);
}
async function quoteAccount(admin:any,account:any,order:any,config:any){
  const c=await credentials(admin,account);
  const origin=sender(config),dest=destination(order),pkg=packageFor(order,config.shipping);
  validatePayload(origin,dest);
  const enabled=Array.isArray(config.shipping?.enabledCarriers)?config.shipping.enabledCarriers.map((x:any)=>clean(x).toLowerCase()).filter(Boolean):[];
  let carriers=await listCarriers(c,origin.country||'ES');
  if(enabled.length)carriers=carriers.filter((carrier:string)=>enabled.some((wanted:string)=>carrier.toLowerCase().includes(wanted)||wanted.includes(carrier.toLowerCase())));
  carriers=carriers.slice(0,12);
  const requests=carriers.map(async(carrier:string)=>{
    try{
      const data=await enviaJson(`${c.shipBase}/ship/rate/`,c.token,{
        method:'POST',
        body:JSON.stringify({origin,destination:dest,packages:[pkg],shipment:{type:1,carrier}}),
      });
      const rows=Array.isArray(data?.data)?data.data:Array.isArray(data)?data:[];
      return rows.map((row:any)=>normalizeRate(row,account));
    }catch{return []}
  });
  const settled=await Promise.all(requests);
  return settled.flat();
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
    const orderId=clean(body?.orderId);
    if(!orderId)return fail('Falta el pedido.');
    const {data:order,error:orderError}=await admin.from('fulfillment_orders').select('*').eq('id',orderId).eq('owner_id',caller.data_owner_id).maybeSingle();
    if(orderError)throw orderError;if(!order)return fail('Pedido no encontrado.',404);

    if(action==='rates'){
      const accounts=await enviaAccounts(admin,caller.data_owner_id,clean(body?.integrationAccountId));
      if(!accounts.length)return response({ok:true,configured:false,options:[],message:'Envia.com no está conectado.'});
      const config=await workspaceConfig(admin,caller.data_owner_id);
      const results=await Promise.allSettled(accounts.map((account:any)=>quoteAccount(admin,account,order,config)));
      const options=results.flatMap((result:any)=>result.status==='fulfilled'?result.value:[]).sort((a:any,b:any)=>(a.price??Number.MAX_VALUE)-(b.price??Number.MAX_VALUE));
      return response({ok:true,configured:true,options,message:options.length?null:'Envia.com no devolvió tarifas para este envío.'});
    }

    if(action==='create_label'){
      if(order.sendcloud_parcel_id||order.shipping_remote_id||order.label_created_at)return fail('Este pedido ya tiene una etiqueta.',409);
      const option=body?.shippingOption||{};
      const accountId=clean(option?.integrationAccountId);
      const accounts=await enviaAccounts(admin,caller.data_owner_id,accountId);
      const account=accounts[0];if(!account)return fail('La cuenta de Envia.com seleccionada no está disponible.',409);
      const config=await workspaceConfig(admin,caller.data_owner_id);
      const c=await credentials(admin,account);
      const origin=sender(config),dest=destination(order),pkg=packageFor(order,config.shipping);
      validatePayload(origin,dest);
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
      const data=payload?.data&&typeof payload.data==='object'?payload.data:payload;
      const tracking=clean(data?.trackingNumber||data?.tracking_number||data?.tracking);
      const labelUrl=clean(data?.label||data?.labelUrl||data?.label_url||data?.url);
      if(!tracking||!labelUrl)throw new Error('Envia.com no devolvió tracking o PDF de etiqueta.');
      const pdf=await labelPdf(labelUrl);
      const now=new Date().toISOString();
      const price=option?.price==null?null:number(option.price,0);
      const currency=clean(option?.currency)||'EUR';
      const patch:any={
        shipping_provider:'envia',
        shipping_remote_id:tracking,
        shipping_label_url:labelUrl,
        shipping_integration_account_id:account.id,
        tracking_number:tracking,
        tracking_url:clean(data?.trackingUrl||data?.tracking_url)||null,
        shipping_option_code:service,
        carrier_code:carrier,
        carrier_name:clean(option?.carrierName)||carrier,
        shipping_service_name:clean(option?.name)||service,
        shipping_cost_amount:price,
        shipping_cost_currency:currency,
        shipping_cost_source:price==null?null:'provider_quote',
        shipping_cost_recorded_at:price==null?null:now,
        label_created_at:now,
        last_synced_at:now,
      };
      const {error:updateError}=await admin.from('fulfillment_orders').update(patch).eq('id',order.id).eq('owner_id',caller.data_owner_id);
      if(updateError)throw updateError;
      return response({
        parcelId:0,shipmentId:tracking,trackingNumber:tracking,trackingUrl:patch.tracking_url,
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
