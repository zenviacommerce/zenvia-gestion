import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const jsonHeaders={...corsHeaders,'Content-Type':'application/json'};
const SENDCLOUD_BASE='https://panel.sendcloud.sc/api/v3';

type Caller={user_id:string;data_owner_id:string;role:string;active:boolean;permissions:string[]|null};
type SendcloudCredentials={publicKey:string;secretKey:string};

function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:jsonHeaders});}
function fail(message:string,status=400){return response({error:message},status);}
function getAdminKey(){
  const secretKeys=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(secretKeys){try{const parsed=JSON.parse(secretKeys);if(parsed?.default)return parsed.default as string}catch{/* fallback */}}
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
}
function envCredentials():SendcloudCredentials|null{
  const publicKey=clean(Deno.env.get('SENDCLOUD_PUBLIC_KEY')||Deno.env.get('SENDCLOUD_API_KEY'));
  const secretKey=clean(Deno.env.get('SENDCLOUD_SECRET_KEY')||Deno.env.get('SENDCLOUD_API_SECRET'));
  return publicKey&&secretKey?{publicKey,secretKey}:null;
}
function basicAuth(publicKey:string,secretKey:string){return `Basic ${btoa(`${publicKey}:${secretKey}`)}`;}
async function readIntegrationSecret(admin:any,secretId:string|null){
  if(!secretId)return {};
  const {data,error}=await admin.rpc('integration_read_secret',{p_secret_id:secretId});if(error)throw error;
  try{return JSON.parse(String(data||'{}'))}catch{throw new Error('Las credenciales cifradas de Sendcloud no tienen un formato válido.');}
}
async function credentialsForOrder(admin:any,ownerId:string,integrationAccountId?:string|null):Promise<SendcloudCredentials>{
  if(integrationAccountId){
    const {data,error}=await admin.from('integration_accounts').select('credential_source,secret_id,status,enabled,display_name')
      .eq('owner_id',ownerId).eq('provider','sendcloud').eq('id',integrationAccountId).maybeSingle();
    if(error)throw error;if(!data)throw new Error('La cuenta de Sendcloud asociada al pedido ya no existe.');
    if(data.status==='disabled'||data.enabled===false)throw new Error('La cuenta de Sendcloud asociada al pedido está deshabilitada.');
    const stored=await readIntegrationSecret(admin,data.secret_id||null),env=envCredentials();
    const publicKey=clean(stored?.publicKey||stored?.public_key||(data.credential_source==='environment'?env?.publicKey:''));
    const secretKey=clean(stored?.secretKey||stored?.secret_key||(data.credential_source==='environment'?env?.secretKey:''));
    if(!publicKey||!secretKey)throw new Error(`Faltan las claves de Sendcloud para ${data.display_name||'la cuenta del pedido'}.`);
    return {publicKey,secretKey};
  }
  const {data,error}=await admin.from('integration_accounts').select('id').eq('owner_id',ownerId).eq('provider','sendcloud')
    .eq('enabled',true).neq('status','disabled').order('is_default',{ascending:false}).order('updated_at',{ascending:false}).limit(1).maybeSingle();
  if(error)throw error;
  if(data)return credentialsForOrder(admin,ownerId,String(data.id));
  throw new Error('Sendcloud todavía no está conectado para este workspace.');
}
function remoteSendcloudId(order:any){
  const explicit=clean(order?.sendcloud_remote_id);if(explicit)return explicit;
  const stored=clean(order?.sendcloud_id);return stored.includes(':')?stored.slice(stored.lastIndexOf(':')+1):stored;
}
async function sendcloudJson(credentials:SendcloudCredentials,path:string,init:RequestInit={}){
  const url=path.startsWith('http')?path:`${SENDCLOUD_BASE}${path.startsWith('/')?'':'/'}${path}`;
  const headers=new Headers(init.headers||{});headers.set('Authorization',basicAuth(credentials.publicKey,credentials.secretKey));headers.set('Accept','application/json');
  if(init.body&&!headers.has('Content-Type'))headers.set('Content-Type','application/json');
  const res=await fetch(url,{...init,headers});const body=await res.text();let data:any=null;try{data=body?JSON.parse(body):null}catch{data=body}
  if(!res.ok){const detail=Array.isArray(data?.errors)?data.errors.map((x:any)=>x?.detail||x?.title).filter(Boolean).join(' · '):data?.message||data?.error||body;throw new Error(`Sendcloud (${res.status}): ${String(detail||'Error desconocido').slice(0,900)}`)}
  return {data,headers:res.headers};
}
async function authenticate(req:Request,admin:any):Promise<Caller>{
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();if(!token)throw new Error('Sesión no válida.');
  const {data:userData,error:userError}=await admin.auth.getUser(token);if(userError||!userData.user)throw new Error('Sesión no válida.');
  const {data:caller,error}=await admin.from('app_users').select('user_id,data_owner_id,role,active,permissions').eq('user_id',userData.user.id).maybeSingle();if(error)throw error;
  if(!caller?.active)throw new Error('Tu acceso está desactivado.');
  const {data:workspace,error:workspaceError}=await admin.from('workspaces').select('status').eq('id',caller.data_owner_id).maybeSingle();if(workspaceError)throw workspaceError;
  if(!workspace||!['active','trialing'].includes(workspace.status))throw new Error('El acceso de tu empresa está suspendido.');
  const permissions=Array.isArray(caller.permissions)?caller.permissions:[];
  if(caller.role!=='admin'&&!permissions.includes('orders'))throw new Error('No tienes permiso para gestionar pedidos.');return caller as Caller;
}
async function workspaceConfig(admin:any,ownerId:string){
  const {data,error}=await admin.from('app_settings').select('config').eq('owner_id',ownerId).maybeSingle();
  if(error)throw error;
  const config=(data?.config&&typeof data.config==='object')?data.config:{};
  return {orders:(config as any).orders||{},shipping:(config as any).shipping||{}};
}
function clean(v:unknown){return String(v??'').trim();}
function statusCode(v:unknown){return clean(v).toLowerCase();}
function canEdit(v:unknown){const s=statusCode(v);return !s.includes('cancel')&&!['fulfilled','shipped','delivered'].includes(s);}
function toKg(value:unknown,unit:unknown){const n=Number(value);if(!Number.isFinite(n)||n<=0)return null;const u=clean(unit).toLowerCase();if(u==='g')return n/1000;if(u==='lbs'||u==='lb')return n*0.45359237;return n;}
function orderWeightKg(order:any,fallbackWeightKg=1){const w=order?.raw_payload?.shipping_details?.measurement?.weight;return toKg(w?.value,w?.unit)||Math.max(0.01,Number(fallbackWeightKg)||1);}
function friendlyCarrier(code:unknown){const v=clean(code),l=v.toLowerCase();if(l.includes('correos'))return 'Correos';if(l.includes('mrw'))return 'MRW';return v||'Transportista';}

