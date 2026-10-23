import {useEffect,useState} from 'react';
import {loadOrderShipmentHistory,type ShipmentHistoryEntry} from '../services/orderShipmentHistory';
type PreviousShipment={carrier:string|null;trackingNumber:string|null;cancelledAt:string|null};
const defaultDate=(value:string)=>new Intl.DateTimeFormat('es-ES',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Madrid'}).format(new Date(value));
export function OrderShipmentHistory({orderId,shipmentKey,purged=false,fallback,formatDate=defaultDate,loadHistory=loadOrderShipmentHistory}:{orderId:string;shipmentKey:string;purged?:boolean;fallback?:PreviousShipment;formatDate?:(value:string)=>string;loadHistory?:(id:string)=>Promise<ShipmentHistoryEntry[]>}){
 const [result,setResult]=useState<{orderId:string;rows:ShipmentHistoryEntry[];error:boolean}>({orderId,rows:[],error:false});
 const [retry,setRetry]=useState(0);
 useEffect(()=>{
  let current=true;
  if(purged){setResult({orderId,rows:[],error:false});return;}
  setResult(previous=>({orderId,rows:previous.orderId===orderId?previous.rows:[],error:false}));
  void loadHistory(orderId).then(rows=>{if(current)setResult({orderId,rows,error:false})}).catch(()=>{if(current)setResult({orderId,rows:[],error:true})});
  return()=>{current=false};
 },[orderId,shipmentKey,purged,loadHistory,retry]);
 if(purged)return null;
 const rows=result.orderId===orderId?result.rows:[];
 const visible:PreviousShipment[]=rows.length?rows:fallback?[fallback]:[];
 if(result.error)return <section className="ordersDrawerSection"><h3>Expediciones anteriores</h3><p role="alert">No se pudo cargar el historial de expediciones.</p><button type="button" className="link" onClick={()=>setRetry(value=>value+1)}>Reintentar historial</button></section>;
 if(!visible.length)return null;
 return <section className="ordersDrawerSection" aria-label="Historial de expediciones canceladas"><h3>Expediciones anteriores</h3>{visible.map((entry,index)=><div className="ordersShipmentInfo" key={rows[index]?.id||'legacy'}><div><span>Transportista</span><strong>{entry.carrier||'Transportista no disponible'}</strong></div><div><span>Tracking anterior</span><strong className="ordersFullTracking">{entry.trackingNumber||'Tracking no disponible'}</strong></div><div><span>Fecha de cancelación</span><strong>{entry.cancelledAt?formatDate(entry.cancelledAt):'Fecha no disponible'}</strong></div></div>)}</section>;
}
