export function shopifyError(error:unknown,fallback='No se pudo completar la conexión con Shopify.'):string{
  if(typeof error==='string'&&error.trim()&&error!=='[object Object]')return error.trim();
  if(error&&typeof error==='object'){
    const value=error as Record<string,unknown>;
    for(const key of ['message','error','error_description','details']){
      if(value[key]&&value[key]!==error){const detail=shopifyError(value[key],'');if(detail)return detail;}
    }
  }
  return fallback;
}

export function shopifyDomain(value:unknown){
  const domain=String(value??'').trim().toLowerCase().replace(/^https:\/\//,'').replace(/\/$/,'');
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain))throw new Error('Indica el dominio permanente de Shopify: tienda.myshopify.com, sin rutas.');
  return domain;
}

export function shopifyLegacyCredentials(domain:unknown,accessToken:unknown){
  const token=String(accessToken??'').trim();
  if(!token)throw new Error('Indica el access token de la app antigua.');
  return {shopDomain:shopifyDomain(domain),accessToken:token,authMode:'token'};
}

export function shopifyApplicationCredentials(environment:any,configured:any){
  const candidate=environment?.clientId&&environment?.clientSecret?environment:configured;
  const clientId=String(candidate?.clientId||'').trim(),clientSecret=String(candidate?.clientSecret||'').trim();
  return {clientId,clientSecret,ready:Boolean(clientId&&clientSecret)};
}

export async function shopifyStoredApplicationCredentials(admin:any,ownerId:string){
  const environment={clientId:Deno.env.get('SHOPIFY_CLIENT_ID')||'',clientSecret:Deno.env.get('SHOPIFY_CLIENT_SECRET')||''};
  let configured={};
  if(!environment.clientId||!environment.clientSecret){
    const result=await admin.rpc('integration_read_named_secret',{p_name:`shopify-app:${ownerId}`});
    if(result.error)throw result.error;
    try{configured=JSON.parse(result.data||'{}')}catch{}
  }
  return shopifyApplicationCredentials(environment,configured);
}

export async function shopifyHash(value:string){
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(v=>v.toString(16).padStart(2,'0')).join('');
}

export async function verifyShopifyCallback(params:URLSearchParams,secret:string){
  const keys=[...params.keys()];
  if(new Set(keys).size!==keys.length)return false;
  const supplied=params.get('hmac')||'';
  if(!/^[a-f0-9]{64}$/.test(supplied))return false;
  const message=[...params.entries()].filter(([key])=>key!=='hmac').sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('&');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const signature=new Uint8Array(supplied.match(/../g)!.map(v=>parseInt(v,16)));
  return crypto.subtle.verify('HMAC',key,signature,new TextEncoder().encode(message));
}

export async function shopifyTokenRequest(domain:string,body:URLSearchParams){
  const res=await fetch(`https://${shopifyDomain(domain)}/admin/oauth/access_token`,{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body,
    redirect:'error',signal:AbortSignal.timeout(20000),
  });
  const token=await res.json().catch(()=>({}));
  if(!res.ok||token.error)throw new Error(token.error==='invalid_client'?'Shopify no acepta el ID o secreto de la app. Comprueba sus credenciales.':token.error==='shop_not_permitted'?'La app y la tienda deben pertenecer a la misma organización Shopify. Para tiendas de clientes utiliza Autorizar con Shopify.':token.error==='invalid_grant'?'Shopify ha caducado o revocado la autorización. Vuelve a conectar la tienda.':`Shopify (${res.status}): no se pudo obtener la autorización. Comprueba que la app esté instalada y tenga permiso read_orders.`);
  return token;
}

export function shopifyTokenCredentials(stored:any,token:any,now=Date.now()){
  if(!token?.access_token)throw new Error('Shopify no devolvió un access token.');
  if(!String(token.scope||'').split(',').includes('read_orders'))throw new Error('La app necesita permiso read_orders. Añádelo en Shopify y vuelve a autorizar.');
  if(token.expires_in!=null&&(!Number.isFinite(Number(token.expires_in))||Number(token.expires_in)<=0))throw new Error('Shopify devolvió una caducidad no válida.');
  return {...stored,accessToken:String(token.access_token),scope:String(token.scope),expiresAt:token.expires_in?now+Number(token.expires_in)*1000:null,...(token.refresh_token?{refreshToken:String(token.refresh_token)}:{})};
}

