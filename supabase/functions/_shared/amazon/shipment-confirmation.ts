import {executeAmazonConfirmation} from './confirmation-protocol.ts';
import { sanitizeAmazonError } from './http.ts';
import { spApiRequest } from './sp-api.ts';
import { loadAmazonSpApiCredentials, type AmazonSpApiCredentials } from './config.ts';

type FulfillmentOrderRow={
  id:string;owner_id:string;order_id?:string|null;order_number?:string|null;source_channel?:string|null;source_integration_account_id?:string|null;
  tracking_number?:string|null;sendcloud_parcel_id?:number|string|null;carrier_code?:string|null;carrier_name?:string|null;
  shipping_service_name?:string|null;label_created_at?:string|null;fulfilled_at?:string|null;tracking_updated_at?:string|null;
  order_updated_at?:string|null;amazon_tracking_synced_at?:string|null;amazon_tracking_sync_error?:string|null;
  amazon_tracking_sync_attempts?:number|null;amazon_tracking_last_attempt_at?:string|null;
};

type AmazonOrderContext={amazonOrderId:string;marketplaceId:string;amazonAccountId:string;orderItems:Array<{orderItemId:string;quantity:number}>};
export type AmazonTrackingSyncResult={orderId:string;amazonOrderId:string;status:'confirmed'|'already_synced'|'pending_verification'|'needs_review'|'rejected';trackingNumber:string;packageReferenceId:string|null};
export type AmazonTrackingOverride={trackingNumber?:string|null;trackingUrl?:string|null;parcelId?:number|string|null;carrierCode?:string|null;carrierName?:string|null;shippingServiceName?:string|null;labelCreatedAt?:string|null};

