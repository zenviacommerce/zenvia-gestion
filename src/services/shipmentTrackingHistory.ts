import {supabase} from './supabase';
import type {TrackingState} from '../../supabase/functions/_shared/tracking/policy';
export type ShipmentTrackingEvent={state:TrackingState|null;code:string|null;message:string|null;eventAt:string|null;eventTimeRaw:string|null;observedAt:string};
export async function loadShipmentTrackingEvents(orderId:string):Promise<ShipmentTrackingEvent[]>{
 const {data,error}=await supabase.rpc('tracking_order_events_v1',{p_order:orderId});
 if(error)throw error;
 return (data||[]).map((row:any)=>({state:row.normalized_state,code:row.raw_code,message:row.raw_message,eventAt:row.event_at,eventTimeRaw:row.raw_event_time,observedAt:row.observed_at}));
}
