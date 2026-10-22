import {useEffect,useState} from 'react';
import {trackingPresentation,formatTrackingCivilTime} from '../services/shipmentTracking';
import type {ShipmentTrackingEvent} from '../services/shipmentTrackingHistory';
export function ShipmentTrackingHistory({orderId,shipmentKey,loadEvents}:{orderId:string;shipmentKey:string;loadEvents:(id:string)=>Promise<ShipmentTrackingEvent[]>}){
 const [events,setEvents]=useState<ShipmentTrackingEvent[]>([]),[loading,setLoading]=useState(true),[failed,setFailed]=useState(false);
 useEffect(()=>{
  let active=true;setEvents([]);setLoading(true);setFailed(false);
  void loadEvents(orderId).then(rows=>{if(active)setEvents(rows)}).catch(()=>{if(active)setFailed(true)}).finally(()=>{if(active)setLoading(false)});
  return()=>{active=false};
 },[orderId,shipmentKey,loadEvents]);
 return <section className="ordersDrawerSection shipmentTrackingHistory"><h3>Historial de seguimiento</h3><small>Últimos 50 eventos registrados de este envío</small>
  {loading?<p role="status">Cargando historial…</p>:failed?<p role="alert">No se ha podido cargar el historial. Vuelve a abrir el detalle para reintentar.</p>:!events.length?<p>Aún no hay eventos registrados para este envío.</p>:<ol>{events.map((event,index)=>{
   const t=trackingPresentation({trackingNormalizedState:event.state,trackingStatusCode:event.code});
   const date=event.eventAt||event.observedAt;
   const formatted=event.eventTimeRaw?formatTrackingCivilTime(event.eventTimeRaw)+' (zona no indicada)':new Date(date).toLocaleString('es-ES',{timeZone:'Europe/Madrid',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
   return <li key={index}><span className={`ordersTracking ${t.className}`}>{t.label}</span><time dateTime={event.eventAt||undefined}>{!event.eventAt&&!event.eventTimeRaw?'Detectado: ':''}{formatted}</time><span>{event.message||'Sin descripción del transportista'}</span>{event.code&&<code>{event.code}</code>}</li>;
  })}</ol>}
 </section>;
}