// Sendcloud v3 only accepts state_province_code for these destination countries.
// Spain is deliberately excluded: for ES the field must be omitted entirely.
const STATE_COUNTRIES=new Set(['AT','AU','BR','CA','DE','ET','FM','IN','IT','KN','MM','MX','MY','NG','PW','US','VE','VN']);
function normalizeStateProvince(country:unknown,value:unknown){
  const cc=clean(country).toUpperCase(),raw=clean(value);if(!raw||!STATE_COUNTRIES.has(cc))return null;
  const upper=raw.toUpperCase();
  const prefixed=upper.match(new RegExp(`^${cc}[-_ ](.+)$`));
  const candidate=(prefixed?.[1]||upper).trim();
  return /^[A-Z0-9-]{1,8}$/.test(candidate)?candidate:null;
}
function quoteForWeight(option:any,weightKg?:number){
  const quotes=Array.isArray(option?.quotes)?option.quotes:[option?.quotes].filter(Boolean);
  if(!quotes.length)return null;
  if(weightKg==null||!Number.isFinite(weightKg))return quotes.find((q:any)=>q?.price?.total?.value!=null)||quotes[0];
  const matching=quotes.find((q:any)=>{
    const min=toKg(q?.weight?.min?.value,q?.weight?.min?.unit),max=toKg(q?.weight?.max?.value,q?.weight?.max?.unit);
    return (min==null||weightKg>=min)&&(max==null||weightKg<=max)&&q?.price?.total?.value!=null;
  });
  return matching||quotes.find((q:any)=>q?.price?.total?.value!=null)||quotes[0];
}
function normalizeOption(option:any,weightKg?:number){
  const code=clean(option?.code||option?.shipping_option_code||option?.shipping_option?.code);
  const carrierCode=clean(option?.carrier?.code||option?.carrier_code||code.split(':')[0]);
  const name=clean(option?.name||option?.title||option?.product?.name||option?.shipping_product?.name||option?.display_name||code)||'Servicio';
  const contractValue=option?.contract_id??option?.contract?.id??null;
  const quote=quoteForWeight(option,weightKg);
  const priceValue=quote?.price?.total?.value??quote?.price?.value??quote?.total_price?.value??quote?.value??option?.price?.total?.value??option?.price?.value??null;
  const currency=quote?.price?.total?.currency??quote?.price?.currency??quote?.total_price?.currency??quote?.currency??option?.price?.total?.currency??option?.price?.currency??null;
  const billed=option?.billed_weight;
  return {code,name,carrierCode,carrierName:clean(option?.carrier?.name||option?.carrier_name)||friendlyCarrier(carrierCode),contractId:contractValue==null?null:Number(contractValue),price:priceValue==null?null:Number(priceValue),currency:currency||null,billedWeightKg:toKg(billed?.value,billed?.unit),raw:option};
}

