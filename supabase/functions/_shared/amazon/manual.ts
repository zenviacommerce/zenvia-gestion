function clean(value:unknown){return typeof value==='string'?value.trim():'';}
export function assertAmazonManagedFields(body:any){
  const forbidden=['appKey','sp_api_app_key','amazon_credential_version','credentialVersion','clientId','client_id','clientSecret','client_secret'];
  for(const source of [body,body?.config,body?.credentials])if(source&&forbidden.some(key=>Object.prototype.hasOwnProperty.call(source,key)))throw new Error('La aplicación Amazon se gestiona exclusivamente en el servidor.');
}
export async function commitAmazonManual(admin:any,caller:{user_id:string;workspace_id:string;data_owner_id:string},body:any,account?:any):Promise<string>{
  assertAmazonManagedFields(body);
  if(account&&account.sp_api_app_key!=='private_v1')throw new Error('Renueva esta cuenta mediante autorización Amazon.');
  const sellerId=clean(body?.credentials?.sellerId)||clean(body?.credentials?.seller_id)||clean(account?.external_account_id)||clean(body?.externalAccountId);
  const refreshToken=clean(body?.credentials?.refreshToken)||clean(body?.credentials?.refresh_token);
  if(!/^[A-Z0-9]{1,64}$/.test(sellerId)||!refreshToken)throw new Error('Indica Seller ID y refresh token de Amazon.');
  if(account&&sellerId!==account.external_account_id)throw new Error('La identidad de la cuenta Amazon no puede cambiar.');
  const config={...(body?.config||{})};delete config.archivedAt;delete config.revoked;delete config.revokedAt;
  const {data,error}=await admin.rpc('integration_amazon_commit_manual',{
    p_user_id:caller.user_id,p_workspace_id:caller.workspace_id,p_owner_id:caller.data_owner_id,
    p_integration_account_id:account?.id||null,p_seller_id:sellerId,p_refresh_token:refreshToken,
    p_display_name:clean(body?.displayName)||clean(account?.display_name)||`Amazon · ${sellerId}`,p_config:config,
    p_expected_version:account?.amazon_credential_version??null,
  });
  if(error)throw new Error('No se pudo guardar la autorización Amazon.');
  const result=Array.isArray(data)&&data.length===1?data[0]:null;
  if(!result?.integration_account_id)throw new Error('No se pudo guardar la autorización Amazon.');
  return result.integration_account_id;
}
export async function setAmazonEnabled(admin:any,caller:{user_id:string;workspace_id:string;data_owner_id:string},account:any,enabled:boolean):Promise<string>{
  const {data,error}=await admin.rpc('integration_amazon_set_enabled',{p_user_id:caller.user_id,p_workspace_id:caller.workspace_id,p_owner_id:caller.data_owner_id,p_integration_account_id:account.id,p_expected_version:account.amazon_credential_version,p_enabled:enabled});
  if(error||data!==account.id)throw new Error('No se pudo actualizar la cuenta Amazon.');
  return data;
}
function lifecycleArgs(caller:{user_id:string;workspace_id:string;data_owner_id:string},account:any){return {p_user_id:caller.user_id,p_workspace_id:caller.workspace_id,p_owner_id:caller.data_owner_id,p_integration_account_id:account.id,p_expected_version:account.amazon_credential_version};}
export async function archiveAmazon(admin:any,caller:{user_id:string;workspace_id:string;data_owner_id:string},account:any,archive:boolean):Promise<string>{
  const {data,error}=await admin.rpc('integration_amazon_archive',{...lifecycleArgs(caller,account),p_archive:archive});
  if(error||data!==account.id)throw new Error('No se pudo desconectar la cuenta Amazon.');return data;
}
export async function updateAmazonMetadata(admin:any,caller:{user_id:string;workspace_id:string;data_owner_id:string},account:any,body:any):Promise<string>{
  assertAmazonManagedFields(body);
  if(body?.config&&['archivedAt','revoked','revokedAt'].some(k=>Object.hasOwn(body.config,k)))throw new Error('Los campos de desconexión se gestionan en el servidor.');
  const {data,error}=await admin.rpc('integration_amazon_update_metadata',{...lifecycleArgs(caller,account),p_display_name:clean(body?.displayName)||null,p_config:body?.config||{}});
  if(error||data!==account.id)throw new Error('No se pudo actualizar la cuenta Amazon.');return data;
}
