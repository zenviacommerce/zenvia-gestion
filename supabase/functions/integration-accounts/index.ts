import { createClient } from 'npm:@supabase/supabase-js@2';
import { enforceWorkspaceLimit, requireWorkspaceEntitlement } from '../_shared/saas/entitlements.ts';
import { gmailAccessAllowed, gmailServerConfig, validateGmailOrigin, gmailTokenRequest, gmailProfileEmail, gmailConnectionFromToken, legacyGmailMigrationPlan } from '../_shared/gmailOAuth.ts';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-requested-with',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const headers={...corsHeaders,'Content-Type':'application/json'};
const PROVIDERS=new Set(['amazon','sendcloud','envia','mrw','shopify','gmail']);
const SENDCLOUD_BASE='https://panel.sendcloud.sc/api/v3';
const SP_API_BASE='https://sellingpartnerapi-eu.amazon.com';

type Caller={user_id:string;data_owner_id:string;role:string;active:boolean;permissions:string[]|null};
type Provider='amazon'|'sendcloud'|'envia'|'mrw'|'shopify'|'gmail';

function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers});}
function clean(v:unknown){return String(v??'').trim();}
function getAdminKey(){
  const secretKeys=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(secretKeys){try{const parsed=JSON.parse(secretKeys);if(typeof parsed?.default==='string'&&parsed.default.trim())return parsed.default.trim()}catch{/* fallback */}}
  return clean(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
}
function sanitize(value:unknown){
  return clean(value)
    .replace(/Atz[ar]\|[A-Za-z0-9._|\-]+/g,'[redacted-token]')
    .replace(/("(?:client_secret|refresh_token|access_token|secretKey|secret_key|token|apiToken)"\s*:\s*")([^"]+)(")/gi,'$1[redacted]$3')
    .slice(0,700);
}
async function authenticate(req:Request,admin:any,action:string):Promise<Caller>{
  const token=clean(req.headers.get('Authorization')).replace(/^Bearer\s+/i,'');
  if(!token)throw new Error('Sesión no válida.');
  const {data:userData,error:userError}=await admin.auth.getUser(token);
  if(userError||!userData?.user)throw new Error('Sesión no válida.');
  const {data:caller,error}=await admin.from('app_users')
    .select('user_id,data_owner_id,role,active,permissions')
    .eq('user_id',userData.user.id).maybeSingle();
  if(error)throw error;
  if(!caller?.active)throw new Error('Tu acceso está desactivado.');
  const {data:workspace,error:workspaceError}=await admin.from('workspaces').select('status').eq('id',caller.data_owner_id).maybeSingle();
  if(workspaceError)throw workspaceError;
  if(!workspace||!['active','trialing'].includes(workspace.status))throw new Error('El acceso de tu empresa está suspendido.');
  if(!gmailAccessAllowed(caller,action))throw new Error('Solo un administrador puede gestionar integraciones; consultar Gmail requiere permiso de Gastos.');
  return caller as Caller;
}
function publicAccount(row:any){
  return {
    id:row.id,
    provider:row.provider,
    displayName:row.display_name,
    externalAccountId:row.external_account_id,
    status:row.status,
    enabled:Boolean(row.enabled),
    isDefault:Boolean(row.is_default),
    credentialSource:row.credential_source,
    credentialsConfigured:Boolean(row.secret_id)||['environment','session','derived'].includes(row.credential_source),
    parentAccountId:row.parent_account_id,
    linkedResourceId:row.linked_resource_id,
    config:row.config||{},
    lastTestedAt:row.last_tested_at,
    lastSuccessAt:row.last_success_at,
    lastError:row.last_error,
    createdAt:row.created_at,
    updatedAt:row.updated_at,
  };
}
async function listAccounts(admin:any,ownerId:string){
  const {data,error}=await admin.from('integration_accounts')
    .select('*').eq('owner_id',ownerId).order('provider').order('is_default',{ascending:false}).order('display_name');
  if(error)throw error;
  return (data||[]).filter((account:any)=>!(account.provider==='gmail'&&account.config?.migratedToAccountId)).map(publicAccount);
}

async function consolidateLegacyGmail(admin:any,ownerId:string,target:any){
  const rows=await admin.from('integration_accounts').select('*').eq('owner_id',ownerId).eq('provider','gmail');
  if(rows.error)throw rows.error;
  const plan=legacyGmailMigrationPlan(rows.data||[],target);
  for(const id of plan.ids){
    const history=await admin.from('gmail_imports').update({integration_account_id:target.id}).eq('owner_id',ownerId).eq('integration_account_id',id);
    if(history.error)throw history.error;
    const old=rows.data.find((account:any)=>account.id===id);
    const archived=await admin.from('integration_accounts').update({enabled:false,status:'disabled',is_default:false,config:{...old.config,migratedToAccountId:target.id},updated_at:new Date().toISOString()}).eq('owner_id',ownerId).eq('id',id);
    if(archived.error)throw archived.error;
  }
  if(plan.transferDefault)await makeDefault(admin,ownerId,'gmail',target.id);
  return loadAccount(admin,ownerId,target.id);
}
async function readVault(admin:any,secretId:string|null){
  if(!secretId)return {};
  const {data,error}=await admin.rpc('integration_read_secret',{p_secret_id:secretId});
  if(error)throw error;
  try{return JSON.parse(String(data||'{}'))}catch{throw new Error('Las credenciales almacenadas no tienen un formato válido.')}
}
async function writeVault(admin:any,accountId:string,provider:Provider,credentials:Record<string,unknown>,existingId:string|null){
  const payload=JSON.stringify(credentials);
  const {data,error}=await admin.rpc('integration_store_secret',{
    p_secret:payload,
    p_name:`integration:${provider}:${accountId}`,
    p_description:`Credenciales cifradas para ${provider} (${accountId})`,
    p_existing_secret_id:existingId,
  });
  if(error)throw error;
  return String(data);
}

async function renewGmail(admin:any,account:any,forceRefresh=false){
  const config=gmailServerConfig();
  if(!config.persistent)throw new Error('La conexión persistente de Google no está habilitada. Contacta con el administrador de Zenvia.');
  const stored=await readVault(admin,account.secret_id);
  if(!stored.refreshToken)throw new Error('Renueva la autorización de esta cuenta desde Integraciones.');
  if(stored.clientId!==config.clientId)throw new Error('La configuración de Google ha cambiado. Renueva la cuenta en Integraciones.');
  if(!forceRefresh&&stored.accessToken&&Number(stored.expiresAt)>Date.now()+300000)return {email:account.external_account_id,accessToken:stored.accessToken,expiresAt:stored.expiresAt};
  const token=await gmailTokenRequest(new URLSearchParams({grant_type:'refresh_token',client_id:config.clientId,client_secret:config.clientSecret,refresh_token:stored.refreshToken}));
  const connection=gmailConnectionFromToken(token,account.external_account_id);
  await writeVault(admin,account.id,'gmail',{...stored,...connection,...(token.refresh_token?{refreshToken:token.refresh_token}:{})},account.secret_id);
  return connection;
}
async function loadAccount(admin:any,ownerId:string,id:string){
  const {data,error}=await admin.from('integration_accounts').select('*').eq('owner_id',ownerId).eq('id',id).maybeSingle();
  if(error)throw error;
  if(!data)throw new Error('Integración no encontrada.');
  return data;
}
async function makeDefault(admin:any,ownerId:string,provider:Provider,id:string){
  const clear=await admin.from('integration_accounts').update({is_default:false,updated_at:new Date().toISOString()}).eq('owner_id',ownerId).eq('provider',provider).neq('id',id);
  if(clear.error)throw clear.error;
  const set=await admin.from('integration_accounts').update({is_default:true,updated_at:new Date().toISOString()}).eq('owner_id',ownerId).eq('id',id);
  if(set.error)throw set.error;
}
function envAmazonCredentials(){
  const raw=clean(Deno.env.get('AMAZON_SPAPI_CREDENTIALS'));
  if(!raw)return {};
  try{return JSON.parse(raw)}catch{return {}}
}
async function amazonCredentials(admin:any,account:any){
  const stored=account.secret_id?await readVault(admin,account.secret_id):{};
  const env=envAmazonCredentials() as any;
  const legacyEnvironment=account.credential_source==='environment';
  const credentials={
    clientId:clean((stored as any).clientId||(stored as any).client_id||env.client_id||env.clientId),
    clientSecret:clean((stored as any).clientSecret||(stored as any).client_secret||env.client_secret||env.clientSecret),
    refreshToken:clean((stored as any).refreshToken||(stored as any).refresh_token||(legacyEnvironment?(env.refresh_token||env.refreshToken):'')),
    sellerId:clean((stored as any).sellerId||(stored as any).seller_id||account.external_account_id||(legacyEnvironment?(env.seller_id||env.sellerId):'')),
  };
  if(!credentials.clientId||!credentials.clientSecret||!credentials.refreshToken||!credentials.sellerId){
    throw new Error('Faltan credenciales de Amazon. Se necesitan Seller ID, refresh token y credenciales de la aplicación SP-API.');
  }
  return credentials;
}
async function amazonToken(c:any){
  const body=new URLSearchParams();
  body.set('grant_type','refresh_token');
  body.set('refresh_token',c.refreshToken);
  body.set('client_id',c.clientId);
  body.set('client_secret',c.clientSecret);
  const res=await fetch('https://api.amazon.com/auth/o2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body});
  const text=await res.text();let data:any={};try{data=JSON.parse(text)}catch{}
  if(!res.ok||!data?.access_token)throw new Error(`Amazon LWA (${res.status}): ${sanitize(data?.error_description||data?.error||text)}`);
  return String(data.access_token);
}
async function amazonParticipations(admin:any,ownerId:string,account:any){
  const credentials=await amazonCredentials(admin,account);
  const token=await amazonToken(credentials);
  const res=await fetch(`${SP_API_BASE}/sellers/v1/marketplaceParticipations`,{headers:{
    Accept:'application/json',
    'user-agent':'ZENVIA-Gestion/1.0 (Integration Manager)',
    'x-amz-access-token':token,
    'x-amz-date':new Date().toISOString().replace(/[:-]|\.\d{3}/g,''),
  }});
  const text=await res.text();let data:any={};try{data=JSON.parse(text)}catch{}
  if(!res.ok)throw new Error(`Amazon SP-API (${res.status}): ${sanitize(data?.errors?.[0]?.message||data?.message||text)}`);
  const rows=(data?.payload||[]).filter((x:any)=>x?.marketplace?.id&&x?.marketplace?.countryCode);
  const now=new Date().toISOString();
  let amazonAccountId=account.linked_resource_id as string|null;
  if(!amazonAccountId){
    const upsert=await admin.from('amazon_accounts').upsert({
      owner_id:ownerId,seller_id:credentials.sellerId,display_name:account.display_name||'Amazon',
      region:'EU',status:'connected',integration_account_id:account.id,updated_at:now,
    },{onConflict:'owner_id,seller_id'}).select('id').single();
    if(upsert.error)throw upsert.error;
    amazonAccountId=upsert.data.id;
    const link=await admin.from('integration_accounts').update({linked_resource_id:amazonAccountId}).eq('id',account.id).eq('owner_id',ownerId);
    if(link.error)throw link.error;
  }else{
    const update=await admin.from('amazon_accounts').update({status:'connected',display_name:account.display_name,updated_at:now,integration_account_id:account.id})
      .eq('id',amazonAccountId).eq('owner_id',ownerId);
    if(update.error)throw update.error;
  }
  const inactive=await admin.from('amazon_marketplaces').update({active:false,updated_at:now}).eq('owner_id',ownerId).eq('amazon_account_id',amazonAccountId);
  if(inactive.error)throw inactive.error;
  const markets=rows.map((item:any)=>({
    owner_id:ownerId,amazon_account_id:amazonAccountId,marketplace_id:String(item.marketplace.id),
    country_code:String(item.marketplace.countryCode||'').toUpperCase(),
    name:String(item.marketplace.name||item.marketplace.countryCode||item.marketplace.id),
    currency_code:String(item.marketplace.defaultCurrencyCode||'EUR').toUpperCase(),
    active:Boolean(item.participation?.isParticipating),updated_at:now,
  }));
  if(markets.length){
    const upsert=await admin.from('amazon_marketplaces').upsert(markets,{onConflict:'owner_id,amazon_account_id,marketplace_id'});
    if(upsert.error)throw upsert.error;
  }
  return {amazonAccountId,marketplaces:markets.filter((x:any)=>x.active)};
}
async function sendcloudCredentials(admin:any,account:any){
  const stored=account.secret_id?await readVault(admin,account.secret_id):{};
  let publicKey=clean((stored as any).publicKey||(stored as any).public_key);
  let secretKey=clean((stored as any).secretKey||(stored as any).secret_key);
  if(account.credential_source==='environment'){
    publicKey=publicKey||clean(Deno.env.get('SENDCLOUD_PUBLIC_KEY')||Deno.env.get('SENDCLOUD_API_KEY'));
    secretKey=secretKey||clean(Deno.env.get('SENDCLOUD_SECRET_KEY')||Deno.env.get('SENDCLOUD_API_SECRET'));
  }
  if(!publicKey||!secretKey)throw new Error('Faltan las claves Public y Secret de Sendcloud.');
  return {publicKey,secretKey};
}
async function enviaCredentials(admin:any,account:any){
  const stored=account.secret_id?await readVault(admin,account.secret_id):{};
  const token=clean((stored as any).token||(stored as any).apiToken||(stored as any).api_token);
  if(!token)throw new Error('Falta el token API de Envia.com.');
  const environment=account.config?.environment==='production'?'production':'sandbox';
  return {token,environment};
}
async function mrwCredentials(admin:any,account:any){
  const stored=account.secret_id?await readVault(admin,account.secret_id):{};
  const credentials={
    franchiseCode:clean((stored as any).franchiseCode||(stored as any).codigoFranquicia),
    subscriberCode:clean((stored as any).subscriberCode||(stored as any).codigoAbonado),
    departmentCode:clean((stored as any).departmentCode||(stored as any).codigoDepartamento),
    username:clean((stored as any).username||(stored as any).userName||(stored as any).usuario),
    password:clean((stored as any).password),
  };
  if(!credentials.franchiseCode||!credentials.subscriberCode||!credentials.username||!credentials.password)throw new Error('Faltan credenciales MRW: franquicia, abonado, usuario o contraseña.');
  return credentials;
}
function mrwEsc(value:unknown){return clean(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')}
function mrwResponseError(text:string,status:number){
  const fault=(text.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i)?.[1]
    ||text.match(/<Mensaje[^>]*>([\s\S]*?)<\/Mensaje>/i)?.[1]
    ||text.match(/<DescripcionError[^>]*>([\s\S]*?)<\/DescripcionError>/i)?.[1]
    ||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  if(fault)return `MRW: ${sanitize(fault)}`;
  if(/<!doctype html|<html[\s>]/i.test(text)){
    return `MRW (${status}) devolvió un error interno al validar la conexión. Las credenciales se han guardado, pero MRW no ha podido verificarlas todavía.`;
  }
  return `MRW (${status}): ${sanitize(text||'respuesta no válida')}`;
}
async function mrwGatewayRequest(payload:Record<string,unknown>){
  const url=clean(Deno.env.get('MRW_GATEWAY_URL')),secret=clean(Deno.env.get('MRW_GATEWAY_SECRET'));
  if(!url||!secret)return null;
  const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Zenvia-Gateway-Key':secret},body:JSON.stringify(payload)});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(`MRW gateway HTTP ${res.status}: ${sanitize((data as any)?.error||'respuesta no válida')}`);
  const upstreamStatus=Number((data as any)?.status||0);
  const contentType=clean((data as any)?.contentType);
  const bodyBase64=clean((data as any)?.bodyBase64);
  const body=bodyBase64?atob(bodyBase64):'';
  return {status:upstreamStatus,contentType,body};
}
async function testMrw(admin:any,ownerId:string,account:any){
  const creds=await mrwCredentials(admin,account);
  const environment=account.config?.environment==='test'?'test':'production';
  const base=environment==='test'?'https://sagec-test.mrw.es/MRWEnvio.asmx':'https://sagec.mrw.es/MRWEnvio.asmx';
  const auth=`<AuthInfo xmlns="http://www.mrw.es/"><CodigoFranquicia>${mrwEsc(creds.franchiseCode)}</CodigoFranquicia><CodigoAbonado>${mrwEsc(creds.subscriberCode)}</CodigoAbonado><CodigoDepartamento>${mrwEsc(creds.departmentCode)}</CodigoDepartamento><UserName>${mrwEsc(creds.username)}</UserName><Password>${mrwEsc(creds.password)}</Password></AuthInfo>`;

  // Use MRW's read-only GetPointsDB contract with a real destination postcode.
  // This verifies authentication without creating/cancelling shipments or requesting
  // labels for numbers that MRW may not consider native to this SAGEC account.
  const {data:recentOrders}=await admin.from('fulfillment_orders')
    .select('shipping_address,updated_at')
    .eq('owner_id',ownerId)
    .order('updated_at',{ascending:false})
    .limit(100);
  const postal=(recentOrders||[])
    .map((row:any)=>clean(row?.shipping_address?.postal_code).replace(/\s+/g,''))
    .find((value:string)=>/^\d{5}$/.test(value))||'28001';

  // MRW currently returns HTTP 500 for ?WSDL from public clients, while its
  // operation pages remain available. Do not use WSDL availability as a network test.
  const gatewayOperation=await mrwGatewayRequest({environment,method:'GET',resource:'operation'});
  let operationStatus:number,operationText:string;
  if(gatewayOperation){operationStatus=gatewayOperation.status;operationText=gatewayOperation.body}
  else{
    const operation=await fetch(base+'?op=GetPointsDB',{headers:{Accept:'text/html,application/xhtml+xml','User-Agent':'ZENVIA-Gestion/1.0'}});
    operationStatus=operation.status;operationText=await operation.text();
  }
  if(operationStatus<200||operationStatus>=300||!/GetPointsDB/i.test(operationText)){
    throw new Error(`MRW SAGEC no expone la página de operación GetPointsDB desde ${gatewayOperation?'el gateway Vercel':'nuestro servidor'} (HTTP ${operationStatus}).`);
  }
  const request=`<request><Point><codigoPoint></codigoPoint><CodigoPostal>${mrwEsc(postal)}</CodigoPostal></Point></request>`;
  const envelope=`<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Header>${auth}</soap:Header><soap:Body><GetPointsDB xmlns="http://www.mrw.es/">${request}</GetPointsDB></soap:Body></soap:Envelope>`;
  const gatewaySoap=await mrwGatewayRequest({environment,method:'POST',operation:'GetPointsDB',soapVersion:'1.1',body:envelope});
  const directRes=gatewaySoap?null:await fetch(base,{method:'POST',headers:{'Content-Type':'text/xml; charset=utf-8','SOAPAction':'"http://www.mrw.es/GetPointsDB"',Accept:'text/xml','User-Agent':'ZENVIA-Gestion/1.0'},body:envelope});
  const status=gatewaySoap?gatewaySoap.status:directRes!.status;
  const responseContentType=gatewaySoap?gatewaySoap.contentType:(directRes!.headers.get('content-type')||'');
  const raw=gatewaySoap?gatewaySoap.body:await directRes!.text();
  const fault=(raw.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i)?.[1]
    ||raw.match(/<Mensaje[^>]*>([\s\S]*?)<\/Mensaje>/i)?.[1]
    ||raw.match(/<DescripcionError[^>]*>([\s\S]*?)<\/DescripcionError>/i)?.[1]
    ||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  const title=(raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  const bodyText=raw.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();

  if(status>=200&&status<300&&/GetPointsDBResponse/i.test(raw)){
    return {environment,apiMode:'modern',validationOperation:'GetPointsDB',soap:'1.1',postalCode:postal};
  }
  if(fault){
    if(/usuario|password|contrase|abonado|franquicia|autent|credencial|acceso|login|unauthorized|no autorizado/i.test(fault)){
      throw new Error(`MRW ha rechazado las credenciales: ${sanitize(fault)}`);
    }
    // A business SOAP fault means MRW authenticated and parsed the request.
    return {environment,apiMode:'modern',validationOperation:'GetPointsDB-fault',soap:'1.1',detail:sanitize(fault),postalCode:postal};
  }
  const htmlDetail=sanitize(title||bodyText||'sin detalle');
  throw new Error(`El WSDL de MRW SAGEC es accesible desde ${gatewaySoap?'el gateway de IP fija':'ZENVIA'}, pero la llamada SOAP autenticada devuelve HTTP ${status} (${responseContentType||'sin content-type'}): ${htmlDetail}.`);
}
async function enviaCarriers(admin:any,account:any){
  const c=await enviaCredentials(admin,account);
  const base=c.environment==='production'?'https://queries.envia.com':'https://queries.test.envia.com';
  const res=await fetch(`${base}/carrier?country_code=ES`,{headers:{Authorization:`Bearer ${c.token}`,Accept:'application/json'}});
  const text=await res.text();let data:any={};try{data=JSON.parse(text)}catch{}
  if(!res.ok)throw new Error(`Envia.com (${res.status}): ${sanitize(data?.message||data?.error||text)}`);
  const rows=Array.isArray(data?.data)?data.data:Array.isArray(data)?data:[];
  return rows;
}
async function sendcloudIntegrations(admin:any,account:any){
  const c=await sendcloudCredentials(admin,account);
  const auth=`Basic ${btoa(`${c.publicKey}:${c.secretKey}`)}`;
  const res=await fetch(`${SENDCLOUD_BASE}/integrations`,{headers:{Authorization:auth,Accept:'application/json'}});
  const text=await res.text();let data:any={};try{data=JSON.parse(text)}catch{}
  if(!res.ok)throw new Error(`Sendcloud (${res.status}): ${sanitize(data?.message||data?.error||text)}`);
  return (data?.data||[]).map((item:any)=>{
    const value=`${item?.type||''} ${item?.shop_name||''} ${item?.shop_url||''}`.toLowerCase();
    return {
      id:Number(item.id),shopName:String(item.shop_name||item.type||`Integración ${item.id}`),
      type:String(item.type||''),shopUrl:item.shop_url||null,
      channel:value.includes('shopify')?'shopify':value.includes('amazon')?'amazon':'other',
    };
  });
}
function normalizeShopifyDomain(value:unknown){
  return clean(value).toLowerCase().replace(/^https?:\/\//,'').replace(/\/+$/,'');
}
async function shopifyCredentials(admin:any,account:any){
  const stored=account.secret_id?await readVault(admin,account.secret_id):{};
  const shopDomain=normalizeShopifyDomain((stored as any).shopDomain||(stored as any).shop_domain||account.external_account_id||account.config?.shopDomain);
  const accessToken=clean((stored as any).accessToken||(stored as any).access_token);
  const apiVersion=clean(account.config?.apiVersion)||'2026-07';
  if(!shopDomain||!accessToken)throw new Error('Faltan dominio y access token de Shopify.');
  return {shopDomain,accessToken,apiVersion};
}
async function shopifyGraphql(admin:any,account:any,query:string,variables:Record<string,unknown>={}){
  const credentials=await shopifyCredentials(admin,account);
  const res=await fetch(`https://${credentials.shopDomain}/admin/api/${credentials.apiVersion}/graphql.json`,{
    method:'POST',
    headers:{'Content-Type':'application/json','Accept':'application/json','X-Shopify-Access-Token':credentials.accessToken},
    body:JSON.stringify({query,variables}),
  });
  const text=await res.text();let data:any={};try{data=JSON.parse(text)}catch{}
  if(!res.ok)throw new Error(`Shopify (${res.status}): ${sanitize(data?.errors?.[0]?.message||text)}`);
  if(Array.isArray(data?.errors)&&data.errors.length)throw new Error(`Shopify: ${sanitize(data.errors.map((item:any)=>item?.message).filter(Boolean).join(' · '))}`);
  return {data,credentials};
}
async function testAccount(admin:any,ownerId:string,account:any){
  const now=new Date().toISOString();
  try{
    let detail:any={};
    if(account.provider==='amazon'){
      const result=await amazonParticipations(admin,ownerId,account);
      detail={marketplaces:result.marketplaces.length};
    }else if(account.provider==='sendcloud'){
      const integrations=await sendcloudIntegrations(admin,account);
      detail={integrations:integrations.length};
    }else if(account.provider==='envia'){
      const carriers=await enviaCarriers(admin,account);
      detail={carriers:carriers.length,environment:account.config?.environment==='production'?'production':'sandbox'};
    }else if(account.provider==='mrw'){
      detail=await testMrw(admin,ownerId,account);
    }else if(account.provider==='shopify'){
      const result=await shopifyGraphql(admin,account,'query ZenviaShopIdentity { shop { id name myshopifyDomain } }');
      const shop=result.data?.data?.shop;
      if(!shop?.id)throw new Error('Shopify no devolvió la identidad de la tienda.');
      detail={shopName:shop.name,shopUrl:shop.myshopifyDomain,apiVersion:result.credentials.apiVersion};
    }else if(account.provider==='gmail'){
      if(account.credential_source==='vault'){
        const connection=await renewGmail(admin,account);
        if(await gmailProfileEmail(connection.accessToken)!==account.external_account_id.toLowerCase())throw new Error('La autorización no corresponde al buzón guardado.');
      }
      detail={requiresBrowserSession:account.credential_source!=='vault'};
    }
    const nextConfig=account.provider==='mrw'&&detail?.apiMode?{...(account.config||{}),apiMode:detail.apiMode,soapVersion:detail.soap||null}:account.config;
    const update=await admin.from('integration_accounts').update({
      status:'connected',last_tested_at:now,last_success_at:now,last_error:null,updated_at:now,config:nextConfig,
    }).eq('id',account.id).eq('owner_id',ownerId);
    if(update.error)throw update.error;
    return {ok:true,checkedAt:now,detail};
  }catch(error){
    const message=sanitize(error instanceof Error?error.message:error);
    await admin.from('integration_accounts').update({status:'error',last_tested_at:now,last_error:message,updated_at:now})
      .eq('id',account.id).eq('owner_id',ownerId);
    throw new Error(message||'No se pudo comprobar la integración.');
  }
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return response({error:'Método no permitido.'},405);
  const url=clean(Deno.env.get('SUPABASE_URL')),key=getAdminKey();
  if(!url||!key)return response({error:'Configuración interna de Supabase no disponible.'},500);
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    const body=await req.json().catch(()=>({}));
    const action=clean(body?.action||'list');
    const caller=await authenticate(req,admin,action);

    if(action.startsWith('gmail_')){
      await requireWorkspaceEntitlement(admin,caller.data_owner_id,'integration.gmail','Tu plan no incluye la integración con Gmail.');
      if(action==='gmail_list')return response({accounts:(await listAccounts(admin,caller.data_owner_id)).filter((account:any)=>account.provider==='gmail')});
      if(action==='gmail_config'){
        const config=gmailServerConfig();
        return response({persistent:config.persistent,...(config.persistent?{clientId:config.clientId}:{})});
      }
      if(action==='gmail_consolidate'){
        const account=await loadAccount(admin,caller.data_owner_id,clean(body.id));
        return response({account:publicAccount(await consolidateLegacyGmail(admin,caller.data_owner_id,account))});
      }
      if(action==='gmail_token'){
        const account=await loadAccount(admin,caller.data_owner_id,clean(body.id));
        if(account.provider!=='gmail'||!account.enabled||account.status==='disabled')throw new Error('La cuenta de Gmail está desactivada o no es válida.');
        return response({connection:await renewGmail(admin,account,true)});
      }
      if(action==='gmail_exchange'){
        const config=gmailServerConfig();
        if(!config.persistent)throw new Error('La conexión persistente de Google no está habilitada.');
        const origin=validateGmailOrigin(req.headers.get('Origin'),req.headers.get('X-Requested-With'),config.allowedOrigins);
        const code=clean(body.code);
        if(!code)throw new Error('Google no devolvió un código de autorización.');
        const token=await gmailTokenRequest(new URLSearchParams({grant_type:'authorization_code',code,client_id:config.clientId,client_secret:config.clientSecret,redirect_uri:origin}));
        const email=await gmailProfileEmail(token.access_token);
        if(body.expectedEmail&&clean(body.expectedEmail).toLowerCase()!==email)throw new Error(`Selecciona ${clean(body.expectedEmail)} en Google para renovar esta cuenta.`);
        const existing=await admin.from('integration_accounts').select('*').eq('owner_id',caller.data_owner_id).eq('provider','gmail').eq('external_account_id',email).maybeSingle();
        if(existing.error)throw existing.error;
        const previous=existing.data?.secret_id?await readVault(admin,existing.data.secret_id):{};
        const refreshToken=token.refresh_token||(previous.clientId===config.clientId?previous.refreshToken:'');
        if(!refreshToken)throw new Error('Google no concedió acceso persistente. Revoca el permiso de Zenvia en Google y vuelve a conectar la cuenta.');
        const connection=gmailConnectionFromToken(token,email);
        let account=existing.data;
        if(!account){
          const count=await admin.from('integration_accounts').select('id',{count:'exact',head:true}).eq('owner_id',caller.data_owner_id).eq('provider','gmail').eq('enabled',true);
          if(count.error)throw count.error;
          const inserted=await admin.from('integration_accounts').insert({owner_id:caller.data_owner_id,provider:'gmail',display_name:email,external_account_id:email,is_default:!count.count,credential_source:'vault',config:body.config||{}}).select('*').single();
          if(inserted.error)throw inserted.error;
          account=inserted.data;
        }
        const secretId=await writeVault(admin,account.id,'gmail',{clientId:config.clientId,refreshToken,...connection},account.secret_id);
        const now=new Date().toISOString();
        const saved=await admin.from('integration_accounts').update({secret_id:secretId,credential_source:'vault',enabled:true,status:'connected',last_error:null,last_success_at:now,updated_at:now,config:{...account.config,...body.config}}).eq('id',account.id).eq('owner_id',caller.data_owner_id).select('*').single();
        if(saved.error)throw saved.error;
        return response({account:publicAccount(await consolidateLegacyGmail(admin,caller.data_owner_id,saved.data)),connection});
      }
      throw new Error('Acción de Gmail no válida.');
    }

    if(action==='list')return response({accounts:await listAccounts(admin,caller.data_owner_id)});

    if(action==='discover_shopify'){
      const parentId=clean(body?.parentAccountId);
      const parent=await loadAccount(admin,caller.data_owner_id,parentId);
      if(parent.provider!=='sendcloud')throw new Error('Selecciona una cuenta de Sendcloud.');
      const integrations=await sendcloudIntegrations(admin,parent);
      return response({shops:integrations.filter((x:any)=>x.channel==='shopify')});
    }

    if(action==='create'){
      const provider=clean(body?.provider) as Provider;
      if(!PROVIDERS.has(provider))throw new Error('Proveedor de integración no válido.');

      const providerEntitlement:Record<string,{key:string;message:string}>={
        amazon:{key:'integration.amazon',message:'Tu plan no incluye la integración con Amazon.'},
        sendcloud:{key:'integration.sendcloud',message:'Tu plan no incluye integraciones logísticas.'},
        envia:{key:'integration.sendcloud',message:'Tu plan no incluye integraciones logísticas.'},
        mrw:{key:'integration.sendcloud',message:'Tu plan no incluye integraciones logísticas.'},
        gmail:{key:'integration.gmail',message:'Tu plan no incluye la integración con Gmail.'},
      };
      const configuredEntitlement=providerEntitlement[provider];
      if(configuredEntitlement){
        await requireWorkspaceEntitlement(admin,caller.data_owner_id,configuredEntitlement.key,configuredEntitlement.message);
      }
      if(provider==='amazon'){
        const {count,error:amazonCountError}=await admin.from('integration_accounts')
          .select('id',{count:'exact',head:true})
          .eq('owner_id',caller.data_owner_id)
          .eq('provider','amazon')
          .neq('status','disabled');
        if(amazonCountError)throw amazonCountError;
        await enforceWorkspaceLimit(
          admin,
          caller.data_owner_id,
          'amazon_accounts',
          Number(count||0),
          'Tu plan no permite conectar cuentas de Amazon.',
          limit=>`Has alcanzado el límite de ${limit} cuentas Amazon de tu plan.`,
        );
      }
      let displayName=clean(body?.displayName);
      let externalAccountId=clean(body?.externalAccountId)||null;
      let credentialSource='vault';
      let parentAccountId=clean(body?.parentAccountId)||null;
      let config=(body?.config&&typeof body.config==='object'&&!Array.isArray(body.config))?body.config:{};
      const credentials=(body?.credentials&&typeof body.credentials==='object'&&!Array.isArray(body.credentials))?body.credentials:{};
      if(provider==='amazon'){
        externalAccountId=clean((credentials as any).sellerId||(credentials as any).seller_id||externalAccountId);
        if(!externalAccountId)throw new Error('Indica el Seller ID de Amazon.');
        if(!clean((credentials as any).refreshToken||(credentials as any).refresh_token))throw new Error('Indica el refresh token de Amazon.');
        displayName=displayName||`Amazon · ${externalAccountId}`;
      }else if(provider==='sendcloud'){
        if(!clean((credentials as any).publicKey||(credentials as any).public_key)||!clean((credentials as any).secretKey||(credentials as any).secret_key))throw new Error('Indica las claves Public y Secret de Sendcloud.');
        externalAccountId=externalAccountId||`sendcloud-${crypto.randomUUID()}`;
        displayName=displayName||'Sendcloud';
      }else if(provider==='envia'){
        if(!clean((credentials as any).token||(credentials as any).apiToken||(credentials as any).api_token))throw new Error('Indica el token API de Envia.com.');
        externalAccountId=externalAccountId||`envia-${crypto.randomUUID()}`;
        displayName=displayName||'Envia.com';
        config={...config,environment:config?.environment==='production'?'production':'sandbox',shippingEnabled:true};
      }else if(provider==='mrw'){
        if(!clean((credentials as any).franchiseCode)||!clean((credentials as any).subscriberCode)||!clean((credentials as any).username)||!clean((credentials as any).password))throw new Error('Indica franquicia, abonado, usuario y contraseña de MRW.');
        externalAccountId=externalAccountId||`${clean((credentials as any).franchiseCode)}-${clean((credentials as any).subscriberCode)}`;
        displayName=displayName||'MRW';
        config={...config,environment:config?.environment==='test'?'test':'production',shippingEnabled:true,serviceCode:clean(config?.serviceCode)||'0205',serviceName:clean(config?.serviceName)||'MRW Urgent 19:00'};
      }else if(provider==='shopify'){
        const shopDomain=normalizeShopifyDomain((credentials as any).shopDomain||(credentials as any).shop_domain||externalAccountId);
        const accessToken=clean((credentials as any).accessToken||(credentials as any).access_token);
        if(!shopDomain||!accessToken)throw new Error('Indica el dominio myshopify.com y el access token de Shopify.');
        externalAccountId=shopDomain;
        parentAccountId=null;
        displayName=displayName||shopDomain.replace(/\.myshopify\.com$/i,'');
        config={...config,shopDomain,apiVersion:clean(config?.apiVersion)||'2026-07',syncOrders:config?.syncOrders!==false};
        credentialSource='vault';
      }else{
        if(!externalAccountId)throw new Error('Indica el correo de la cuenta de Gmail.');
        displayName=displayName||externalAccountId;credentialSource='session';
      }
      const existing=await admin.from('integration_accounts').select('id').eq('owner_id',caller.data_owner_id).eq('provider',provider).eq('external_account_id',externalAccountId).maybeSingle();
      if(existing.error)throw existing.error;
      if(existing.data)throw new Error('Esta cuenta ya está añadida.');

      const count=await admin.from('integration_accounts').select('id',{count:'exact',head:true}).eq('owner_id',caller.data_owner_id).eq('provider',provider).neq('status','disabled');
      if(count.error)throw count.error;
      const isDefault=Number(count.count||0)===0;
      const inserted=await admin.from('integration_accounts').insert({
        owner_id:caller.data_owner_id,provider,display_name:displayName,external_account_id:externalAccountId,
        status:'pending',enabled:true,is_default:isDefault,credential_source:credentialSource,
        parent_account_id:parentAccountId,config,
      }).select('*').single();
      if(inserted.error)throw inserted.error;
      let account=inserted.data;
      if(provider==='amazon'||provider==='sendcloud'||provider==='envia'||provider==='mrw'||provider==='shopify'){
        const secretId=await writeVault(admin,account.id,provider,credentials,null);
        const saved=await admin.from('integration_accounts').update({secret_id:secretId,updated_at:new Date().toISOString()})
          .eq('id',account.id).eq('owner_id',caller.data_owner_id).select('*').single();
        if(saved.error)throw saved.error;account=saved.data;
      }
      if(body?.test!==false)await testAccount(admin,caller.data_owner_id,account);
      return response({account:publicAccount(await loadAccount(admin,caller.data_owner_id,account.id))});
    }

    const id=clean(body?.id);
    if(!id)throw new Error('Falta la cuenta de integración.');
    const account=await loadAccount(admin,caller.data_owner_id,id);

    if(action==='test'){
      const result=await testAccount(admin,caller.data_owner_id,account);
      return response({...result,account:publicAccount(await loadAccount(admin,caller.data_owner_id,id))});
    }
    if(action==='set_default'){
      await makeDefault(admin,caller.data_owner_id,account.provider,id);
      return response({accounts:await listAccounts(admin,caller.data_owner_id)});
    }
    if(action==='update'){
      if(body?.enabled===true&&account.enabled===false){
        const providerEntitlement:Record<string,{key:string;message:string}>={
          amazon:{key:'integration.amazon',message:'Tu plan no incluye la integración con Amazon.'},
          sendcloud:{key:'integration.sendcloud',message:'Tu plan no incluye integraciones logísticas.'},
          envia:{key:'integration.sendcloud',message:'Tu plan no incluye integraciones logísticas.'},
          gmail:{key:'integration.gmail',message:'Tu plan no incluye la integración con Gmail.'},
        };
        const configuredEntitlement=providerEntitlement[account.provider];
        if(configuredEntitlement){
          await requireWorkspaceEntitlement(admin,caller.data_owner_id,configuredEntitlement.key,configuredEntitlement.message);
        }
        if(account.provider==='amazon'){
          const {count,error:amazonCountError}=await admin.from('integration_accounts')
            .select('id',{count:'exact',head:true})
            .eq('owner_id',caller.data_owner_id)
            .eq('provider','amazon')
            .eq('enabled',true)
            .neq('status','disabled');
          if(amazonCountError)throw amazonCountError;
          await enforceWorkspaceLimit(
            admin,
            caller.data_owner_id,
            'amazon_accounts',
            Number(count||0),
            'Tu plan no permite conectar cuentas de Amazon.',
            limit=>`Has alcanzado el límite de ${limit} cuentas Amazon de tu plan.`,
          );
        }
      }
      const patch:any={updated_at:new Date().toISOString()};
      if(typeof body?.displayName==='string'&&clean(body.displayName))patch.display_name=clean(body.displayName);
      if(typeof body?.enabled==='boolean')patch.enabled=body.enabled;
      if(body?.config&&typeof body.config==='object'&&!Array.isArray(body.config))patch.config={...(account.config||{}),...body.config};
      const credentials=(body?.credentials&&typeof body.credentials==='object'&&!Array.isArray(body.credentials))?body.credentials:null;
      if(credentials&&(account.provider==='amazon'||account.provider==='sendcloud'||account.provider==='envia'||account.provider==='mrw'||account.provider==='shopify')){
        const existing=account.secret_id?await readVault(admin,account.secret_id):{};
        const merged={...existing,...Object.fromEntries(Object.entries(credentials).filter(([,v])=>clean(v)))};
        patch.secret_id=await writeVault(admin,account.id,account.provider,merged,account.secret_id);
        patch.status='pending';patch.last_error=null;
        if(account.provider==='shopify'){
          const shopDomain=normalizeShopifyDomain((merged as any).shopDomain||(merged as any).shop_domain||body?.config?.shopDomain||account.external_account_id);
          const accessToken=clean((merged as any).accessToken||(merged as any).access_token);
          if(!shopDomain||!accessToken)throw new Error('Indica el dominio myshopify.com y el access token de Shopify.');
          patch.external_account_id=shopDomain;
          patch.parent_account_id=null;
          patch.credential_source='vault';
          patch.config={...(account.config||{}),...(body?.config||{}),shopDomain,apiVersion:clean(body?.config?.apiVersion||account.config?.apiVersion)||'2026-07',syncOrders:body?.config?.syncOrders!==false};
        }
      }
      const saved=await admin.from('integration_accounts').update(patch).eq('id',id).eq('owner_id',caller.data_owner_id).select('*').single();
      if(saved.error)throw saved.error;
      if(body?.isDefault===true)await makeDefault(admin,caller.data_owner_id,account.provider,id);
      return response({account:publicAccount(await loadAccount(admin,caller.data_owner_id,id))});
    }
    if(action==='disconnect'){
      if(account.provider==='gmail'&&account.secret_id){
        const stored=await readVault(admin,account.secret_id);
        if(stored.refreshToken){try{await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:stored.refreshToken})});}catch{/* Disable locally even if Google is unavailable. */}}
      }
      if(account.secret_id){
        await writeVault(admin,account.id,account.provider,{revoked:true,revokedAt:new Date().toISOString()},account.secret_id);
      }
      const disabled=await admin.from('integration_accounts').update({
        enabled:false,status:'disabled',is_default:false,last_error:null,updated_at:new Date().toISOString(),
      }).eq('id',id).eq('owner_id',caller.data_owner_id);
      if(disabled.error)throw disabled.error;
      if(account.provider==='amazon'&&account.linked_resource_id){
        await admin.from('amazon_accounts').update({status:'disabled',updated_at:new Date().toISOString()})
          .eq('id',account.linked_resource_id).eq('owner_id',caller.data_owner_id);
      }
      const replacement=await admin.from('integration_accounts').select('id').eq('owner_id',caller.data_owner_id)
        .eq('provider',account.provider).neq('status','disabled').order('updated_at',{ascending:false}).limit(1).maybeSingle();
      if(replacement.data)await makeDefault(admin,caller.data_owner_id,account.provider,replacement.data.id);
      return response({accounts:await listAccounts(admin,caller.data_owner_id)});
    }
    throw new Error('Acción no válida.');
  }catch(error){
    const message=sanitize(error instanceof Error?error.message:error)||'Error interno.';
    const status=/Sesión no válida/.test(message)?401:/administrador|acceso desactivado/.test(message)?403:/no encontrada/.test(message)?404:400;
    return response({error:message},status);
  }
});