function comparable(value:unknown){
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}
function v2Rows(payload:any){
  if(Array.isArray(payload))return payload;
  for(const key of ['shipping_methods','data','results','items'])if(Array.isArray(payload?.[key]))return payload[key];
  return [];
}
function v2CountryPrice(method:any,countryCode:string){
  const countries=Array.isArray(method?.countries)?method.countries:[];
  const country=countries.find((item:any)=>clean(item?.iso_2||item?.country||item?.code).toUpperCase()===countryCode);
  if(!country)return null;
  const raw=country?.price??country?.price_value??country?.value??country?.shipping_price;
  const value=Number(typeof raw==='object'?raw?.value:raw);
  return Number.isFinite(value)&&value>0?value:null;
}
function v2MethodScore(method:any,option:any){
  const optionCarrier=comparable(option.carrierName||option.carrierCode);
  const optionName=comparable(option.name||option.code);
  const methodCarrier=comparable(method?.carrier||method?.carrier_name||method?.name);
  const methodName=comparable(method?.name);
  let score=0;
  if(optionCarrier&&methodCarrier.includes(optionCarrier))score+=45;
  if(optionName&&methodName===optionName)score+=80;
  else if(optionName&&methodName&&(methodName.includes(optionName)||optionName.includes(methodName)))score+=45;
  const code=comparable(option.code);
  if(code&&methodName&&code.split(' ').filter(Boolean).every((token:string)=>methodName.includes(token)))score+=20;
  return score;
}
async function enrichSendcloudV3Quotes(credentials:SendcloudCredentials,options:any[],weightKg:number,requestBody:any){
  const unresolved=options.filter(option=>option.price==null);
  if(!unresolved.length)return options;
  const groups=new Map<string,any>();
  for(const option of unresolved){
    const carrierCode=clean(option.carrierCode),contractId=option.contractId==null?null:Number(option.contractId);
    if(!carrierCode)continue;
    const key=`${carrierCode}|${contractId??''}`;
    if(!groups.has(key))groups.set(key,{carrierCode,contractId});
  }
  for(const group of groups.values()){
    try{
      const payload={...requestBody,carrier_code:group.carrierCode,...(group.contractId?{contract_id:group.contractId}:{})};
      const {data}=await sendcloudJson(credentials,'/shipping-options',{method:'POST',body:JSON.stringify(payload)});
      const rated=(data?.data||[]).map((item:any)=>normalizeOption(item,weightKg));
      for(const option of unresolved.filter(item=>clean(item.carrierCode)===group.carrierCode&&(group.contractId==null||Number(item.contractId)===group.contractId))){
        const exact=rated.find((item:any)=>item.code===option.code&&item.price!=null)
          ||rated.find((item:any)=>clean(item.raw?.product?.code)===clean(option.raw?.product?.code)&&item.price!=null);
        if(exact){
          option.price=exact.price;
          option.currency=exact.currency||'EUR';
          option.billedWeightKg=exact.billedWeightKg??option.billedWeightKg;
          option.priceSource='sendcloud_v3_quote';
        }
      }
    }catch{/* Keep the option usable even when one carrier cannot return a quote. */}
  }
  return options;
}

