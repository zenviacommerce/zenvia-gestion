import {readAmazonLwaApplication,type AmazonAppKey} from './apps.ts';
export type AmazonSpApiCredentials={clientId:string;clientSecret:string;refreshToken:string;sellerId:string;appKey:AmazonAppKey;credentialVersion:number};
function clean(value:unknown){return typeof value==='string'?value.trim():'';}
export function readAmazonSpApiCredentials():AmazonSpApiCredentials{throw new Error('cuenta Amazon sin credenciales');}
export async function loadAmazonSpApiCredentials(admin:any,options:{ownerId:string;amazonAccountId?:string|null;integrationAccountId?:string|null}):Promise<AmazonSpApiCredentials>{
  const ownerId=clean(options?.ownerId),integrationAccountId=clean(options?.integrationAccountId),amazonAccountId=clean(options?.amazonAccountId);
  if(!ownerId)throw new Error('Se requiere propietario de la cuenta Amazon.');
  if(!integrationAccountId&&!amazonAccountId)throw new Error('cuenta Amazon sin credenciales');
  const {data,error}=await admin.rpc('integration_amazon_credential_snapshot',{p_owner_id:ownerId,p_integration_account_id:integrationAccountId||null,p_amazon_account_id:amazonAccountId||null});
  if(error)throw new Error('No se pudieron cargar las credenciales de la cuenta Amazon.');
  const row=Array.isArray(data)&&data.length===1?data[0]:null;
  if(!row||row.owner_id!==ownerId||(integrationAccountId&&row.integration_account_id!==integrationAccountId)||(amazonAccountId&&row.amazon_account_id!==amazonAccountId))throw new Error('cuenta Amazon sin credenciales');
  const appKey=row.sp_api_app_key;
  if(appKey!=='private_v1'&&appKey!=='public_v1')throw new Error('Aplicación Amazon no válida.');
  const application=readAmazonLwaApplication(appKey,name=>Deno.env.get(name));
  const stored=row.secret_payload;
  if(!stored||typeof stored!=='object'||Array.isArray(stored))throw new Error('cuenta Amazon sin credenciales');
  if(stored.legacyApplicationCredentialsPresent===true){
    const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
    const [clientIdHash,clientSecretHash]=await Promise.all([hash(application.clientId),hash(application.clientSecret)]);
    if(stored.legacyClientIdSha256!==clientIdHash||stored.legacyClientSecretSha256!==clientSecretHash)throw new Error('La configuración heredada de Amazon requiere revisión privada.');
  }
  let refreshToken=clean(stored.refreshToken)||clean(stored.refresh_token);
  const sellerId=clean(row.seller_id);
  let usedLegacyFallback=false;
  if(!refreshToken&&appKey==='private_v1'){
    const allowedId=clean(Deno.env.get('AMAZON_LEGACY_FALLBACK_ACCOUNT_ID'));
    if(allowedId&&allowedId===row.integration_account_id){
      let legacy:any=null;try{legacy=JSON.parse(Deno.env.get('AMAZON_SPAPI_CREDENTIALS')||'null')}catch{/* fail closed */}
      const legacySeller=clean(legacy?.sellerId)||clean(legacy?.seller_id);
      if(!legacySeller||legacySeller===sellerId){refreshToken=clean(legacy?.refreshToken)||clean(legacy?.refresh_token);usedLegacyFallback=Boolean(refreshToken);}
    }
  }
  const storedSeller=clean(stored.sellerId)||clean(stored.seller_id);
  if(!refreshToken||!sellerId||(storedSeller&&storedSeller!==sellerId))throw new Error('cuenta Amazon sin credenciales');
  const clientId=clean(stored.clientId)||clean(stored.client_id),clientSecret=clean(stored.clientSecret)||clean(stored.client_secret);
  if((clientId||clientSecret)&&(!clientId||!clientSecret||clientId!==application.clientId||clientSecret!==application.clientSecret))throw new Error('La configuración heredada de Amazon requiere revisión.');
  const credentialVersion=Number(row.amazon_credential_version);
  if(!Number.isSafeInteger(credentialVersion)||credentialVersion<1)throw new Error('Versión de credenciales Amazon no válida.');
  if(usedLegacyFallback)console.warn('amazon_legacy_fallback_used',{integration_account_id:row.integration_account_id,owner_id:row.owner_id});
  return {...application,refreshToken,sellerId,appKey,credentialVersion};
}
