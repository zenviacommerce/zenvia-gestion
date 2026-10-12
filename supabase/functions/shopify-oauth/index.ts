import {createClient} from 'npm:@supabase/supabase-js@2';
import {requireWorkspaceEntitlement} from '../_shared/saas/entitlements.ts';
import {normalizeShopifyDomain,shopifyCredentialsFromGrant,storeShopifyCredentials} from '../_shared/shopifyOAuth.ts';

// Public GET only receives Shopify's signed callback. All POST actions require
// a valid Supabase user token plus active ZENVIA administrator permissions.
const cors={
  'Access-Control-Allow-Origin':'https://gestion.zenviacommerce.com',
  'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',
  'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
};
const APP_URL='https://gestion.zenviacommerce.com';
const clean=(v:unknown)=>String(v??'').trim();
function json(value:unknown,status=200){
  return new Response(JSON.stringify(value),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
}
function getAdminKey(){
  const keys=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(keys){try{const parsed=JSON.parse(keys);if(clean(parsed?.default))return clean(parsed.default)}catch{}}
  return clean(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
}
function configuration(){
  const clientId=clean(Deno.env.get('SHOPIFY_CLIENT_ID'));
  const clientSecret=clean(Deno.env.get('SHOPIFY_CLIENT_SECRET'));
  const supabaseUrl=clean(Deno.env.get('SUPABASE_URL')).replace(/\/+$/,'');
  if(!clientId||!clientSecret)throw new Error('Falta configurar SHOPIFY_CLIENT_ID y SHOPIFY_CLIENT_SECRET en Supabase para autorizar tiendas.');
  if(!supabaseUrl||!/^https:\/\//.test(supabaseUrl))throw new Error('URL interna de Supabase no configurada.');
  const scopes=clean(Deno.env.get('SHOPIFY_OAUTH_SCOPES'))||'read_orders,read_products';
  if(!scopes.split(',').includes('read_orders'))throw new Error('Shopify OAuth necesita el permiso read_orders.');
  return {clientId,clientSecret,scopes,redirectUri:`${supabaseUrl}/functions/v1/shopify-oauth`};
}
async function digest(value:string){
  const bytes=new TextEncoder().encode(value);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
}
function safeHexEquals(actual:string,expected:string){
  if(!/^[0-9a-f]{64}$/i.test(actual)||expected.length!==64)return false;
  let different=0;
  for(let i=0;i<64;i++)different|=actual.toLowerCase().charCodeAt(i)^expected.charCodeAt(i);
  return different===0;
}
async function checkCallbackSignature(params:URLSearchParams,secret:string){
  const hmac=clean(params.get('hmac'));
  if(!/^[a-f0-9]{64}$/i.test(hmac))return false;
  const seen=new Set<string>();
  const fields:Array<[string,string]>=[];
  for(const [key,value] of params){
    if(seen.has(key))return false;
    seen.add(key);
    if(key!=='hmac'&&key!=='signature')fields.push([key,value]);
  }
  fields.sort(([a],[b])=>a.localeCompare(b,'en'));
  const message=fields.map(([key,value])=>`${key}=${value}`).join('&');
  const secretKey=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=new Uint8Array(await crypto.subtle.sign('HMAC',secretKey,new TextEncoder().encode(message)));
  const expected=Array.from(signature).map(n=>n.toString(16).padStart(2,'0')).join('');
  return safeHexEquals(hmac,expected);
}
function returnToApp(state:'connected'|'error',shop:string,message=''){
  const url=new URL(APP_URL);
  url.searchParams.set('shopify_oauth',state);
  if(shop)url.searchParams.set('shopify_shop',shop);
  if(message)url.searchParams.set('shopify_message',message.slice(0,160));
  return new Response(null,{status:303,headers:{Location:url.toString(),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}
async function authenticate(req:Request,admin:any){
  const bearer=clean(req.headers.get('Authorization')).replace(/^Bearer\s+/i,'');
  if(!bearer)throw new Error('Inicia sesión en Zenvia para conectar Shopify.');
  const {data:auth,error:authError}=await admin.auth.getUser(bearer);
  if(authError||!auth?.user)throw new Error('Sesión caducada. Inicia sesión de nuevo.');
  const {data:caller,error}=await admin.from('app_users')
    .select('user_id,data_owner_id,role,active')
    .eq('user_id',auth.user.id).maybeSingle();
  if(error)throw error;
  if(!caller?.active||caller.role!=='admin')throw new Error('Solo un administrador puede conectar tiendas Shopify.');
  const {data:workspace,error:workspaceError}=await admin.from('workspaces')
    .select('status').eq('id',caller.data_owner_id).maybeSingle();
  if(workspaceError)throw workspaceError;
  if(!workspace||!['active','trialing'].includes(workspace.status))throw new Error('Tu empresa no está activa.');
  await requireWorkspaceEntitlement(admin,caller.data_owner_id,'integration.shopify','Tu plan no incluye la integración con Shopify.');
  return caller;
}
async function start(req:Request,admin:any){
  const caller=await authenticate(req,admin);
  const body=await req.json().catch(()=>({}));
  if(clean(body?.action)!=='start')return json({error:'Acción desconocida.'},400);
  const config=configuration();
  const shop=normalizeShopifyDomain(body?.shopDomain);
  const nonce=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const hash=await digest(nonce);
  const {error}=await admin.from('shopify_oauth_states').insert({
    state_hash:hash,owner_id:caller.data_owner_id,initiated_by:caller.user_id,
    shop_domain:shop,sync_orders:body?.syncOrders!==false,
    expires_at:new Date(Date.now()+10*60*1000).toISOString(),
  });
  if(error)throw error;
  const params=new URLSearchParams({
    client_id:config.clientId,scope:config.scopes,
    redirect_uri:config.redirectUri,state:nonce,
  });
  return json({authorizationUrl:`https://${shop}/admin/oauth/authorize?${params.toString()}`});
}
async function callback(req:Request,admin:any){
  const params=new URL(req.url).searchParams;
  // Validate the Shopify signature before trusting any browser-supplied values.
  const config=configuration();
  if(!await checkCallbackSignature(params,config.clientSecret))
    return json({error:'Shopify no ha validado la respuesta de autorización.'},403);
  const nonce=clean(params.get('state'));
  const shop=normalizeShopifyDomain(params.get('shop'));
  const timestamp=Number(params.get('timestamp'));
  if(!/^[a-f0-9]{64}$/i.test(nonce)||!Number.isFinite(timestamp)||Math.abs(Date.now()-timestamp*1000)>10*60*1000)
    return json({error:'La autorización Shopify ha caducado. Inténtalo de nuevo.'},403);
  const now=new Date().toISOString();
  // An UPDATE with the prior unconsumed state is atomic: no CSRF nonce can be
  // used twice, even across concurrent Edge Function instances.
  const {data:states,error:stateError}=await admin.from('shopify_oauth_states')
    .update({consumed_at:now})
    .eq('state_hash',await digest(nonce))
    .eq('shop_domain',shop)
    .is('consumed_at',null)
    .gt('expires_at',now)
    .select('owner_id,shop_domain,sync_orders').limit(1);
  if(stateError)throw stateError;
  const state=states?.[0];
  if(!state)return json({error:'Autorización ya utilizada o caducada. Vuelve a intentarlo desde Zenvia.'},403);
  if(params.get('error'))return returnToApp('error',shop,'Has cancelado la autorización en Shopify.');
  const code=clean(params.get('code'));
  if(!code||code.length>1024)return returnToApp('error',shop,'Shopify no ha enviado el código de autorización.');
  try{
    const response=await fetch(`https://${shop}/admin/oauth/access_token`,{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},
      body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,code,expiring:'1'}),
      signal:AbortSignal.timeout(18000),
    });
    if(!response.ok)throw new Error(`Shopify ha rechazado el permiso (HTTP ${response.status}).`);
    const token=await response.json();
    const granted=new Set(clean(token?.scope).split(',').map(s=>s.trim()));
    if(!granted.has('read_orders')&&!granted.has('write_orders'))
      throw new Error('Shopify no ha concedido el permiso read_orders.');
    const credentials=shopifyCredentialsFromGrant(token,shop);
    const identityResponse=await fetch(`https://${shop}/admin/api/2026-07/graphql.json`,{
      method:'POST',
      headers:{'Content-Type':'application/json','X-Shopify-Access-Token':credentials.accessToken},
      body:JSON.stringify({query:'query ZenviaShop {shop {id name myshopifyDomain}}'}),
      signal:AbortSignal.timeout(18000),
    });
    if(!identityResponse.ok)throw new Error('No se pudo validar la tienda con Shopify Admin API.');
    const identity=await identityResponse.json();
    const realShop=identity?.data?.shop;
    if(!realShop?.id||normalizeShopifyDomain(realShop.myshopifyDomain)!==shop)
      throw new Error('Shopify ha devuelto una identidad de tienda inesperada.');
    const displayName=clean(realShop.name)||shop.replace(/\.myshopify\.com$/,'');
    const {data:existing,error:existingError}=await admin.from('integration_accounts')
      .select('*').eq('owner_id',state.owner_id).eq('provider','shopify').eq('external_account_id',shop).maybeSingle();
    if(existingError)throw existingError;
    let account=existing;
    if(!account){
      const {count,error:countError}=await admin.from('integration_accounts')
        .select('id',{count:'exact',head:true}).eq('owner_id',state.owner_id).eq('provider','shopify').neq('status','disabled');
      if(countError)throw countError;
      const {data:inserted,error:insertError}=await admin.from('integration_accounts').insert({
        owner_id:state.owner_id,provider:'shopify',display_name:displayName,
        external_account_id:shop,status:'pending',enabled:true,is_default:Number(count||0)===0,
        credential_source:'vault',parent_account_id:null,
        config:{shopDomain:shop,apiVersion:'2026-07',syncOrders:state.sync_orders,authorizationMethod:'oauth'},
      }).select('*').single();
      if(insertError)throw insertError;
      account=inserted;
    }
    const secretId=await storeShopifyCredentials(admin,account.id,credentials,account.secret_id);
    const {error:saveError}=await admin.from('integration_accounts').update({
      secret_id:secretId,credential_source:'vault',enabled:true,status:'connected',last_tested_at:now,
      last_success_at:now,last_error:null,updated_at:now,
      display_name:account.display_name||displayName,
      config:{...(account.config||{}),shopDomain:shop,apiVersion:'2026-07',syncOrders:state.sync_orders,authorizationMethod:'oauth'},
    }).eq('id',account.id).eq('owner_id',state.owner_id);
    if(saveError)throw saveError;
    return returnToApp('connected',shop);
  }catch(error){
    // Never put an access token or authorization code in a URL, log or response.
    const message=error instanceof Error?error.message:'No se pudo completar la autorización.';
    return returnToApp('error',shop,message);
  }
}
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  const url=clean(Deno.env.get('SUPABASE_URL')),key=getAdminKey();
  if(!url||!key)return json({error:'Backend de Zenvia no configurado.'},500);
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    if(req.method==='POST')return await start(req,admin);
    if(req.method==='GET')return await callback(req,admin);
    return json({error:'Método no permitido.'},405);
  }catch(error){
    const message=error instanceof Error?error.message:'No se pudo autorizar Shopify.';
    // Server setup errors can be sent back to the authenticated POST caller;
    // for public GET, return only a generic message (no OAuth secrets).
    return json({error:req.method==='POST'?message:'No se pudo completar la autorización de Shopify.'},
      /Sesión|permiso|administrador|caducada/i.test(message)?403:400);
  }
});