async function enrichSendcloudPrices(credentials:SendcloudCredentials,options:any[],weightKg:number,fromCountry:string,toCountry:string){
  if(!options.some(option=>option.price==null))return options;
  try{
    const {data:methodsPayload}=await sendcloudJson(credentials,'https://panel.sendcloud.sc/api/v2/shipping_methods');
    const methods=v2Rows(methodsPayload);
    const unresolved=options.filter(option=>option.price==null);
    await Promise.all(unresolved.map(async option=>{
      const ranked=methods.map((method:any)=>({method,score:v2MethodScore(method,option)})).filter((item:any)=>item.score>=45).sort((a:any,b:any)=>b.score-a.score);
      const candidate=ranked[0]?.method;
      if(!candidate)return;
      const embedded=v2CountryPrice(candidate,toCountry);
      if(embedded!=null){option.price=embedded;option.currency='EUR';option.priceSource='sendcloud_v2_methods';return}
      const id=Number(candidate?.id);if(!Number.isFinite(id))return;
      try{
        const params=new URLSearchParams({shipping_method_id:String(id),weight:String(Number(weightKg.toFixed(3))),weight_unit:'kilogram',from_country:fromCountry,to_country:toCountry});
        const {data:pricePayload}=await sendcloudJson(credentials,`https://panel.sendcloud.sc/api/v2/shipping-price/?${params.toString()}`);
        const rows=Array.isArray(pricePayload)?pricePayload:v2Rows(pricePayload);
        const row=rows.find((item:any)=>clean(item?.to_country||item?.country||item?.iso_2).toUpperCase()===toCountry)||rows[0]||pricePayload;
        const raw=row?.price??row?.value??row?.total_price;
        const value=Number(typeof raw==='object'?raw?.value:raw);
        if(Number.isFinite(value)&&value>0){
          option.price=value;
          option.currency=clean((typeof raw==='object'?raw?.currency:null)||row?.currency)||'EUR';
          option.priceSource='sendcloud_v2_price';
        }
      }catch{/* Direct-contract or postal-zone pricing can legitimately be unavailable. */}
    }));
  }catch{/* Shipping options remain usable without an API price. */}
  return options;
}

