import {trackingPresentation,type TrackingFields} from '../services/shipmentTracking';
export function ShipmentTrackingStatus({order,staleDays=3}:{order:TrackingFields;staleDays?:number}){
 const t=trackingPresentation(order,Date.now(),staleDays);
 const formatted=!t.eventTimeRaw&&t.date?new Date(t.date).toLocaleString('es-ES',{timeZone:'Europe/Madrid',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):null;
 const detail=[order.trackingStatusCode,order.trackingStatusMessage,t.checkedAt?`Última comprobación: ${new Date(t.checkedAt).toLocaleString('es-ES')}`:null].filter(Boolean).join(' · ');
 return <span className="shipmentTrackingSummary">
  <span className={`ordersTracking ${t.className}`} title={detail}>{t.label}</span>
  {formatted&&<small>{t.dateKind}: {formatted}</small>}
  {!formatted&&t.eventTimeRaw&&<small>Último movimiento: {t.eventTimeRaw} (zona no indicada)</small>}
  {!formatted&&!t.eventTimeRaw&&order.trackingNumber&&<small>Fecha de movimiento no disponible</small>}
  {t.staleLabel&&<small className="ordersValidationWarn">{t.staleLabel}</small>}
  {t.error&&<small className="ordersValidationWarn">{t.error==='MRW_TRACKING_PASSWORD_REQUIRED'?'Falta contraseña de seguimiento MRW':'Comprobación pendiente'}</small>}
 </span>;
}
