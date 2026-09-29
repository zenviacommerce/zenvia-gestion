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
function numberValue(value:unknown,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function getAdminKey(){
  const secretKeys=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(secretKeys){try{const parsed=JSON.parse(secretKeys);if(typeof parsed?.default==='string'&&parsed.default.trim())return parsed.default.trim()}catch{}}
  return clean(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
}
function sanitize(value:unknown){
  return clean(value).replace(/Bearer\s+[A-Za-z0-9._-]+/gi,'Bearer [redacted]').slice(0,900);
}
async function authenticate(req:Request,admin:any):Promise<Caller>{
  const token=clean(req.headers.get('Authorization')).replace(/^Bearer\s+/i,'');
  if(!token)throw new Error('Sesión no válida.');
  const {data:userData,error:userError}=await admin.auth.getUser(token);
  if(userError||!userData?.user)throw new Error('Sesión no válida.');
  const {data:caller,error}=await admin.from('app_users')
    .select('user_id,data_owner_id,role,active,permissions').eq('user_id',userData.user.id).maybeSingle();
  if(error)throw error;
  if(!caller?.active)throw new Error('Tu acceso está desactivado.');
  const {data:workspace,error:workspaceError}=await admin.from('workspaces').select('status').eq('id',caller.data_owner_id).maybeSingle();
  if(workspaceError)throw workspaceError;
  if(!workspace||!['active','trialing'].includes(workspace.status))throw new Error('El acceso de tu empresa está suspendido.');
  const permissions=Array.isArray(caller.permissions)?caller.permissions:[];
  if(caller.role!=='admin'&&!permissions.includes('orders'))throw new Error('No tienes permiso para gestionar pedidos.');
  return caller as Caller;
}
async function readSecret(admin:any,secretId:string|null){
  if(!secretId)return {};
  const {data,error}=await admin.rpc('integration_read_secret',{p_secret_id:secretId});
  if(error)throw error;
  try{return JSON.parse(String(data||'{}'))}catch{throw new Error('Las credenciales de la integración no son válidas.')}
}
async function enviaAccounts(admin:any,ownerId:string){
  const {data,error}=await admin.from('integration_accounts').select('*')
    .eq('owner_id',ownerId).eq('provider','envia').eq('enabled',true).neq('status','disabled')
    .order('is_default',{ascending:false}).order('updated_at',{ascending:false});
  if(error)throw error;
  return data||[];
}
async function enviaAccount(admin:any,ownerId:string,id?:string|null){
  if(id){
    const {data,error}=await admin.from('integration_accounts').select('*')
      .eq('owner_id',ownerId).eq('provider','envia').eq('id',id).maybeSingle();
    if(error)throw error;
    if(!data)throw new Error('La cuenta de Envia.com ya no existe.');
    if(data.enabled===false||data.status==='disabled')throw new Error('La cuenta de Envia.com está deshabilitada.');
    return data;
  }
  const rows=await enviaAccounts(admin,ownerId);
  if(!rows.length)throw new Error('Envia.com todavía no está conectado.');
  return rows[0];
}
async function enviaCredentials(admin:any,account:any){
  const stored=await readSecret(admin,account.secret_id||null);
  const token=clean(stored?.token||stored?.apiToken||stored?.api_token);
  if(!token)throw new Error('Falta el token API de Envia.com.');
  return {token};
}
function enviaBase(account:any){
  return account?.config?.environment==='production'?'https://api.envia.com':'https://api-test.envia.com';
}
async function enviaJson(admin:any,account:any,path:string,init:RequestInit={}){
  const {token}=await enviaCredentials(admin,account);
  const h=new Headers(init.headers||{});
  h.set('Authorization',`Bearer ${token}`);
  h.set('Accept','application/json');
  if(init.body&&!h.has('Content-Type'))h.set('Content-Type','application/json');
  const res=await fetch(`${enviaBase(account)}${path}`,{...init,headers:h});
  const raw=await res.text();let data:any=null;try{data=raw?JSON.parse(raw):null}catch{data=raw}
  if(!res.ok||data?.meta==='error'){
    const detail=data?.error?.message||data?.message||data?.error||data?.data?.message||raw||'Error desconocido';
    throw new Error(`Envia.com (${res.status}): ${sanitize(detail)}`);
  }
  return data;
}
async function workspaceConfig(admin:any,ownerId:string){
  const [{data:settings,error:settingsError},{data:business,error:businessError}]=await Promise.all([
    admin.from('app_settings').select('config').eq('owner_id',ownerId).maybeSingle(),
    admin.from('business_settings').select('*').eq('owner_id',ownerId).maybeSingle(),
  ]);
  if(settingsError)throw settingsError;if(businessError)throw businessError;
  const config=(settings?.config&&typeof settings.config==='object')?settings.config:{};
  return {shipping:(config as any).shipping||{},business:business||{}};
}
function orderWeightKg(order:any,fallback:number){
  const w=order?.raw_payload?.shipping_details?.measurement?.weight;
  const raw=numberValue(w?.value,0),unit=clean(w?.unit).toLowerCase();
  if(raw>0){if(unit==='g')return raw/1000;if(unit==='lbs'||unit==='lb')return raw*0.45359237;return raw;}
  return Math.max(0.01,numberValue(fallback,1));
}
function splitStreet(raw:unknown,explicitNumber:unknown){
  const street=clean(raw),given=clean(explicitNumber);
  if(given)return {street,number:given};
  const match=street.match(/^(.*?)[,\s]+(\d+[A-Za-z0-9\-\/]*)$/);
  return match?{street:match[1].trim(),number:match[2]}:{street,number:''};
}
function shipmentPayload(order:any,shipping:any,business:any){
  const destinationAddress=order.shipping_address||{};
  const originStreet=splitStreet(shipping.senderAddress||business.address_line1,business.address_number);
  const destinationStreet=splitStreet(destinationAddress.address_line_1,destinationAddress.house_number);
  const origin={
    name:clean(shipping.senderName||business.trade_name||business.legal_name||'Remitente'),
    company:clean(business.trade_name||business.legal_name)||undefined,
    email:clean(business.email)||undefined,
    phone:clean(business.phone)||undefined,
    street:originStreet.street,
    number:originStreet.number||undefined,
    city:clean(shipping.senderCity||business.city),
    state:clean(business.province)||undefined,
    country:clean(shipping.senderCountryCode||business.country_code||'ES').toUpperCase(),
    postalCode:clean(shipping.senderPostalCode||business.postal_code),
  };
  const destination={
    name:clean(order.customer_name||destinationAddress.name||'Destinatario'),
    company:clean(destinationAddress.company_name)||undefined,
    email:clean(order.customer_email||destinationAddress.email)||undefined,
    phone:clean(order.customer_phone||destinationAddress.phone_number)||undefined,
    street:destinationStreet.street,
    number:destinationStreet.number||undefined,
    city:clean(destinationAddress.city),
    state:clean(destinationAddress.state_province_code||destinationAddress.state)||undefined,
    country:clean(destinationAddress.country_code).toUpperCase(),
    postalCode:clean(destinationAddress.postal_code),
  };
  for(const [label,address] of [['remitente',origin],['destinatario',destination]] as const){
    if(!address.name||!address.street||!address.city||!address.country||!address.postalCode){
      throw new Error(`Faltan datos obligatorios del ${label} para cotizar con Envia.com.`);
    }
  }
  const declared=Math.max(1,numberValue(order.total_amount,1));
  const dimensions={
    length:Math.max(1,numberValue(shipping.defaultPackageLengthCm,20)),
    width:Math.max(1,numberValue(shipping.defaultPackageWidthCm,20)),
    height:Math.max(1,numberValue(shipping.defaultPackageHeightCm,10)),
  };
  const packages=[{
    content:'Productos',
    amount:1,
    type:'box',
    weight:orderWeightKg(order,shipping.fallbackWeightKg),
    weightUnit:'KG',
    lengthUnit:'CM',
    dimensions,
    declaredValue:declared,
  }];
  return {origin,destination,packages};
}
function normalizeRate(item:any,account:any){
  const carrier=clean(item?.carrier||item?.carrierName||item?.carrier_name);
  const service=clean(item?.service||item?.serviceCode||item?.service_code);
  const description=clean(item?.serviceDescription||item?.service_description||service)||'Servicio';
  const price=numberValue(item?.totalPrice??item?.total_price??item?.price,NaN);
  return {
    provider:'envia',
    integrationAccountId:String(account.id),
    code:`envia:${carrier}:${service}`,
    name:description,
    carrierCode:carrier,
    carrierName:carrier||'Envia.com',
    contractId:null,
    price:Number.isFinite(price)?price:null,
    currency:clean(item?.currency)||'EUR',
    billedWeightKg:null,
    deliveryEstimate:clean(item?.deliveryEstimate||item?.delivery_estimate)||null,
    raw:item,
  };
}
function base64(bytes:Uint8Array){
  let binary='';const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+chunk,bytes.length)));
  return btoa(binary);
}
async function fetchLabel(url:string){
  const res=await fetch(url);
  if(!res.ok)throw new Error(`No se pudo descargar la etiqueta de Envia.com (${res.status}).`);
  const mimeType=res.headers.get('content-type')||'application/pdf';
  const bytes=new Uint8Array(await res.arrayBuffer());
  return {mimeType,base64:base64(bytes)};
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return fail('Método no permitido.',405);
  const url=clean(Deno.env.get('SUPABASE_URL')),key=getAdminKey();
  if(!url||!key)return fail('Configuración interna de Supabase no disponible.',500);
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    const caller=await authenticate(req,admin);
    const body=await req.json().catch(()=>({}));
    const action=clean(body?.action);
    const orderId=clean(body?.orderId);
    if(!orderId)return fail('Falta el pedido.');
    const {data:order,error:orderError}=await admin.from('fulfillment_orders').select('*')
      .eq('owner_id',caller.data_owner_id).eq('id',orderId).maybeSingle();
    if(orderError)throw orderError;if(!order)return fail('Pedido no encontrado.',404);
    const {shipping,business}=await workspaceConfig(admin,caller.data_owner_id);

    if(action==='rates'){
      if(order.label_created_at||order.shipping_remote_id||order.sendcloud_parcel_id)return fail('Este pedido ya tiene una etiqueta.',409);
      const accounts=await enviaAccounts(admin,caller.data_owner_id);
      if(!accounts.length)return response({ok:true,options:[],message:'Envia.com no está conectado.'});
      const payload=shipmentPayload(order,shipping,business);
      const options:any[]=[];const warnings:string[]=[];
      for(const account of accounts){
        try{
          const data=await enviaJson(admin,account,'/ship/rate/',{
            method:'POST',
            body:JSON.stringify({...payload,shipment:{type:1}}),
          });
          const rates=Array.isArray(data?.data)?data.data:Array.isArray(data)?data:[];
          options.push(...rates.map((item:any)=>normalizeRate(item,account)));
        }catch(error){
          warnings.push(`${account.display_name||'Envia.com'}: ${error instanceof Error?error.message:String(error)}`);
        }
      }
      return response({ok:true,options,warnings});
    }

    if(action==='create_label'){
      if(order.label_created_at||order.shipping_remote_id||order.sendcloud_parcel_id)return fail('Este pedido ya tiene una etiqueta.',409);
      const option=body?.shippingOption||{};
      const account=await enviaAccount(admin,caller.data_owner_id,clean(option?.integrationAccountId)||null);
      const carrier=clean(option?.carrierCode||option?.raw?.carrier);
      const service=clean(option?.raw?.service||option?.service||clean(option?.code).split(':').slice(2).join(':'));
      if(!carrier||!service)return fail('Selecciona un servicio válido de Envia.com.');
      const payload=shipmentPayload(order,shipping,business);
      const printSize=shipping.labelSize==='A4'?'PAPER_A4':'PAPER_4X6';
      const data=await enviaJson(admin,account,'/ship/generate/',{
        method:'POST',
        body:JSON.stringify({...payload,shipment:{type:1,carrier,service},settings:{printFormat:'PDF',printSize,currency:order.currency||'EUR'}}),
      });
      const shipment=Array.isArray(data?.data)?data.data[0]:data?.data||data;
      const trackingNumber=clean(shipment?.trackingNumber||shipment?.tracking_number);
      const trackingUrl=clean(shipment?.trackUrl||shipment?.trackingUrl||shipment?.tracking_url);
      const labelUrl=clean(shipment?.label||shipment?.labelUrl||shipment?.label_url);
      const shipmentId=clean(shipment?.shipmentId||shipment?.shipment_id||trackingNumber);
      if(!labelUrl||!trackingNumber)throw new Error('Envia.com no devolvió etiqueta o número de seguimiento.');
      const label=await fetchLabel(labelUrl);
      const price=numberValue(shipment?.totalPrice??option?.price,NaN);
      const currency=clean(shipment?.currency||option?.currency||order.currency||'EUR');
      const now=new Date().toISOString();
      const patch:any={
        shipping_provider:'envia',
        shipping_integration_account_id:account.id,
        shipping_remote_id:shipmentId||trackingNumber,
        shipping_label_url:labelUrl,
        shipping_label_mime_type:label.mimeType,
        tracking_number:trackingNumber,
        tracking_url:trackingUrl||null,
        shipping_option_code:service,
        carrier_code:carrier,
        carrier_name:clean(option?.carrierName||shipment?.carrier||carrier)||carrier,
        shipping_service_name:clean(option?.name||shipment?.service||service)||service,
        label_created_at:now,
        tracking_updated_at:now,
      };
      if(shipping.persistShippingCost!==false&&Number.isFinite(price)){
        patch.shipping_cost_amount=price;
        patch.shipping_cost_currency=currency;
        patch.shipping_cost_source='envia_quote';
        patch.shipping_cost_recorded_at=now;
      }
      const updated=await admin.from('fulfillment_orders').update(patch).eq('owner_id',caller.data_owner_id).eq('id',orderId);
      if(updated.error)throw updated.error;
      return response({
        ok:true,provider:'envia',parcelId:0,shipmentId:shipmentId||null,trackingNumber,trackingUrl:trackingUrl||null,
        shippingOptionCode:service,contractId:null,carrierCode:carrier,carrierName:patch.carrier_name,
        shippingServiceName:patch.shipping_service_name,mimeType:label.mimeType,base64:label.base64,
        shippingCost:Number.isFinite(price)?price:null,currency,
      });
    }

    if(action==='fetch_label'){
      if(clean(order.shipping_provider)!=='envia')return fail('La etiqueta no pertenece a Envia.com.',409);
      const labelUrl=clean(order.shipping_label_url);
      if(!labelUrl)return fail('El pedido no tiene una URL de etiqueta guardada.',404);
      const label=await fetchLabel(labelUrl);
      return response({
        ok:true,provider:'envia',parcelId:0,shipmentId:clean(order.shipping_remote_id)||null,
        trackingNumber:clean(order.tracking_number)||null,trackingUrl:clean(order.tracking_url)||null,
        shippingOptionCode:clean(order.shipping_option_code)||null,contractId:null,
        carrierCode:clean(order.carrier_code)||null,carrierName:clean(order.carrier_name)||null,
        shippingServiceName:clean(order.shipping_service_name)||null,mimeType:label.mimeType,base64:label.base64,
      });
    }

    return fail('Acción no válida.');
  }catch(error){
    const message=sanitize(error instanceof Error?error.message:error)||'Error interno.';
    const status=/Sesión no válida/.test(message)?401:/permiso|desactivad|suspendid/.test(message)?403:/no encontrad/.test(message)?404:400;
    return fail(message,status);
  }
});