async function senderAddress(credentials:SendcloudCredentials){
  try{const {data}=await sendcloudJson(credentials,'/addresses/sender-addresses');return Array.isArray(data?.data)?data.data[0]||null:null}catch{return null}
}
function configuredSender(shipping:any){
  const country=clean(shipping?.senderCountryCode).toUpperCase(),postal=clean(shipping?.senderPostalCode),city=clean(shipping?.senderCity),address=clean(shipping?.senderAddress);
  if(!country&&!postal&&!city&&!address)return null;
  return {country_code:country||undefined,postal_code:postal||undefined,city:city||undefined,address_line_1:address||undefined};
}
function enabledCarrier(option:any,enabled:unknown){
  const values=Array.isArray(enabled)?enabled.map(value=>clean(value).toLowerCase()).filter(Boolean):[];
  if(!values.length)return true;
  const haystack=`${option?.carrierCode||''} ${option?.carrierName||''} ${option?.code||''} ${option?.name||''}`.toLowerCase();
  return values.some(value=>haystack.includes(value));
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});if(req.method!=='POST')return fail('Método no permitido.',405);
  const url=Deno.env.get('SUPABASE_URL')||'',adminKey=getAdminKey();if(!url||!adminKey)return fail('Configuración del backend no disponible.',500);
  const admin=createClient(url,adminKey,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    const caller=await authenticate(req,admin),body=await req.json().catch(()=>({})),action=clean(body?.action),config=await workspaceConfig(admin,caller.data_owner_id),ordersConfig=config.orders,shippingConfig=config.shipping;
    const orderId=clean(body?.orderId);if(!orderId)return fail('Falta el pedido.');
    const {data:order,error}=await admin.from('fulfillment_orders').select('*').eq('id',orderId).eq('owner_id',caller.data_owner_id).maybeSingle();if(error)throw error;if(!order)return fail('Pedido no encontrado.',404);
    const orderCredentials=await credentialsForOrder(admin,caller.data_owner_id,order.shipping_integration_account_id||null);
    const sendcloudOrderId=remoteSendcloudId(order);if(!sendcloudOrderId)return fail('El pedido no tiene identificador remoto de Sendcloud.',409);

    if(action==='validate_address'){
      const address=order.shipping_address||{},carrierCode=clean(body?.carrierCode||ordersConfig.defaultCarrier||'mrw').toLowerCase();
      const normalizedState=normalizeStateProvince(address.country_code,address.state_province_code);
      const payloadAddress:any={
        address_line_1:address.address_line_1||undefined,
        house_number:address.house_number||undefined,
        address_line_2:address.address_line_2||undefined,
        postal_code:address.postal_code||undefined,
        city:address.city||undefined,
        country_code:address.country_code||undefined,
      };
      if(normalizedState)payloadAddress.state_province_code=normalizedState;
      try{
        const {data}=await sendcloudJson(orderCredentials,'/addresses/validate',{method:'POST',body:JSON.stringify({address:payloadAddress,carrier_code:carrierCode})});
        const results=Array.isArray(data?.results)?data.results:[];
        const recommended=results.find((item:any)=>item?.recommended)||results[0]||null;
        const reasons=results.flatMap((item:any)=>Array.isArray(item?.analysis?.validation_result?.reasons)?item.analysis.validation_result.reasons:[]).map(clean).filter(Boolean);
        const invalidAttributes=results.flatMap((item:any)=>Array.isArray(item?.analysis?.invalid_attributes)?item.analysis.invalid_attributes:[]).map(clean).filter(Boolean);
        // Sendcloud address validation is advisory. A false result can still
        // produce valid shipping options and labels, so only expose definitive
        // success. Shipping-options and label creation remain authoritative.
        return response({
          ok:true,
          inputAddressIsValid:data?.input_address_is_valid===true?true:null,
          recommendedAddress:recommended?.address||null,
          reasons,
          invalidAttributes,
        });
      }catch(validationError){
        return response({
          ok:true,
          inputAddressIsValid:null,
          recommendedAddress:null,
          reasons:[validationError instanceof Error?validationError.message:String(validationError)],
          invalidAttributes:[],
        });
      }
    }

    if(action==='shipping_options'){
      if(!canEdit(order.source_status)||order.sendcloud_parcel_id)return fail('Este pedido ya no admite una nueva etiqueta.',409);
      let address=order.shipping_address||{};const sender=configuredSender(shippingConfig)||await senderAddress(orderCredentials),weightKg=orderWeightKg(order,shippingConfig.fallbackWeightKg);
      const normalizedState=normalizeStateProvince(address.country_code,address.state_province_code);
      if(clean(address.state_province_code)!==clean(normalizedState)){
        const correctedAddress={...address,state_province_code:normalizedState};
        try{
          const {data:patched}=await sendcloudJson(orderCredentials,`/orders/${encodeURIComponent(sendcloudOrderId)}`,{method:'PATCH',body:JSON.stringify({shipping_address:correctedAddress})});
          address=patched?.data?.shipping_address||correctedAddress;
          const raw=order.raw_payload||{},newRaw={...raw,...(patched?.data||{}),shipping_address:address};
          await admin.from('fulfillment_orders').update({shipping_address:address,raw_payload:newRaw,last_synced_at:new Date().toISOString()}).eq('id',order.id).eq('owner_id',caller.data_owner_id);
        }catch{/* La cotización seguirá con la dirección saneada */}
      }
      const toAddress:any={
        country_code:address.country_code||undefined,
        postal_code:address.postal_code||undefined,
        city:address.city||undefined,
        address_line_1:address.address_line_1||undefined,
        house_number:address.house_number||undefined,
      };
      const toState=normalizeStateProvince(address.country_code,address.state_province_code);if(toState)toAddress.state_province_code=toState;
      const fromCountry=clean(sender?.country_code||shippingConfig.senderCountryCode||ordersConfig.originCountryCode||'ES').toUpperCase();
      const fromPostal=clean(sender?.postal_code||shippingConfig.senderPostalCode);
      const requestBody:any={
        calculate_quotes:true,
        from_country_code:fromCountry,
        to_country_code:clean(address.country_code).toUpperCase(),
        from_postal_code:fromPostal||undefined,
        to_postal_code:clean(address.postal_code)||undefined,
        parcels:[{
          weight:{value:Number(weightKg.toFixed(3)),unit:'kg'},
          dimensions:{
            length:String(Math.max(1,Number(shippingConfig.packageLengthCm)||30)),
            width:String(Math.max(1,Number(shippingConfig.packageWidthCm)||20)),
            height:String(Math.max(1,Number(shippingConfig.packageHeightCm)||10)),
            unit:'cm',
          },
        }],
      };
      const {data}=await sendcloudJson(orderCredentials,'/shipping-options',{method:'POST',body:JSON.stringify(requestBody)});
      const options=(data?.data||[]).map((item:any)=>normalizeOption(item,weightKg)).filter((x:any)=>x.code).filter((x:any)=>enabledCarrier(x,shippingConfig.enabledCarriers));
      await enrichSendcloudV3Quotes(orderCredentials,options,weightKg,requestBody);
      await enrichSendcloudPrices(orderCredentials,options,weightKg,fromCountry,clean(address.country_code).toUpperCase());
      const priced=options.filter((option:any)=>option.price!=null&&Number(option.price)>0).length;
      const unpricedCorreos=options.some((option:any)=>option.price==null&&/correos/i.test(`${option.carrierCode} ${option.carrierName}`));
      const quoteMessage=unpricedCorreos
        ?'Sendcloud devuelve servicios de Correos pero no una tarifa para este contrato. ZENVIA ha reintentado la cotización V3 por contrato; si sigue sin precio, Sendcloud no está exponiendo una tarifa cargada para ese método.'
        :priced?null:(options.length?'Sendcloud devuelve los servicios disponibles, pero no expone precio para estos métodos o contratos.':'No hay servicios disponibles entre los transportistas habilitados.');
      return response({weightKg,options,message:data?.message||quoteMessage});
    }

    if(action==='update_order'){
      if(!canEdit(order.source_status)||order.sendcloud_parcel_id)return fail('Solo puedes editar pedidos pendientes antes de crear la etiqueta.',409);
      const input=body?.order||{},current=order.shipping_address||{};
      const name=clean(input.customerName||current.name||order.customer_name),companyName=clean(input.companyName??current.company_name),email=clean(input.email??current.email??order.customer_email),phone=clean(input.phone??current.phone_number??order.customer_phone);
      const address1=clean(input.address??current.address_line_1),houseNumber=clean(input.houseNumber??current.house_number),address2=clean(input.address2??current.address_line_2),postalCode=clean(input.postalCode??current.postal_code),city=clean(input.city??current.city),countryCode=clean(input.countryCode??current.country_code).toUpperCase();
      const stateInput=clean(input.stateProvince??current.state_province_code),stateProvince=normalizeStateProvince(countryCode,stateInput);
      const weightKg=Number(input.weightKg);if(!name||!address1||!postalCode||!city||countryCode.length!==2)return fail('Completa nombre, dirección, código postal, ciudad y país.');if(!Number.isFinite(weightKg)||weightKg<=0)return fail('El peso debe ser mayor que 0.');
      const lengthCm=Number(input.packageLengthCm),widthCm=Number(input.packageWidthCm),heightCm=Number(input.packageHeightCm);
      const hasDimensions=[lengthCm,widthCm,heightCm].every(value=>Number.isFinite(value)&&value>0);
      const shippingAddress={...current,name,company_name:companyName||null,address_line_1:address1,house_number:houseNumber||null,address_line_2:address2||null,postal_code:postalCode,city,state_province_code:stateProvince,country_code:countryCode,email:email||null,phone_number:phone||null};
      const raw=order.raw_payload||{},shippingDetails={...(raw.shipping_details||{}),measurement:{...(raw.shipping_details?.measurement||{}),weight:{value:Number(weightKg.toFixed(3)),unit:'kg'},...(hasDimensions?{dimension:{length:Number(lengthCm.toFixed(1)),width:Number(widthCm.toFixed(1)),height:Number(heightCm.toFixed(1)),unit:'cm'}}:{})}};
      const customerDetails={...(raw.customer_details||{}),name,email:email||null,phone_number:phone||null};
      const patch={shipping_address:shippingAddress,shipping_details:shippingDetails,customer_details:customerDetails};
      const {data}=await sendcloudJson(orderCredentials,`/orders/${encodeURIComponent(sendcloudOrderId)}`,{method:'PATCH',body:JSON.stringify(patch)});
      const remote=data?.data||{},now=new Date().toISOString(),newRaw={...raw,...remote,shipping_address:remote.shipping_address||shippingAddress,shipping_details:remote.shipping_details||shippingDetails,customer_details:remote.customer_details||customerDetails};
      const {error:updateError}=await admin.from('fulfillment_orders').update({
        customer_name:name,customer_email:email||null,customer_phone:phone||null,shipping_address:remote.shipping_address||shippingAddress,raw_payload:newRaw,
        package_length_cm:hasDimensions?lengthCm:null,package_width_cm:hasDimensions?widthCm:null,package_height_cm:hasDimensions?heightCm:null,
        order_updated_at:remote?.order_details?.order_updated_at||remote?.modified_at||now,last_synced_at:now,
      }).eq('id',order.id).eq('owner_id',caller.data_owner_id);if(updateError)throw updateError;
      return response({ok:true,weightKg,stateProvince,dimensions:hasDimensions?{lengthCm,widthCm,heightCm}:null});
    }
    return fail('Acción no válida.');
  }catch(error){const message=error instanceof Error?error.message:String(error||'Error interno.');const status=/Sesión no válida/.test(message)?401:/permiso/.test(message)?403:/Solo puedes|no admite/.test(message)?409:500;return fail(message,status)}
});
