import {normalizeStatus,isTerminal,type TrackingState} from '../../supabase/functions/_shared/tracking/policy';
export type TrackingFields={trackingNormalizedState?:TrackingState|null;trackingEventAt?:string|null;trackingEventTimeRaw?:string|null;trackingObservedAt?:string|null;trackingMovementAt?:string|null;trackingCheckedAt?:string|null;trackingError?:string|null;trackingStatusCode?:string|null;trackingStatusMessage?:string|null;shippingProvider?:string|null;trackingNumber?:string|null;labelCreatedAt?:string|null};
const labels:Record<TrackingState,{label:string;className:string}>={pre_transit:{label:'Preparado',className:'ready'},in_transit:{label:'En tránsito',className:'transit'},out_for_delivery:{label:'En reparto',className:'route'},delivered:{label:'Entregado',className:'delivered'},exception:{label:'Incidencia',className:'issue'},returned:{label:'Devuelto',className:'returned'},cancelled:{label:'Cancelado',className:'cancelled'}};
export function trackingPresentation(order:TrackingFields,now=Date.now(),staleDays=3){
 // A created/shipped label is not a carrier observation. When direct MRW has
 // no observation, never imply transit from the legacy label status.
 const directMrw=order.shippingProvider==='mrw'&&!!order.trackingNumber;
 const softWarning=/^MRW_UNKNOWN_STATUS_(?:\d{1,4}|UNKNOWN)$/.test(order.trackingError||'');
 const unavailable=directMrw&&(!order.trackingNormalizedState||(!!order.trackingError&&!softWarning));
 const state=order.trackingNormalizedState||(unavailable?null:normalizeStatus(order.shippingProvider==='envia'?'envia':'legacy',order.trackingStatusCode));
 const base=state?labels[state]:{label:unavailable?'Sin seguimiento disponible':'Sin información',className:'none'};
 const event=order.trackingEventAt||null,observed=order.trackingObservedAt||null;
 const movement=order.trackingMovementAt||(state==='pre_transit'?order.labelCreatedAt:null);
 const rawTime=order.trackingEventTimeRaw||null;
 const civilAge=rawTime&&/^\d{4}-\d{2}-\d{2}/.test(rawTime)?Math.max(0,Math.floor((Date.parse(new Date(now).toISOString().slice(0,10)+'T00:00:00Z')-Date.parse(rawTime.slice(0,10)+'T00:00:00Z'))/86400000)):null;
 const age=civilAge??(movement&&Number.isFinite(Date.parse(movement))?Math.max(0,Math.floor((now-Date.parse(movement))/86400000)):null);
 return {...base,state,unavailable,eventTimeRaw:rawTime,eventAt:event,observedAt:observed,checkedAt:order.trackingCheckedAt||null,
  dateKind:event?'Último movimiento':observed?'Detectado':null,date:event||observed,
  staleLabel:state&&!isTerminal(state)&&age!=null&&age>=staleDays?`Sin movimiento registrado en ${age} días`:null,
  error:order.trackingError||null};
}

// Civil provider timestamps have no timezone: localize their display only.
export function formatTrackingCivilTime(value:string){
 return value.replace(/^(\d{4})-(\d{2})-(\d{2})([ T])/,(_match,year,month,day)=>`${day}/${month}/${year} `);
}
