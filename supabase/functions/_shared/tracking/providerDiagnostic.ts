// Operator-only, read-only provider evidence. Call only after internal key auth.
type EventSummary={type:string;phase:string;exception:string;sub_status:string;event_at:string;description:string};
type Probe={orderId:string;trackingNumber:string;accountMismatch:boolean;missingTrackingState:boolean;legacyWithoutParcel:boolean;httpStatus:number;events:EventSummary[]};
type AccountResult={accountId:string;subscriptions:{httpStatus:number;items:Array<{id:string|number;event_type:string;is_active:boolean;connection_id:string|number|null}>};probes:Probe[];error?:'UNAVAILABLE'|'CREDENTIALS_UNAVAILABLE'};
export type ProviderDiagnosticResult={accounts:AccountResult[];httpRequests:number;truncated:boolean};
const clean=(value:unknown)=>typeof value==='string'||typeof value==='number'?String(value).trim():'';
const terminal=(value:unknown)=>['DELIVERED','RETURNED','CANCELLED','CANCELED','DELIVERED_AT_ORIGIN','SHIPMENT_COLLECTED_BY_CUSTOMER'].includes(clean(value).toUpperCase().replace(/ /g,'_'));
export async function runProviderDiagnostic(admin:any,request:typeof fetch=fetch,environmentCredentials:Record<string,any>={}):Promise<ProviderDiagnosticResult>{
 const result:ProviderDiagnosticResult={accounts:[],httpRequests:0,truncated:false},started=Date.now();
 const selected=await admin.from('integration_accounts').select('id,owner_id,provider,enabled,status,secret_id,credential_source,config').eq('provider','sendcloud').eq('enabled',true).neq('status','disabled').limit(100);
 if(selected.error)throw Error('PROVIDER_DIAGNOSTIC_UNAVAILABLE');
 const accounts=(selected.data||[]).filter((a:any)=>!a.config?.archivedAt);
 const ownerCounts=new Map<string,number>();for(const a of accounts)ownerCounts.set(a.owner_id,(ownerCounts.get(a.owner_id)||0)+1);
 if(accounts.length>=100)result.truncated=true;
 for(const account of accounts){
  if(result.httpRequests>=25||Date.now()-started>=100000){result.truncated=true;break}
  const output:AccountResult={accountId:account.id,subscriptions:{httpStatus:0,items:[]},probes:[]};result.accounts.push(output);
  try{
   let credentials:any=account.credential_source==='environment'?{...(environmentCredentials.sendcloud||{})}:{};
   if(account.secret_id){const secret=await admin.rpc('integration_read_secret',{p_secret_id:account.secret_id});if(secret.error)throw Error('UNAVAILABLE');try{credentials={...credentials,...JSON.parse(String(secret.data||'{}'))}}catch{throw Error('UNAVAILABLE')}}
   const publicKey=clean(credentials.publicKey||credentials.public_key),secretKey=clean(credentials.secretKey||credentials.secret_key);
   if(!publicKey||!secretKey){output.error='CREDENTIALS_UNAVAILABLE';continue}
   const sanitize=(value:unknown,max=160)=>[publicKey,secretKey].reduce((s,secret)=>s.split(secret).join('[REDACTED]'),clean(value)).replace(/<[^>]*>/g,'').replace(/[\u0000-\u001f]/g,' ').slice(0,max);
   const get=async(path:string)=>{
    const remaining=100000-(Date.now()-started);if(result.httpRequests>=25||remaining<1000){result.truncated=true;return null}
    result.httpRequests++;
    try{
     const response=await request('https://panel.sendcloud.sc/api/'+path,{method:'GET',headers:{Authorization:'Basic '+btoa(publicKey+':'+secretKey)},signal:AbortSignal.timeout(Math.min(10000,remaining)),redirect:'error'});
     if(!response.ok){await response.body?.cancel();return {httpStatus:response.status,payload:null}}
     const body=await response.text();if(body.length>1000000)return {httpStatus:response.status,payload:null};
     let payload:any=null;try{payload=JSON.parse(body)}catch{/* No provider body crosses this boundary. */}
     return {httpStatus:response.status,payload};
    }catch{return {httpStatus:0,payload:null}}
   };
   const subscriptions=await get('v3/event-subscriptions/subscriptions');if(!subscriptions)break;
   output.subscriptions.httpStatus=subscriptions.httpStatus;
   const data=subscriptions.payload?.data??subscriptions.payload;
   const subscriptionsList=Array.isArray(data)?data:Array.isArray(data?.subscriptions)?data.subscriptions:[];
   output.subscriptions.items=subscriptionsList.slice(0,50).map((s:any)=>({id:typeof s.id==='number'?s.id:sanitize(s.id,80),event_type:sanitize(s.event_type,80),is_active:s.is_active===true,connection_id:s.connection_id==null?null:typeof s.connection_id==='number'?s.connection_id:sanitize(s.connection_id,80)}));
   if([401,403,429].includes(subscriptions.httpStatus))continue;
   const ordersResult=await admin.from('fulfillment_orders').select('id,owner_id,tracking_number,tracking_status_code,shipping_provider,shipping_integration_account_id,sendcloud_parcel_id').eq('owner_id',account.owner_id).is('pii_purged_at',null).is('label_cancelled_at',null).not('tracking_number','is',null).neq('tracking_number','').or('shipping_provider.eq.sendcloud,shipping_integration_account_id.eq.'+account.id).order('label_created_at',{ascending:false}).limit(400);
   if(ordersResult.error){output.error='UNAVAILABLE';continue}
   const orders=ordersResult.data||[];if(orders.length>=400)result.truncated=true;
   const statesResult=orders.length?await admin.from('shipment_tracking_state').select('order_id,normalized_state').eq('owner_id',account.owner_id).in('order_id',orders.map((o:any)=>o.id)):{data:[],error:null};
   if(statesResult.error){output.error='UNAVAILABLE';continue}
   const states=new Map<string,any>((statesResult.data||[]).map((s:any)=>[s.order_id,s]));
   const candidates=orders.filter((o:any)=>{
    if(o.owner_id!==account.owner_id||!clean(o.tracking_number)||terminal(o.tracking_status_code)||terminal(states.get(o.id)?.normalized_state))return false;
    if(o.shipping_provider==='sendcloud')return o.shipping_integration_account_id===account.id||(accounts.length<100&&ownerCounts.get(account.owner_id)===1);
    return !o.shipping_provider&&o.shipping_integration_account_id===account.id;
   }).sort((a:any,b:any)=>{
    const priority=(o:any)=>o.shipping_provider==='sendcloud'&&o.shipping_integration_account_id!==account.id?0:!o.shipping_provider&&!o.sendcloud_parcel_id?1:2;
    return priority(a)-priority(b);
   });
   for(const order of candidates){
    const response=await get('v3/parcels/tracking/'+encodeURIComponent(order.tracking_number));if(!response)break;
    const raw=response.payload?.data??response.payload;
    const events=(Array.isArray(raw?.events)?raw.events:[]).slice().sort((a:any,b:any)=>(Date.parse(b.event_at)||0)-(Date.parse(a.event_at)||0)).slice(0,8).map((e:any)=>({type:sanitize(e.event_type,80),phase:sanitize(e.phase,80),exception:sanitize(e.exception,80),sub_status:sanitize(e.sub_status,80),event_at:sanitize(e.event_at,80),description:sanitize(e.description)}));
    output.probes.push({orderId:order.id,trackingNumber:order.tracking_number,accountMismatch:order.shipping_integration_account_id!==account.id,missingTrackingState:!states.has(order.id),legacyWithoutParcel:!order.shipping_provider&&!order.sendcloud_parcel_id,httpStatus:response.httpStatus,events});
    if([401,403,429].includes(response.httpStatus))break;
   }
  }catch{output.error='UNAVAILABLE'}
 }
 return result;
}