export async function resolveShopifyCredentials(stored:any,config:any,request=shopifyTokenRequest,persist?: (stored:any)=>Promise<unknown>){
  const domain=shopifyDomain(stored.shopDomain||stored.shop_domain||config.shopDomain);
  let token=String(stored.accessToken||stored.access_token||'').trim();
  if(!token||(stored.expiresAt&&Number(stored.expiresAt)<=Date.now()+300000)){
    const clientId=stored.clientId||Deno.env.get('SHOPIFY_CLIENT_ID');
    const clientSecret=stored.clientSecret||Deno.env.get('SHOPIFY_CLIENT_SECRET');
    if(!clientId||!clientSecret)throw new Error('Renueva la conexión con Shopify desde Integraciones.');
    const fields:Record<string,string>={client_id:clientId,client_secret:clientSecret};
    if(stored.authMode==='client_credentials')fields.grant_type='client_credentials';
    else if(stored.refreshToken){fields.grant_type='refresh_token';fields.refresh_token=stored.refreshToken;}
    else throw new Error('Renueva la autorización de Shopify desde Integraciones.');
    const renewed=shopifyTokenCredentials(stored,await request(domain,new URLSearchParams(fields)));
    if(persist)await persist(renewed);
    token=renewed.accessToken;
  }
  return {shopDomain:domain,accessToken:token,apiVersion:String(config.apiVersion||'2026-07')};
}

export async function shopifyAccountCredentials(admin:any,account:any,appCredentials?:{clientId:string;clientSecret:string}){
  async function read(){
    const result=await admin.from('integration_accounts').select('*').eq('id',account.id).eq('owner_id',account.owner_id).maybeSingle();
    if(result.error)throw result.error;
    if(!result.data?.enabled||result.data.status==='disabled')throw new Error('La cuenta Shopify está desconectada.');
    const secret=await admin.rpc('integration_read_secret',{p_secret_id:result.data.secret_id});
    if(secret.error)throw secret.error;
    return {row:result.data,stored:JSON.parse(secret.data||'{}')};
  }
  let current=await read();
  if(current.stored.accessToken&&(!current.stored.expiresAt||current.stored.expiresAt>Date.now()+300000))return resolveShopifyCredentials(current.stored,current.row.config||{});
  const lease=crypto.randomUUID();
  let claimed=false;
  for(let attempt=0;attempt<125;attempt++){
    const result=await admin.rpc('integration_shopify_claim_refresh',{p_account_id:account.id,p_owner_id:account.owner_id,p_lease:lease});
    if(result.error)throw result.error;
    if(result.data){claimed=true;break;}
    await new Promise(resolve=>setTimeout(resolve,200));
    current=await read();
    if(current.stored.accessToken&&(!current.stored.expiresAt||current.stored.expiresAt>Date.now()+300000))return resolveShopifyCredentials(current.stored,current.row.config||{});
  }
  if(!claimed)throw new Error('Shopify está renovando la autorización. Vuelve a intentarlo en unos segundos.');
  try{
    current=await read();
    if(current.stored.authMode==='oauth'&&appCredentials&&current.stored.clientId!==appCredentials.clientId)throw new Error('La app Shopify cambió. Vuelve a autorizar esta tienda.');
    const storedForRenewal=current.stored.authMode==='oauth'&&appCredentials?{...current.stored,clientSecret:appCredentials.clientSecret}:current.stored;
    return await resolveShopifyCredentials(storedForRenewal,current.row.config||{},shopifyTokenRequest,async stored=>{
      if(current.stored.authMode==='oauth')delete stored.clientSecret;
      const result=await admin.rpc('integration_shopify_commit_refresh',{p_account_id:account.id,p_owner_id:account.owner_id,p_lease:lease,p_version:current.row.shopify_credential_version,p_secret:JSON.stringify(stored)});
      if(result.error)throw result.error;
      if(!result.data)throw new Error('La conexión de Shopify cambió durante la renovación. Vuelve a intentarlo.');
    });
  }finally{
    await admin.rpc('integration_shopify_release_refresh',{p_account_id:account.id,p_owner_id:account.owner_id,p_lease:lease});
  }
}

export async function commitShopifyAuthorization(admin:any,account:any,pending:any,stored:any){
  const config={...(account.config||{}),shopDomain:stored.shopDomain,authMode:'oauth',syncOrders:pending.syncOrders!==false,apiVersion:'2026-07'};
  delete config.oauthStateHash;
  const result=await admin.rpc('integration_shopify_complete_oauth',{p_account_id:account.id,p_owner_id:account.owner_id,p_version:account.shopify_credential_version,p_secret:JSON.stringify(stored),p_display_name:pending.displayName||account.display_name,p_config:config});
  if(result.error)throw result.error;
  if(!result.data)throw new Error('La conexión de Shopify cambió mientras autorizabas. Vuelve a conectar la tienda.');
}
