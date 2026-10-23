import {getActiveSupabase} from './supabase';
export type ShipmentHistoryEntry={id:string;provider:string|null;carrier:string|null;trackingNumber:string|null;shipmentReference:string|null;cancelledAt:string|null};
export async function loadOrderShipmentHistory(orderId:string):Promise<ShipmentHistoryEntry[]>{
 const {data,error}=await getActiveSupabase().from('order_shipment_history').select('id,provider,carrier,tracking_number,shipment_reference,cancelled_at').eq('order_id',orderId).order('recorded_at',{ascending:false}).abortSignal(AbortSignal.timeout(15000));
 if(error)throw new Error('No se pudo cargar el historial de expediciones.');
 return (data||[]).map(row=>({id:row.id,provider:row.provider,carrier:row.carrier,trackingNumber:row.tracking_number,shipmentReference:row.shipment_reference,cancelledAt:row.cancelled_at}));
}