function clean(value:unknown){return String(value??'').trim();}
function withTrackingOverride(order:FulfillmentOrderRow,override?:AmazonTrackingOverride):FulfillmentOrderRow{
  if(!override)return order;
  return {
    ...order,
    tracking_number:override.trackingNumber??order.tracking_number,
    sendcloud_parcel_id:override.parcelId??order.sendcloud_parcel_id,
    carrier_code:override.carrierCode??order.carrier_code,
    carrier_name:override.carrierName??order.carrier_name,
    shipping_service_name:override.shippingServiceName??order.shipping_service_name,
    label_created_at:override.labelCreatedAt??order.label_created_at,
  };
}
function amazonOrderId(order:FulfillmentOrderRow){
  const candidates=[order.order_id,order.order_number].map(clean).filter(Boolean);
  const found=candidates.find(value=>/^\d{3}-\d{7}-\d{7}$/.test(value));
  if(!found)throw new Error('El pedido no contiene un Amazon Order ID válido.');
  return found;
}
function positivePackageReference(value:unknown){const text=clean(value);return /^\d+$/.test(text)&&Number(text)>0?text:null;}
function carrier(order:FulfillmentOrderRow){
  const raw=`${clean(order.carrier_code)} ${clean(order.carrier_name)} ${clean(order.shipping_service_name)}`.toLowerCase();
  if(raw.includes('mrw'))return {carrierCode:'MRW',carrierName:'MRW'};
  if(raw.includes('correos express'))return {carrierCode:'Correos Express',carrierName:'Correos Express'};
  if(raw.includes('correos'))return {carrierCode:'Correos',carrierName:'Correos'};
  if(raw.includes('seur'))return {carrierCode:'SEUR',carrierName:'SEUR'};
  if(raw.includes('gls'))return {carrierCode:'GLS',carrierName:'GLS'};
  if(raw.includes('ups'))return {carrierCode:'UPS',carrierName:'UPS'};
  if(raw.includes('dhl'))return {carrierCode:'DHL',carrierName:'DHL'};
  const name=clean(order.carrier_name)||clean(order.carrier_code)||'Transportista';
  return {carrierCode:'Other',carrierName:name};
}
async function loadContext(admin:any,order:FulfillmentOrderRow):Promise<AmazonOrderContext>{
  const orderId=amazonOrderId(order);
  let expectedAmazonAccountId='';
  if(order.source_integration_account_id){
    const {data:integration,error:integrationError}=await admin.from('integration_accounts')
      .select('linked_resource_id').eq('owner_id',order.owner_id).eq('provider','amazon').eq('id',order.source_integration_account_id).maybeSingle();
    if(integrationError)throw integrationError;
    expectedAmazonAccountId=clean(integration?.linked_resource_id);
  }
  let orderQuery=admin.from('amazon_orders').select('amazon_account_id,marketplace_id,fulfillment_channel')
    .eq('owner_id',order.owner_id).eq('amazon_order_id',orderId);
  if(expectedAmazonAccountId)orderQuery=orderQuery.eq('amazon_account_id',expectedAmazonAccountId);
  const {data:amazonRows,error:amazonError}=await orderQuery.limit(2);
  if(amazonError)throw amazonError;
  if(!amazonRows?.length)throw new Error(`Amazon todavía no ha sincronizado el pedido ${orderId}.`);
  if(amazonRows.length!==1)throw new Error(`El pedido ${orderId} aparece en más de una cuenta o marketplace de Amazon.`);
  if(amazonRows[0].fulfillment_channel!=='MFN')throw new Error('La confirmación solo admite pedidos FBM.');
  const amazonAccountId=clean(amazonRows[0].amazon_account_id);if(!amazonAccountId)throw new Error(`El pedido ${orderId} no tiene cuenta Amazon asociada.`);
  const marketplaceId=clean(amazonRows[0].marketplace_id);if(!marketplaceId)throw new Error(`El pedido ${orderId} no tiene marketplace asociado.`);
  const {data:itemRows,error:itemError}=await admin.from('amazon_order_items').select('order_item_id,quantity_ordered')
    .eq('owner_id',order.owner_id).eq('amazon_account_id',amazonAccountId).eq('amazon_order_id',orderId).eq('marketplace_id',marketplaceId).gt('quantity_ordered',0);
  if(itemError)throw itemError;
  const orderItems=(itemRows||[]).map((item:any)=>({orderItemId:clean(item.order_item_id),quantity:Math.max(1,Math.trunc(Number(item.quantity_ordered)||0))})).filter((item:any)=>item.orderItemId);
  if(!orderItems.length)throw new Error(`Amazon todavía no ha sincronizado las líneas del pedido ${orderId}.`);
  return {amazonOrderId:orderId,marketplaceId,amazonAccountId,orderItems};
}
function trackingPayload(order:FulfillmentOrderRow,context:AmazonOrderContext,packageReferenceId:string|null){
 const carrierData=carrier(order),shipDate=order.label_created_at||order.fulfilled_at||order.tracking_updated_at||order.order_updated_at||new Date().toISOString();
 const packageDetail:any={packageReferenceId,...carrierData,trackingNumber:clean(order.tracking_number),shipDate:new Date(shipDate).toISOString(),orderItems:context.orderItems};
 const shippingMethod=clean(order.shipping_service_name);if(shippingMethod)packageDetail.shippingMethod=shippingMethod;
 return {marketplaceId:context.marketplaceId,packageDetail};
}
export async function authorizeReviewedAmazonTracking(admin:any,order:FulfillmentOrderRow,actor:string,reason:string,override?:AmazonTrackingOverride,reviewedReference?:string){
 const requested=withTrackingOverride(order,override),context=await loadContext(admin,requested);
 const {data:existing,error}=await admin.from('amazon_confirmation_operations').select('package_reference_id').eq('order_id',order.id).eq('owner_id',order.owner_id).maybeSingle();
 if(error)throw error;
 const reference=positivePackageReference(reviewedReference)||positivePackageReference(existing?.package_reference_id);
 if(!reference)throw new Error('Indica la referencia de paquete comprobada durante la revisión.');
 const {data,error:authorizationError}=await admin.rpc('amazon_confirmation_authorize',{p_order_id:order.id,p_owner_id:order.owner_id,p_actor:actor,p_reason:reason,p_payload:trackingPayload(requested,context,reference)});
 if(authorizationError)throw authorizationError;return data;
}
// Apply one abort signal to every PostgREST query in a bounded verification invocation.
function deadlineAdmin(admin:any,signal:AbortSignal){
 const wrap=(query:any):any=>new Proxy(query,{get(target,key){
  if(key==='then')return (resolve:any,reject:any)=>{const bounded=typeof target.abortSignal==='function'?target.abortSignal(signal):target;return bounded.then(resolve,reject)};
  const value=Reflect.get(target,key);return typeof value==='function'?(...args:any[])=>wrap(value.apply(target,args)):value;
 }});
 return {from:(...args:any[])=>wrap(admin.from(...args)),rpc:(...args:any[])=>wrap(admin.rpc(...args))};
}
async function currentPackages(orderId:string,credentials:AmazonSpApiCredentials,signal:AbortSignal){
  const data:any=await spApiRequest(`/orders/2026-01-01/orders/${encodeURIComponent(orderId)}`,{query:{includedData:['PACKAGES']},maxAttempts:2,signal},credentials);
  const current=data?.order||data?.Order||data||{};
  if(current?.orderId!==orderId||current.packages!=null&&!Array.isArray(current.packages))throw new Error('Amazon devolvió evidencia incompleta del pedido.');
  return current.packages||[];
}
export async function syncAmazonTracking(admin:any,order:FulfillmentOrderRow,override?:AmazonTrackingOverride,options:{deadline?:number}={}):Promise<AmazonTrackingSyncResult>{
  const deadline=options.deadline??Date.now()+60_000;
  if(deadline<=Date.now())throw new Error('Presupuesto de verificación agotado');
  const signal=AbortSignal.timeout(Math.max(1,deadline-Date.now()));
  admin=deadlineAdmin(admin,signal);
  const requested=withTrackingOverride(order,override),trackingNumber=clean(requested.tracking_number);
  if(requested.source_channel!=='amazon')throw new Error('El pedido no procede de Amazon.');
  if(!trackingNumber)throw new Error('El pedido todavía no tiene número de seguimiento.');
  const context=await loadContext(admin,requested);
  // Context is scoped before credentials, ledger or external HTTP access.
  const credentials=await loadAmazonSpApiCredentials(admin,{amazonAccountId:context.amazonAccountId,integrationAccountId:requested.source_integration_account_id,ownerId:requested.owner_id});
  const {data:existing,error}=await admin.from('amazon_confirmation_operations').select('*').eq('order_id',requested.id).eq('owner_id',requested.owner_id).maybeSingle();
  if(error)throw error;
  // Reuse the frozen reference. Never invent an old reference for an uncertain legacy attempt.
  const legacy=Number(requested.amazon_tracking_sync_attempts)>0;
  const packageReferenceId=existing?.package_reference_id||(legacy?null:positivePackageReference(requested.sendcloud_parcel_id)||'1');
  const holder=crypto.randomUUID();
  // An explicit override must pass the immutable hash guard, even for a reviewed revision.
  const payload=['pending_verification','prepared'].includes(existing?.state)&&existing.payload&&!override?existing.payload:trackingPayload(requested,context,packageReferenceId);
  let requestId:string|null=null;
  const store={
    async begin(){
      const {data,error}=await admin.rpc('amazon_confirmation_begin',{p_order_id:requested.id,p_owner_id:requested.owner_id,p_account_id:context.amazonAccountId,p_marketplace_id:context.marketplaceId,p_payload:payload,p_holder:holder});
      if(error)throw error;return data;
    },
    async authorizePost(operation:any){
      const {data,error}=await admin.rpc('amazon_confirmation_dispatch',{p_order_id:requested.id,p_owner_id:requested.owner_id,p_holder:holder,p_fence:operation.fence});
      if(error)throw error;return data===true;
    },
    async finish(operation:any,state:string,message?:string,status?:number){
      const {data,error}=await admin.rpc('amazon_confirmation_finish',{p_order_id:requested.id,p_owner_id:requested.owner_id,p_holder:holder,p_fence:operation.fence,p_state:state,p_message:message||null,p_http_status:status??null,p_request_id:requestId});
      if(error)throw error;return data;
    },
  };
  const operation=await executeAmazonConfirmation(store,{payload},{
    read:()=>currentPackages(context.amazonOrderId,credentials,signal),
    post:body=>spApiRequest(`/orders/v0/orders/${encodeURIComponent(context.amazonOrderId)}/shipmentConfirmation`,{method:'POST',maxAttempts:1,body,signal,onResponse:metadata=>{requestId=metadata.requestId}},credentials),
  });
  return {orderId:requested.id,amazonOrderId:context.amazonOrderId,status:operation.state,trackingNumber:clean(operation.payload?.packageDetail?.trackingNumber)||trackingNumber,packageReferenceId:operation.package_reference_id||null};
}

