// Shared Shopify offline-token rotation for OAuth installs. Tokens are stored
// exclusively in Supabase Vault; never return them to the browser.
const clean=(v:unknown)=>String(v??'').trim();

export function normalizeShopifyDomain(value:unknown){
  const domain=clean(value).toLowerCase().replace(/^https?:\/\//,'').replace(/\/+$/,'');
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain))
    throw new Error('Indica un dominio permanente válido: tienda.myshopify.com.');
  return domain;
}

function tokenPayload(payload:any,previous:any={},shopDomain:string){
  const accessToken=clean(payload?.access_token);
  if(!accessToken)throw new Error('Shopify no ha devuelto un token válido.');
  const seconds=Number(payload?.expires_in);
  const expiresAt=seconds>0?Date.now()+seconds*1000:null;
  const refreshToken=clean(payload?.refresh_token||previous.refreshToken);
  if(expiresAt&&!refreshToken)throw new Error('Shopify ha emitido un token temporal sin posibilidad de renovación.');
  return {
    ...previous,shopDomain,accessToken,
    ...(refreshToken?{refreshToken}:{}),
    expiresAt,
    scope:clean(payload?.scope||previous.scope),
  };
}

export async function storeShopifyCredentials(admin:any,accountId:string,credentials:Record<string,unknown>,secretId:string|null=null){
  const {data,error}=await admin.rpc('integration_store_secret',{
    p_secret:JSON.stringify(credentials),
    p_name:`integration:shopify:${accountId}`,
    p_description:`Credenciales OAuth cifradas de Shopify (${accountId})`,
    p_existing_secret_id:secretId,
  });
  if(error)throw error;
  return String(data);
}

export function shopifyCredentialsFromGrant(payload:any,shopDomain:string){
  return tokenPayload(payload,{},normalizeShopifyDomain(shopDomain));
}

async function readVault(admin:any,secretId:string|null){
  if(!secretId)throw new Error('Esta tienda no tiene credenciales guardadas.');
  const {data,error}=await admin.rpc('integration_read_secret',{p_secret_id:secretId});
  if(error)throw error;
  try{return JSON.parse(String(data||'{}'))}
  catch{throw new Error('Las credenciales cifradas de Shopify son inválidas.')}
}

export async function activeShopifyCredentials(admin:any,account:any){
  const stored=await readVault(admin,account.secret_id||null);
  const shopDomain=normalizeShopifyDomain(stored.shopDomain||stored.shop_domain||account.external_account_id||account.config?.shopDomain);
  let accessToken=clean(stored.accessToken||stored.access_token);
  if(!accessToken)throw new Error('Shopify necesita una nueva autorización.');
  const expiresAt=Number(stored.expiresAt)||null;
  if(expiresAt&&Date.now()>=expiresAt-120000){
    const refreshToken=clean(stored.refreshToken);
    const clientId=clean(Deno.env.get('SHOPIFY_CLIENT_ID'));
    const clientSecret=clean(Deno.env.get('SHOPIFY_CLIENT_SECRET'));
    if(!refreshToken||!clientId||!clientSecret)
      throw new Error('La conexión OAuth de Shopify ha caducado y necesita renovarse desde Integraciones.');
    const res=await fetch(`https://${shopDomain}/admin/oauth/access_token`,{
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},
      body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,grant_type:'refresh_token',refresh_token:refreshToken}),
      signal:AbortSignal.timeout(18000),
    });
    if(!res.ok){
      if(res.status===401||res.status===400)throw new Error('Shopify ha revocado o caducado la autorización. Vuelve a conectar la tienda.');
      throw new Error(`Shopify no ha podido renovar la autorización (HTTP ${res.status}).`);
    }
    const updated=tokenPayload(await res.json(),stored,shopDomain);
    const id=await storeShopifyCredentials(admin,account.id,updated,account.secret_id);
    if(id!==account.secret_id){
      const {error}=await admin.from('integration_accounts').update({secret_id:id,updated_at:new Date().toISOString()})
        .eq('id',account.id).eq('owner_id',account.owner_id);
      if(error)throw error;
    }
    accessToken=updated.accessToken;
  }
  return {shopDomain,accessToken,apiVersion:clean(account.config?.apiVersion)||'2026-07'};
}
