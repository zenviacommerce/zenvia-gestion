import {carrierCredentialIdentity} from './shippingCreation.ts';
import {lookupCarrierReference,type CreationAttempt} from './shippingReferenceLookup.ts';
export async function reconcileShipmentCreation(admin:any,ownerId:string,orderId:string,request:typeof fetch=fetch){
 let claimed=await admin.rpc('shipping_creation_reconcile_claim',{p_owner_id:ownerId,p_order_id:orderId});
 if(claimed.error&&String(claimed.error.message||'').includes('CREATION_NO_OPEN_ATTEMPT')){
  const adopted=await admin.rpc('shipping_creation_adopt',{p_owner_id:ownerId,p_order_id:orderId});if(adopted.error)throw adopted.error;
  claimed=await admin.rpc('shipping_creation_reconcile_claim',{p_owner_id:ownerId,p_order_id:orderId});
 }
 if(claimed.error)throw claimed.error;
 if(claimed.data?.alreadyAccepted===true)return {status:'recovered',provider:claimed.data.provider,orderId:claimed.data.orderId};
 const attempt=claimed.data as CreationAttempt&{token:string;canRelease:boolean};
 if(!attempt?.id||!attempt.token||attempt.ownerId!==ownerId||attempt.orderId!==orderId)throw Error('CREATION_CLAIM_INVALID');
 let result='unknown',shipment:Record<string,unknown>={};
 try{
  const selected=await admin.from('integration_accounts').select('id,owner_id,provider,enabled,status,secret_id,credential_source,config').eq('id',attempt.accountId).eq('owner_id',ownerId).eq('provider',attempt.provider).maybeSingle();
  const account=selected.data;
  if(selected.error||!account||account.enabled!==true||account.status==='disabled')throw Error('CREATION_ACCOUNT_INVALID');
  const environment=account.provider==='envia'?(account.config?.environment==='production'?'production':'test'):(account.config?.environment==='test'?'test':'production');
  if(attempt.context.environment&&attempt.context.environment!==environment)throw Error('CREATION_ACCOUNT_CHANGED');
  let credentials:any;
  if(account.secret_id){const secret=await admin.rpc('integration_read_secret',{p_secret_id:account.secret_id});if(secret.error)throw Error('CREATION_LOOKUP_CREDENTIALS');credentials=JSON.parse(String(secret.data||'{}'));}
  else if(account.provider==='sendcloud'&&account.credential_source==='environment'){
   const env=(globalThis as any).Deno?.env;credentials={publicKey:env?.get('SENDCLOUD_PUBLIC_KEY')||env?.get('SENDCLOUD_API_KEY'),secretKey:env?.get('SENDCLOUD_SECRET_KEY')||env?.get('SENDCLOUD_API_SECRET')};
  }else throw Error('CREATION_LOOKUP_CREDENTIALS');
  if(account.provider==='sendcloud'&&account.credential_source==='environment'){const env=(globalThis as any).Deno?.env;credentials={...credentials,publicKey:credentials.publicKey||credentials.public_key||env?.get('SENDCLOUD_PUBLIC_KEY')||env?.get('SENDCLOUD_API_KEY'),secretKey:credentials.secretKey||credentials.secret_key||env?.get('SENDCLOUD_SECRET_KEY')||env?.get('SENDCLOUD_API_SECRET')};}
  if(attempt.context.credentialIdentity&&attempt.context.credentialIdentity!==await carrierCredentialIdentity(attempt.provider,credentials))throw Error('CREATION_ACCOUNT_CHANGED');
  const lookup=await lookupCarrierReference(attempt,account,credentials,request);
  if(lookup.status==='found'){result='found';shipment=lookup.shipment}
  else if(attempt.canRelease)result='absent';
 }catch{/* No provider or credential text leaves this service or reaches logs. Unknown is not absence. */}
 const resolved=await admin.rpc('shipping_creation_resolve',{p_id:attempt.id,p_token:attempt.token,p_result:result,p_shipment:shipment});
 if(resolved.error)throw resolved.error;
 return resolved.data;
}