export async function retryPendingAmazonTracking(admin:any,ownerId:string,limit=5,force=false,budgetMs=20_000){
  const deadline=Date.now()+Math.max(0,Math.min(20_000,budgetMs));
  if(deadline<=Date.now())return {attempted:0,succeeded:0,pending:0,needsReview:0,failed:0,results:[]};
  admin=deadlineAdmin(admin,AbortSignal.timeout(Math.max(1,deadline-Date.now())));
  const safeLimit=Math.max(1,Math.min(25,Math.trunc(Number(limit)||5)));
  const {data,error}=await admin.rpc('amazon_confirmation_due',{p_owner_id:ownerId,p_limit:safeLimit,p_include_fresh:force});
  if(error)throw error;
  const results:any[]=[];
  for(const order of data||[]){
    if(results.length>=safeLimit||Date.now()>=deadline)break;
    try{const result=await syncAmazonTracking(admin,order,undefined,{deadline});results.push({...result,ok:true})}
    catch(syncError){results.push({orderId:order.id,ok:false,error:sanitizeAmazonError(syncError instanceof Error?syncError.message:syncError)})}
  }
  return {attempted:results.length,succeeded:results.filter(item=>item.ok&&['confirmed','already_synced'].includes(item.status)).length,pending:results.filter(item=>item.ok&&item.status==='pending_verification').length,needsReview:results.filter(item=>item.ok&&item.status==='needs_review').length,failed:results.filter(item=>!item.ok||item.status==='rejected').length,results};
}
