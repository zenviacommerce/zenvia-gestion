export async function carrierCredentialIdentity(provider:string,credentials:any):Promise<string>{
 const clean=(v:unknown)=>String(v??'').trim();
 const identity=provider==='mrw'?[provider,clean(credentials.username||credentials.userName||credentials.usuario),clean(credentials.franchiseCode||credentials.codigoFranquicia),clean(credentials.subscriberCode||credentials.codigoAbonado),clean(credentials.departmentCode||credentials.codigoDepartamento)]:provider==='sendcloud'?[provider,clean(credentials.publicKey||credentials.public_key)]:[provider,clean(credentials.token||credentials.apiToken||credentials.api_token)];
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(identity)));
 return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
}
export type CarrierCreationConfig={provider:'mrw'|'sendcloud'|'envia';accountId:string;actorId?:string;context:Record<string,unknown>;credentials?:Record<string,unknown>;environment?:'production'|'test'};
export async function withCarrierCreation<T>(admin:any,order:any,config:CarrierCreationConfig,operation:()=>Promise<T>):Promise<T>{
 const context={...config.context,environment:config.environment||'production',...(config.credentials?{credentialIdentity:await carrierCredentialIdentity(config.provider,config.credentials)}:{})};
 const claim=await admin.rpc('shipping_creation_begin',{p_owner_id:order.owner_id,p_order_id:order.id,p_provider:config.provider,p_account_id:config.accountId,p_reference:String(order.order_number||order.order_id||order.id),p_context:context,p_actor_id:config.actorId||null});
 const provider=config.provider==='mrw'?'MRW':config.provider==='envia'?'Envia':'Sendcloud';
 if(claim.error||typeof claim.data!=='string'||!/^[a-f0-9-]{36}$/i.test(claim.data)){
  if(String(claim.error?.message||'').includes('CREATION_RECONCILIATION_REQUIRED'))throw new Error(`Hay un intento de envío pendiente de comprobar. Usa «Comprobar con ${provider}» antes de generar otra etiqueta.`);
  throw new Error('No se pudo proteger el intento de envío. No se ha enviado una nueva solicitud al transportista.');
 }
 const note=async(result:string)=>{
  const response=await admin.rpc('shipping_creation_note',{p_id:claim.data,p_owner_id:order.owner_id,p_result:result});
  if(response.error)throw Error('CREATION_NOTE_FAILED');
 };
 try{
  const result=await operation();await note('accepted');return result;
 }catch(error){
  const failure=error as any;
  const rejected=failure?.definitiveShipmentRejection===true||failure?.cause?.definitiveShipmentRejection===true;
  try{await note(rejected?'rejected':'uncertain')}catch{console.warn('SHIPPING_CREATION_NOTE_FAILED')}
  throw error;
 }
}
