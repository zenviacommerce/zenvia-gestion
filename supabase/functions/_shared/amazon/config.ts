export type AmazonSpApiCredentials={
  clientId:string;
  clientSecret:string;
  refreshToken:string;
  sellerId:string;
};

function clean(value:unknown){return String(value??'').trim();}
function required(value:unknown,name:string){
  const text=clean(value);
  if(!text)throw new Error(`Falta ${name} en la configuración de Amazon SP-API.`);
  return text;
}
function parseEnv(){
  const raw=clean(Deno.env.get('AMAZON_SPAPI_CREDENTIALS'));
  if(!raw)return {} as any;
  try{return JSON.parse(raw)}catch{throw new Error('AMAZON_SPAPI_CREDENTIALS no contiene JSON válido.');}
}
function normalize(stored:any,env:any,fallbackSellerId=''):AmazonSpApiCredentials{
  const refreshToken=clean(stored?.refreshToken)||clean(stored?.refresh_token);
  if(!refreshToken)throw new Error('cuenta Amazon sin credenciales');
  return {
    // SP-API/LWA app credentials can be shared by every tenant using the same
    // registered application. Seller-specific credentials cannot.
    clientId:required(stored?.clientId||stored?.client_id||env?.clientId||env?.client_id,'client_id'),
    clientSecret:required(stored?.clientSecret||stored?.client_secret||env?.clientSecret||env?.client_secret,'client_secret'),
    refreshToken:refreshToken,
    sellerId:required(stored?.sellerId||stored?.seller_id||fallbackSellerId,'seller_id'),
  };
}

export function readAmazonSpApiCredentials():AmazonSpApiCredentials{
  throw new Error('cuenta Amazon sin credenciales');
}

async function readIntegrationSecret(admin:any,integrationAccountId:string,ownerId?:string|null){
  let query=admin.from('integration_accounts')
    .select('id,owner_id,external_account_id,secret_id,credential_source,status,enabled')
    .eq('id',integrationAccountId).eq('provider','amazon');
  if(ownerId)query=query.eq('owner_id',ownerId);
  const {data:integration,error}=await query.maybeSingle();
  if(error)throw error;
  if(!integration)throw new Error('La cuenta de integración de Amazon no existe.');
  if(integration.status==='disabled'||integration.enabled===false)throw new Error('La cuenta de Amazon está deshabilitada.');
  let stored:any={};
  if(integration.secret_id){
    const {data:secret,error:secretError}=await admin.rpc('integration_read_secret',{p_secret_id:integration.secret_id});
    if(secretError)throw secretError;
    try{stored=JSON.parse(String(secret||'{}'))}catch{throw new Error('Las credenciales cifradas de Amazon no tienen un formato válido.');}
  }
  return {integration,stored};
}

export async function loadAmazonSpApiCredentials(
  admin:any,
  options:{amazonAccountId?:string|null;integrationAccountId?:string|null;ownerId?:string|null}={},
):Promise<AmazonSpApiCredentials>{
  const env=parseEnv();
  const ownerId=clean(options.ownerId);
  let integrationAccountId=clean(options.integrationAccountId);
  let fallbackSellerId='';
  let accountOwnerId=ownerId;

  if(options.amazonAccountId){
    let accountQuery=admin.from('amazon_accounts')
      .select('seller_id,integration_account_id,owner_id')
      .eq('id',options.amazonAccountId);
    if(ownerId)accountQuery=accountQuery.eq('owner_id',ownerId);
    const {data:account,error}=await accountQuery.maybeSingle();
    if(error)throw error;
    if(!account)throw new Error('La cuenta Amazon asociada al trabajo ya no existe.');
    if(integrationAccountId&&integrationAccountId!==clean(account.integration_account_id)){
      throw new Error('La cuenta de integración no corresponde al trabajo de Amazon.');
    }
    accountOwnerId=clean(account.owner_id);
    fallbackSellerId=clean(account.seller_id);
    integrationAccountId=integrationAccountId||clean(account.integration_account_id);
  }

  if(!integrationAccountId){
    throw new Error('Amazon SP-API no está configurado para este workspace.');
  }

  const {integration,stored}=await readIntegrationSecret(admin,integrationAccountId,accountOwnerId||null);
  const ownToken=clean(stored?.refreshToken)||clean(stored?.refresh_token);
  if(!ownToken){
    // This allowlist contains integration_accounts.id, never a seller ID or a
    // caller-supplied workspace. The row above has already been owner-checked.
    const allowedId=clean(Deno.env.get('AMAZON_LEGACY_FALLBACK_ACCOUNT_ID'));
    const legacyToken=clean(env?.refreshToken)||clean(env?.refresh_token);
    if(!allowedId||clean(integration.id)!==allowedId||!legacyToken){
      throw new Error('cuenta Amazon sin credenciales');
    }
    const credentials=normalize({refreshToken:legacyToken},env,clean(integration.external_account_id)||fallbackSellerId);
    console.warn('amazon_legacy_fallback_used',{integration_account_id:integration.id,owner_id:integration.owner_id});
    return credentials;
  }
  return normalize(stored,env,clean(integration.external_account_id)||fallbackSellerId);
}
