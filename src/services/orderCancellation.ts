import {getActiveSupabase} from './supabase';
import type {FulfillmentOrder} from './orders';
export type CancellationStatus='submitting'|'pending'|'unknown'|'confirmed'|'rejected';
export type CancellationOperation={id:string;status:CancellationStatus;provider:string;message:string|null;created_at:string;updated_at?:string;details:{shippingAccountId?:string|null;shipmentRef?:string;trackingNumber?:string|null;labelCreatedAt?:string|null}};
export const cancellationUncertain=(op:CancellationOperation)=>['submitting','pending','unknown'].includes(op.status);
export function cancellationIdentity(order:FulfillmentOrder){return{provider:order.shippingProvider||'sendcloud',accountId:order.shippingIntegrationAccountId??null,reference:String(order.shippingRemoteId||order.sendcloudParcelId||order.trackingNumber||''),trackingNumber:order.trackingNumber??null,labelCreatedAt:order.labelCreatedAt??null}}
export function cancellationMatches(order:FulfillmentOrder,op:CancellationOperation){const i=cancellationIdentity(order),d=op.details;return op.provider===i.provider&&(d.shippingAccountId??null)===i.accountId&&d.shipmentRef===i.reference&&(d.trackingNumber??null)===i.trackingNumber&&(d.labelCreatedAt===i.labelCreatedAt||(d.labelCreatedAt!=null&&i.labelCreatedAt!=null&&Date.parse(d.labelCreatedAt)===Date.parse(i.labelCreatedAt)))}
export async function loadOrderCancellations(orderId:string):Promise<CancellationOperation[]>{
 const{data,error}=await getActiveSupabase().from('order_cancellation_operations').select('id,status,provider,message,created_at,updated_at,details').eq('order_id',orderId).eq('kind','label').order('created_at',{ascending:false}).limit(50).abortSignal(AbortSignal.timeout(15000));
 if(error)throw Error('No se pudieron cargar las solicitudes de cancelación.');return data||[];
}
async function invoke(body:Record<string,unknown>):Promise<CancellationOperation[]>{const{data,error}=await getActiveSupabase().functions.invoke('order-cancellation',{body});if(error){let payload:any;try{payload=await error.context?.json()}catch{/* No vendor error reflection. */}throw Error(payload?.code==='MFA_REQUIRED'?'Verifica tu sesión con MFA antes de continuar.':'No se pudo confirmar el resultado. Actualiza el pedido antes de intentarlo de nuevo.')}if(!data?.ok||!Array.isArray(data.operations))throw Error('No se pudo confirmar el resultado. Actualiza el pedido.');return data.operations}
export const cancelOrderShipment=(order:FulfillmentOrder)=>invoke({action:'cancel',kind:'label',orderId:order.id,expected:cancellationIdentity(order)});
export const refreshOrderCancellation=(orderId:string)=>invoke({action:'refresh',kind:'label',orderId});
export async function loadCancellationAccountName(order:FulfillmentOrder):Promise<string>{
 const{data,error}=await getActiveSupabase().functions.invoke('order-cancellation',{body:{action:'context',orderId:order.id,expected:cancellationIdentity(order)}});
 if(error||!data?.ok||typeof data.accountName!=='string'||!data.accountName.trim())throw Error('No se pudo verificar la cuenta de transporte.');return data.accountName;
}
