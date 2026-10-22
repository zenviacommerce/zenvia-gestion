export type TrackingState='pre_transit'|'in_transit'|'out_for_delivery'|'delivered'|'exception'|'returned'|'cancelled';
export type Movement={state:TrackingState|null;code:string;message:string;eventAt:string|null;eventTimeRaw?:string|null;history?:Movement[];warningCode?:string;observedAt?:string;movementAt?:string|null};
const key=(v:unknown)=>String(v??'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[ -]+/g,'_');
const envio:Record<string,TrackingState>={1:'pre_transit',2:'in_transit',3:'delivered',4:'cancelled',7:'pre_transit',8:'in_transit',9:'out_for_delivery',10:'exception',11:'returned',12:'exception',13:'returned',14:'exception',15:'in_transit',16:'pre_transit',17:'exception',18:'exception',19:'exception',20:'exception',21:'exception',22:'exception',23:'exception',24:'exception',25:'exception',26:'in_transit',27:'in_transit',28:'exception',created:'pre_transit',shipped:'in_transit',delivered:'delivered',canceled:'cancelled',cancelled:'cancelled',returned:'returned',delivered_at_origin:'returned',out_for_delivery:'out_for_delivery',picked_up:'in_transit',pickup_at_office:'exception'};
const phases:Record<string,TrackingState>={no_label:'pre_transit',announcing:'pre_transit',announced:'pre_transit',ready_to_send:'pre_transit',labelled:'pre_transit',dropped:'in_transit',accepted:'in_transit',sorted:'in_transit',in_transit:'in_transit',customs:'in_transit',in_delivery:'out_for_delivery',attempted:'exception',pup:'exception',delivered:'delivered'};
const legacy:Record<string,TrackingState>={...envio,driver_on_route:'out_for_delivery',driver_en_route:'out_for_delivery',delivery_failed:'exception',awaiting_customer_pickup:'exception',delivery_date_changed:'exception',returned_to_sender:'returned',ready_to_send:'pre_transit',announced:'pre_transit',parcel_en_route:'in_transit',shipment_collected_by_customer:'delivered',address_invalid:'exception',delivery_delayed:'exception'};
const mrw:Record<string,TrackingState>={entregado:'delivered',entregada:'delivered',en_reparto:'out_for_delivery',en_transito:'in_transit',recogido:'in_transit',pendiente_de_recoger:'pre_transit',en_oficina:'exception',incidencia:'exception',ausente:'exception',devuelto:'returned',anulado:'cancelled'};
// Observed on the authenticated TrackingService GetEnvios diagnostic (2026-10-22).
const mrwCodes:Record<string,TrackingState>={'00':'delivered','16':'out_for_delivery','79':'in_transit','57':'in_transit','17':'in_transit','47':'pre_transit','48':'pre_transit','33':'in_transit','35':'exception','59':'in_transit','72':'in_transit','91':'in_transit'};
const lookup=(map:Record<string,TrackingState>,value:string)=>Object.prototype.hasOwnProperty.call(map,value)?map[value]:null;
export function normalizeStatus(provider:string,code:unknown,detail:unknown='',eventType='carrier'):TrackingState|null{
 if(eventType==='claim')return null;
 const c=key(code),d=key(detail);
 if(provider==='envia')return lookup(envio,c);
 if(provider==='mrw')return lookup(mrwCodes,c)||lookup(mrw,d);
 if(provider==='sendcloud'){
  if(c==='delivery_forced')return null;
  if(d==='cancelled'||d==='cancelled_upstream')return 'cancelled';
  if(d&&d!=='none'&&d!=='unknown')return 'exception';
  return lookup(phases,c);
 }
 return lookup(legacy,c);
}
const validDate=(value:string|null|undefined)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
export function reduceMovement(previous:Movement|null,event:Movement,now:string):Movement{
 const eventAt=validDate(event.eventAt);
 const retainHistory=(base:Movement)=>event.history?{...base,history:event.history}:base;
 if(previous?.eventAt&&eventAt&&Date.parse(eventAt)<Date.parse(previous.eventAt))return retainHistory(previous);
 if(previous?.eventTimeRaw&&event.eventTimeRaw&&event.eventTimeRaw<previous.eventTimeRaw)return retainHistory(previous);
 // A timestamp-free response may add information but cannot undo a terminal.
 if(previous?.state&&isTerminal(previous.state)&&(!eventAt||!event.state))return retainHistory(previous);
 const changed=!previous||previous.code!==event.code||previous.message!==event.message||(previous.eventTimeRaw||null)!==(event.eventTimeRaw||null)||Boolean(event.state&&previous.state!==event.state);
 return {...event,eventAt,state:event.state||previous?.state||null,
  observedAt:changed?now:previous?.observedAt||now,
  movementAt:event.state?(eventAt||(event.eventTimeRaw?null:(changed?now:previous?.movementAt||now))):previous?.movementAt||null};
}
export const isTerminal=(state:TrackingState|null)=>state==='delivered'||state==='returned'||state==='cancelled';
export function nextPoll(state:TrackingState|null,failures:number,now:number,ageDays:number,jitter=Math.random()):number|null{
 if(isTerminal(state))return null;
 if(failures>0)return now+Math.min(21600000,300000*2**Math.min(failures-1,7))*(0.9+Math.max(0,Math.min(jitter,1))*0.1);
 return now+(ageDays>45?86400000:state==='out_for_delivery'?1800000:7200000);
}
