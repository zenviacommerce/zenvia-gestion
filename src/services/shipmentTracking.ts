import {normalizeStatus,isTerminal,type TrackingState} from '../../supabase/functions/_shared/tracking/policy';
export type TrackingFields={trackingNormalizedState?:TrackingState|null;trackingEventAt?:string|null;trackingEventTimeRaw?:string|null;trackingObservedAt?:string|null;trackingMovementAt?:string|null;trackingCheckedAt?:string|null;trackingError?:string|null;trackingStatusCode?:string|null;trackingStatusMessage?:string|null;shippingProvider?:string|null;trackingNumber?:string|null;labelCreatedAt?:string|null};
const labels:Record<TrackingState,{label:string;className:string}>={pre_transit:{label:'Preparado',className:'ready'},in_transit:{label:'En tránsito',className:'transit'},out_for_delivery:{label:'En reparto',className:'route'},delivered:{label:'Entregado',className:'delivered'},exception:{label:'Incidencia',className:'issue'},returned:{label:'Devuelto',className:'returned'},cancelled:{label:'Cancelado',className:'cancelled'}};
const madridDay=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'});
function civilDay(value:string|null):number|null{
 if(!value||!/^\d{4}-\d{2}-\d{2}([ T]|$)/.test(value)||value.startsWith('0000-'))return null;
 const day=value.slice(0,10),instant=Date.parse(day+'T00:00:00Z');
 // Date.parse normalizes impossible month days; SQL make_date rejects them.
 return Number.isFinite(instant)&&new Date(instant).toISOString().slice(0,10)===day?instant:null;
}
export function trackingPresentation(order:TrackingFields,now=Date.now(),staleDays=3){
 // A created/shipped label is not a carrier observation. When direct MRW has
 // no observation, never imply transit from the legacy label status.
 const directMrw=order.shippingProvider==='mrw'&&!!order.trackingNumber;
 const softWarning=/^MRW_UNKNOWN_STATUS_(?:\d{1,4}|UNKNOWN)$/.test(order.trackingError||'');
 const unclassified=directMrw&&!order.trackingNormalizedState&&softWarning&&!!order.trackingObservedAt;
 const unavailable=directMrw&&((!order.trackingNormalizedState&&!unclassified)||(!!order.trackingError&&!softWarning));
 const state=order.trackingNormalizedState||((unavailable||unclassified)?null:normalizeStatus(order.shippingProvider==='envia'?'envia':'legacy',order.trackingStatusCode));
 const base=state?labels[state]:{label:unclassified?'Estado sin clasificar':unavailable?'Sin seguimiento disponible':'Sin información',className:'none'};
 const event=order.trackingEventAt||null,observed=order.trackingObservedAt||null;
 const movement=order.trackingMovementAt||order.trackingEventAt||null;
 const rawTime=order.trackingEventTimeRaw||null;
 const providerDay=civilDay(rawTime);
 const civilAge=providerDay==null?null:Math.floor((Date.parse(madridDay.format(now)+'T00:00:00Z')-providerDay)/86400000);
 const age=civilAge??(movement&&Number.isFinite(Date.parse(movement))?Math.floor((now-Date.parse(movement))/86400000):null);
 const threshold=Math.min(90,Math.max(1,Number.isFinite(staleDays)?Math.trunc(staleDays):3));
 return {...base,movementAgeDays:age,state,unavailable,softWarning,eventTimeRaw:rawTime,eventAt:event,observedAt:observed,checkedAt:order.trackingCheckedAt||null,
  dateKind:event?'Último movimiento':observed?'Detectado':null,date:event||observed,
  staleLabel:state&&!isTerminal(state)&&age!=null&&age>=threshold?`Sin movimiento registrado en ${age} días`:null,
  error:order.trackingError||null};
}

// Civil provider timestamps have no timezone: localize their display only.
export function formatTrackingCivilTime(value:string){
 return value.replace(/^(\d{4})-(\d{2})-(\d{2})([ T])/,(_match,year,month,day)=>`${day}/${month}/${year} `);
}
