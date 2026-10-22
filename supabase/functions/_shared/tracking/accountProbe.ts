import {pollShipment} from './adapters.ts';

export type MrwTrackingProbeCode=
 |'MRW_TRACKING_OK'|'MRW_TRACKING_ACCOUNT_NOT_FOUND'|'MRW_TRACKING_UNSUPPORTED_PROVIDER'
 |'MRW_TRACKING_NO_SHIPMENT'|'MRW_TRACKING_PASSWORD_REQUIRED'|'MRW_TRACKING_ACCESS_DENIED'
 |'MRW_TRACKING_REJECTED'|'MRW_TRACKING_FAILED';
export type MrwTrackingProbeResult={ok:boolean;code:MrwTrackingProbeCode;checkedAt:string};
const clean=(value:unknown)=>typeof value==='string'?value.trim():'';

// Called only after integration administrator authentication and human MFA.
// Read-only: this path must never persist account health or order/tracking state.
// The request body contributes only an account ID, never a shipment or credentials.
export async function probeMrwTrackingAccount(admin:any,ownerId:string,accountId:string,request:typeof fetch=fetch,checkedAt=new Date().toISOString()):Promise<MrwTrackingProbeResult>{
 const result=(code:MrwTrackingProbeCode):MrwTrackingProbeResult=>({ok:code==='MRW_TRACKING_OK',code,checkedAt});
 try{
  const accountResult=await admin.from('integration_accounts').select('id,owner_id,provider,secret_id,config')
   .eq('owner_id',ownerId).eq('id',accountId).maybeSingle();
  if(accountResult.error) return result('MRW_TRACKING_FAILED');
  const account=accountResult.data;
  if(!account||account.config?.archivedAt)return result('MRW_TRACKING_ACCOUNT_NOT_FOUND');
  if(account.provider!=='mrw')return result('MRW_TRACKING_UNSUPPORTED_PROVIDER');
  const shipmentResult=await admin.from('fulfillment_orders').select('tracking_number')
   .eq('owner_id',ownerId).eq('shipping_provider','mrw').eq('shipping_integration_account_id',account.id)
   .is('pii_purged_at',null).not('tracking_number','is',null).neq('tracking_number','').limit(1).maybeSingle();
  if(shipmentResult.error)return result('MRW_TRACKING_FAILED');
  const tracking=clean(shipmentResult.data?.tracking_number);
  if(!tracking)return result('MRW_TRACKING_NO_SHIPMENT');
  if(!account.secret_id)return result('MRW_TRACKING_PASSWORD_REQUIRED');
  const secret=await admin.rpc('integration_read_secret',{p_secret_id:account.secret_id});
  if(secret.error)return result('MRW_TRACKING_FAILED');
  const stored=JSON.parse(String(secret.data||'{}'));
  const trackingPassword=clean(stored?.trackingPassword)||clean(stored?.tracking_password);
  if(!trackingPassword)return result('MRW_TRACKING_PASSWORD_REQUIRED');
  // Do not pass the SAGEC password (or other unrelated stored secrets) to tracking.
  await pollShipment(account,{
   trackingPassword,
   franchiseCode:clean(stored?.franchiseCode)||clean(stored?.codigoFranquicia),
   subscriberCode:clean(stored?.subscriberCode)||clean(stored?.codigoAbonado),
  },tracking,request);
  return result('MRW_TRACKING_OK');
 }catch(error){
  // Only these exact, locally defined outcomes may cross this boundary. Never
  // return raw SOAP/XML, provider messages, shipment data, or exception details.
  const code=error instanceof Error?error.message:'';
  if(code==='MRW_TRACKING_ACCESS_DENIED'||code==='MRW_TRACKING_REJECTED')return result(code);
  return result('MRW_TRACKING_FAILED');
 }
}
