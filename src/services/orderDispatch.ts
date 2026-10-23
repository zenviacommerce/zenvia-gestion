import type {FulfillmentOrder} from './orders';
import {getActiveSupabase} from './supabase';
import {isLabelledOrder} from './orderStatus';
export const dispatchCauseLabel={tracking:'Primer movimiento del transportista',signed_report:'Informe de recogida firmado',manual:'Salida registrada manualmente'};
export function labelWaitingHours(order:FulfillmentOrder,now=Date.now()){
 if(!isLabelledOrder(order)||!order.labelCreatedAt)return null;
 const time=Date.parse(order.labelCreatedAt);return Number.isFinite(time)?Math.max(0,(now-time)/3600000):null;
}
export async function markOrdersDispatched(orders:FulfillmentOrder[]){
 if(!orders.length||orders.length>2000||new Set(orders.map(o=>o.id)).size!==orders.length||orders.some(o=>!o.logisticsIdentity||!isLabelledOrder(o)))throw Error('La selección contiene etiquetas que han cambiado. Actualiza los pedidos y vuelve a comprobarla.');
 const {data,error}=await getActiveSupabase().rpc('order_logistics_mark_sent',{p_items:orders.map(o=>({id:o.id,identity:o.logisticsIdentity}))}).abortSignal(AbortSignal.timeout(15000));
 if(error)throw Error(error.message?.includes('LOGISTICS_')?'La etiqueta o la selección ha cambiado. Actualiza los pedidos y vuelve a comprobarla.':error.message);
 if(!data||!Number.isInteger(data.marked)||data.selected!==orders.length)throw Error('No se pudo comprobar el resultado. Actualiza los pedidos antes de reintentar.');
 return data as {marked:number;selected:number};
}
