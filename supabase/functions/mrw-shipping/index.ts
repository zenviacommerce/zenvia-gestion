import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const headers={...corsHeaders,'Content-Type':'application/json'};
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
const clean=(value:unknown)=>String(value??'').trim();
const esc=(value:unknown)=>clean(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
function getAdminKey(){
  const raw=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(raw){try{const parsed=JSON.parse(raw);if(typeof parsed?.default==='string'&&parsed.default.trim())return parsed.default.trim()}catch{}}
  return clean(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
}
async function authenticate(req:Request,admin:any){
  const token=clean(req.headers.get('Authorization')).replace(/^Bearer\s+/i,'');
  if(!token)throw new Error('Sesión no válida.');
  const {data:userData,error:userError}=await admin.auth.getUser(token);
  if(userError||!userData?.user)throw new Error('Sesión no válida.');
  const {data:caller,error}=await admin.from('app_users').select('user_id,data_owner_id,role,active,permissions').eq('user_id',userData.user.id).maybeSingle();
  if(error)throw error;
  if(!caller?.active)throw new Error('Tu acceso está desactivado.');
  const permissions=Array.isArray(caller.permissions)?caller.permissions:[];
  if(caller.role!=='admin'&&!permissions.includes('orders'))throw new Error('No tienes permiso para gestionar pedidos.');
  return caller;
}
async function readVault(admin:any,secretId:string){
  const {data,error}=await admin.rpc('integration_read_secret',{p_secret_id:secretId});
  if(error)throw error;
  try{return JSON.parse(String(data||'{}'))}catch{throw new Error('Las credenciales MRW almacenadas no son válidas.')}
}
async function mrwAccount(admin:any,ownerId:string,wantedId=''){
  let query=admin.from('integration_accounts').select('*').eq('owner_id',ownerId).eq('provider','mrw').eq('enabled',true).neq('status','disabled');
  if(wantedId)query=query.eq('id',wantedId);else query=query.order('is_default',{ascending:false}).order('updated_at',{ascending:false}).limit(1);
  const {data,error}=await query.maybeSingle();if(error)throw error;
  if(!data)return null;
  if(!data.secret_id)throw new Error('La cuenta MRW no tiene credenciales.');
  const stored=await readVault(admin,data.secret_id);
  const credentials={
    franchiseCode:clean(stored.franchiseCode||stored.codigoFranquicia),
    subscriberCode:clean(stored.subscriberCode||stored.codigoAbonado),
    departmentCode:clean(stored.departmentCode||stored.codigoDepartamento),
    username:clean(stored.username||stored.userName||stored.usuario),
    password:clean(stored.password),
  };
  if(!credentials.franchiseCode||!credentials.subscriberCode||!credentials.username||!credentials.password){
    throw new Error('Faltan credenciales MRW: franquicia, abonado, usuario o contraseña.');
  }
  return {row:data,credentials,config:data.config||{}};
}
function mrwBase(environment:unknown){
  return clean(environment)==='test'?'https://sagec-test.mrw.es/mrwenvio.asmx':'https://sagec.mrw.es/mrwenvio.asmx';
}
function authXml(c:any){
  return `<AuthInfo xmlns="http://www.mrw.es/"><CodigoFranquicia>${esc(c.franchiseCode)}</CodigoFranquicia><CodigoAbonado>${esc(c.subscriberCode)}</CodigoAbonado><CodigoDepartamento>${esc(c.departmentCode)}</CodigoDepartamento><UserName>${esc(c.username)}</UserName><Password>${esc(c.password)}</Password></AuthInfo>`;
}
function envelope(c:any,body:string){
  return `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Header>${authXml(c)}</soap:Header><soap:Body>${body}</soap:Body></soap:Envelope>`;
}
function xmlValue(xml:string,tag:string){
  const match=xml.match(new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`,'i'));
  return match?match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').trim():'';
}
function soapError(xml:string){
  return xmlValue(xml,'faultstring')||xmlValue(xml,'Message')||xmlValue(xml,'Mensaje')||xmlValue(xml,'DescripcionError')||'';
}
function envelope12(c:any,body:string){
  return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Header>${authXml(c)}</soap12:Header><soap12:Body>${body}</soap12:Body></soap12:Envelope>`;
}
async function soapAttempt(base:string,c:any,action:string,body:string,protocol:'1.1'|'1.2'){
  const actionUri=`http://www.mrw.es/${action}`;
  const headers:Record<string,string>=protocol==='1.2'
    ?{'Content-Type':`application/soap+xml; charset=utf-8; action="${actionUri}"`,Accept:'application/soap+xml,text/xml'}
    :{'Content-Type':'text/xml; charset=utf-8','SOAPAction':`"${actionUri}"`,Accept:'text/xml'};
  const res=await fetch(base,{method:'POST',headers,body:protocol==='1.2'?envelope12(c,body):envelope(c,body)});
  const xml=await res.text();
  return {res,xml,fault:soapError(xml),protocol};
}
async function soapCall(base:string,c:any,action:string,body:string){
  const diagnostics:string[]=[];
  for(const protocol of ['1.1','1.2'] as const){
    const {res,xml,fault}=await soapAttempt(base,c,action,body,protocol);
    if(fault)throw new Error(`MRW: ${fault.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,800)}`);
    if(res.ok)return xml;
    diagnostics.push(`SOAP ${protocol}: HTTP ${res.status} ${res.headers.get('content-type')||''}`.trim());
  }
  throw new Error(`MRW no ha procesado la solicitud. ${diagnostics.join(' · ')}. Revisa que la cuenta MRW esté habilitada para Web Services.`);
}
function positive(value:unknown){const n=Number(value);return Number.isFinite(n)&&n>0?n:null}
function orderWeight(order:any,fallback:number){
  const w=order?.raw_payload?.shipping_details?.measurement?.weight;
  const n=Number(w?.value),unit=clean(w?.unit).toLowerCase();
  if(Number.isFinite(n)&&n>0)return unit==='g'?n/1000:(unit==='lbs'||unit==='lb'?n*0.45359237:n);
  return Math.max(.01,Number(fallback)||1);
}
function phone(value:unknown){return clean(value).replace(/[^0-9+]/g,'').slice(0,20)}
function todayMrw(){const d=new Date();return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`}
async function workspaceSettings(admin:any,ownerId:string){
  const [{data:app},{data:business}]=await Promise.all([
    admin.from('app_settings').select('config').eq('owner_id',ownerId).maybeSingle(),
    admin.from('business_settings').select('*').eq('owner_id',ownerId).maybeSingle(),
  ]);
  return {shipping:app?.config?.shipping||{},orders:app?.config?.orders||{},business:business||{}};
}
function sender(settings:any,config:any){
  const shipping=settings.shipping||{},business=settings.business||{};
  return {
    name:clean(config.senderName||shipping.senderName||business.trade_name||business.legal_name||'ZENVIA'),
    address:clean(config.senderAddress||shipping.senderAddress||business.address_line1),
    postalCode:clean(config.senderPostalCode||shipping.senderPostalCode||business.postal_code),
    city:clean(config.senderCity||shipping.senderCity||business.city),
    countryCode:clean(config.senderCountryCode||shipping.senderCountryCode||business.country_code||'ES').toUpperCase(),
    phone:phone(config.senderPhone||business.phone),
  };
}
function mrwOption(account:any){
  const code=clean(account.config?.serviceCode)||'0205';
  const name=clean(account.config?.serviceName)||'MRW Urgent 19:00';
  return {
    provider:'mrw',providerName:'MRW Directo',integrationAccountId:account.row.id,integrationAccountName:account.row.display_name,
    code,name,carrierCode:'mrw',carrierName:'MRW',contractId:null,price:null,currency:'EUR',raw:{direct:true,serviceCode:code},
  };
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return response({error:'Método no permitido.'},405);
  const url=clean(Deno.env.get('SUPABASE_URL')),key=getAdminKey();if(!url||!key)return response({error:'Configuración interna no disponible.'},500);
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    const caller=await authenticate(req,admin),body=await req.json().catch(()=>({})),action=clean(body?.action);
    const account=await mrwAccount(admin,caller.data_owner_id,clean(body?.integrationAccountId||body?.shippingOption?.integrationAccountId));
    if(action==='status')return response({ok:true,configured:Boolean(account),accounts:account?[{id:account.row.id,displayName:account.row.display_name,environment:account.config?.environment==='test'?'test':'production',isDefault:Boolean(account.row.is_default)}]:[]});
    if(!account)return response({configured:false,options:[],message:'MRW directo no está configurado.'});

    const orderId=clean(body?.orderId);if(!orderId)return response({error:'Falta el pedido.'},400);
    const {data:order,error}=await admin.from('fulfillment_orders').select('*').eq('owner_id',caller.data_owner_id).eq('id',orderId).maybeSingle();
    if(error)throw error;if(!order)return response({error:'Pedido no encontrado.'},404);

    if(action==='options')return response({configured:true,options:[mrwOption(account)]});

    const base=mrwBase(account.config?.environment);
    if(action==='create_label'){
      const address=order.shipping_address||{},settings=await workspaceSettings(admin,caller.data_owner_id),from=sender(settings,account.config);
      const length=positive(order.package_length_cm),width=positive(order.package_width_cm),height=positive(order.package_height_cm),weight=orderWeight(order,settings.shipping?.fallbackWeightKg||1);
      if(!clean(address.name||order.customer_name)||!clean(address.address_line_1)||!clean(address.postal_code)||!clean(address.city))return response({error:'Faltan datos obligatorios del destinatario para MRW.'},409);
      if(!from.address||!from.postalCode||!from.city)return response({error:'Completa la dirección del remitente en Configuración > Envíos antes de usar MRW directo.'},409);
      const serviceCode=clean(body?.shippingOption?.code||account.config?.serviceCode)||'0205';
      const serviceName=clean(body?.shippingOption?.name||account.config?.serviceName)||'MRW Urgent 19:00';
      const requiresDimensions=/^(0200|0205|0220)$/.test(serviceCode)||/urgente\s*19/i.test(serviceName);
      if(requiresDimensions&&(!length||!width||!height))return response({error:'MRW requiere largo, ancho y alto para Urgente 19. Otros servicios pueden generarse solo con el peso.',code:'missing_dimensions'},409);
      const dimensionsXml=length&&width&&height?`<Alto>${height}</Alto><Largo>${length}</Largo><Ancho>${width}</Ancho><Dimension>cm</Dimension>`:'';
      const request=`<TransmEnvio xmlns="http://www.mrw.es/"><request><DatosRecogida><Direccion><Via>${esc(from.address)}</Via><CodigoPostal>${esc(from.postalCode)}</CodigoPostal><Poblacion>${esc(from.city)}</Poblacion><CodigoPais>${esc(from.countryCode)}</CodigoPais></Direccion><Nombre>${esc(from.name)}</Nombre><Telefono>${esc(from.phone)}</Telefono></DatosRecogida><DatosEntrega><Direccion><Via>${esc(address.address_line_1)}</Via><Numero>${esc(address.house_number)}</Numero><Resto>${esc(address.address_line_2)}</Resto><CodigoPostal>${esc(address.postal_code)}</CodigoPostal><Poblacion>${esc(address.city)}</Poblacion><Provincia>${esc(address.state_province_code)}</Provincia><CodigoPais>${esc(address.country_code||'ES')}</CodigoPais></Direccion><Nombre>${esc(address.name||order.customer_name)}</Nombre><Telefono>${esc(address.phone_number||order.customer_phone)}</Telefono><ALaAtencionDe>${esc(address.company_name)}</ALaAtencionDe></DatosEntrega><DatosServicio><Fecha>${todayMrw()}</Fecha><Referencia>${esc(order.order_number||order.order_id||order.id)}</Referencia><CodigoServicio>${esc(serviceCode)}</CodigoServicio><Bultos><BultoRequest>${dimensionsXml}<Referencia>${esc(order.order_number||'')}</Referencia><Peso>${weight.toFixed(3)}</Peso><NumeroBulto>1</NumeroBulto></BultoRequest></Bultos><NumeroBultos>1</NumeroBultos><Peso>${weight.toFixed(3)}</Peso><TipoMercancia>Documentos y mercancía</TipoMercancia><CodigoMoneda>EUR</CodigoMoneda></DatosServicio></request></TransmEnvio>`;
      const transmit=await soapCall(base,account.credentials,'TransmEnvio',request);
      const shipment=xmlValue(transmit,'NumeroEnvio');if(!shipment)throw new Error('MRW no devolvió número de envío.');
      const labelRequest=`<GetEtiquetaEnvio xmlns="http://www.mrw.es/"><request><NumeroEnvio>${esc(shipment)}</NumeroEnvio><NumerosEtiqueta></NumerosEtiqueta><SeparadorNumerosEnvio></SeparadorNumerosEnvio><FechaInicioEnvio></FechaInicioEnvio><FechaFinEnvio></FechaFinEnvio><TipoEtiquetaEnvio>PDF</TipoEtiquetaEnvio><ReportTopMargin>0</ReportTopMargin><ReportLeftMargin>0</ReportLeftMargin></request></GetEtiquetaEnvio>`;
      const labelXml=await soapCall(base,account.credentials,'GetEtiquetaEnvio',labelRequest);
      const base64=xmlValue(labelXml,'EtiquetaFile');if(!base64)throw new Error('MRW creó el envío pero no devolvió el PDF de etiqueta.');
      const now=new Date().toISOString();
      const {error:updateError}=await admin.from('fulfillment_orders').update({
        shipping_provider:'mrw',shipping_integration_account_id:account.row.id,shipping_remote_id:shipment,
        tracking_number:shipment,tracking_status_code:'READY_TO_SEND',tracking_status_message:'Ready to send',tracking_updated_at:now,
        carrier_code:'mrw',carrier_name:'MRW',shipping_option_code:serviceCode,shipping_service_name:serviceName,label_created_at:now,
      }).eq('owner_id',caller.data_owner_id).eq('id',order.id);
      if(updateError)throw updateError;
      return response({parcelId:0,shipmentId:shipment,trackingNumber:shipment,trackingUrl:null,shippingOptionCode:serviceCode,contractId:null,carrierCode:'mrw',carrierName:'MRW',shippingServiceName:serviceName,mimeType:'application/pdf',base64});
    }

    if(action==='fetch_label'){
      const shipment=clean(order.shipping_remote_id||order.tracking_number);if(!shipment)return response({error:'El pedido no tiene número de envío MRW.'},409);
      const labelRequest=`<GetEtiquetaEnvio xmlns="http://www.mrw.es/"><request><NumeroEnvio>${esc(shipment)}</NumeroEnvio><NumerosEtiqueta></NumerosEtiqueta><SeparadorNumerosEnvio></SeparadorNumerosEnvio><FechaInicioEnvio></FechaInicioEnvio><FechaFinEnvio></FechaFinEnvio><TipoEtiquetaEnvio>PDF</TipoEtiquetaEnvio><ReportTopMargin>0</ReportTopMargin><ReportLeftMargin>0</ReportLeftMargin></request></GetEtiquetaEnvio>`;
      const labelXml=await soapCall(base,account.credentials,'GetEtiquetaEnvio',labelRequest),base64=xmlValue(labelXml,'EtiquetaFile');
      if(!base64)throw new Error('MRW no devolvió el PDF de etiqueta.');
      return response({parcelId:0,shipmentId:shipment,trackingNumber:shipment,trackingUrl:order.tracking_url||null,shippingOptionCode:order.shipping_option_code||null,contractId:null,carrierCode:'mrw',carrierName:'MRW',shippingServiceName:order.shipping_service_name||null,mimeType:'application/pdf',base64});
    }

    return response({error:'Acción no válida.'},400);
  }catch(error){
    const message=error instanceof Error?error.message:'Error interno.';
    return response({error:message},/Sesión no válida/.test(message)?401:/permiso/.test(message)?403:/requiere|Faltan|Completa|no tiene/.test(message)?409:500);
  }
});