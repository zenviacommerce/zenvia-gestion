import {useEffect,useRef,useState} from 'react';
import {Ban,RefreshCw} from 'lucide-react';
import type {FulfillmentOrder} from '../services/orders';
import {trackingPresentation} from '../services/shipmentTracking';
import {cancellationMatches,cancellationUncertain,loadOrderCancellations,refreshOrderCancellation,type CancellationOperation} from '../services/orderCancellation';
import {CancelShipmentModal,cancellationStatusLabels} from './CancelShipmentModal';
import '../order-cancellation.css';
export function OrderCancellationPanel({order,onChanged,onBlockingChange}:{order:FulfillmentOrder;onChanged?:()=>void|Promise<void>;onBlockingChange?:(blocked:boolean)=>void}){
 const eligible=!order.piiPurgedAt&&order.shippingCostSource!=='external_manual'&&!!order.shippingIntegrationAccountId&&['mrw','envia','sendcloud'].includes(order.shippingProvider||'');
 const key=[order.id,order.shippingProvider,order.shippingIntegrationAccountId,order.shippingRemoteId,order.sendcloudParcelId,order.trackingNumber,order.labelCreatedAt,order.labelCancelledAt,order.piiPurgedAt].join('|');
 const [state,setState]=useState<{key:string;ops:CancellationOperation[];loading:boolean;error:boolean}>({key,ops:[],loading:eligible,error:false}),[retry,setRetry]=useState(0),[modal,setModal]=useState(false),[checking,setChecking]=useState(false);
 const currentKey=useRef(key),checkingRef=useRef(false);currentKey.current=key;
 const ops=state.key===key?state.ops:[],loading=eligible&&(state.key!==key||state.loading),uncertain=ops.find(cancellationUncertain),operation=uncertain||ops.find(op=>cancellationMatches(order,op));
 const active=!!(order.shippingRemoteId||order.sendcloudParcelId||order.labelCreatedAt)&&!order.labelCancelledAt;
 const confirmedActive=operation?.status==='confirmed'&&active;
 const blocked=eligible&&(loading||state.error||!!uncertain||confirmedActive);
 useEffect(()=>{onBlockingChange?.(blocked)},[blocked,onBlockingChange]);
 useEffect(()=>{setModal(false)},[key]);
 useEffect(()=>{let alive=true;if(!eligible){setState({key,ops:[],loading:false,error:false});return;}setState(previous=>({key,ops:previous.key===key?previous.ops:[],loading:true,error:false}));void loadOrderCancellations(order.id).then(rows=>{if(alive)setState({key,ops:rows,loading:false,error:false})}).catch(()=>{if(alive)setState({key,ops:[],loading:false,error:true})});return()=>{alive=false}},[key,eligible,order.id,retry]);
 const accept=(rows:CancellationOperation[])=>{if(currentKey.current!==key)return;setState(previous=>({key,ops:[...rows,...previous.ops.filter(op=>!rows.some(row=>row.id===op.id))],loading:false,error:false}));if(rows.some(op=>op.status==='confirmed'))void Promise.resolve().then(()=>onChanged?.()).catch(()=>{if(currentKey.current===key)setState(previous=>({...previous,error:true}))})};
 const refresh=async()=>{if(checkingRef.current)return;checkingRef.current=true;setChecking(true);try{accept(await refreshOrderCancellation(order.id))}catch{if(currentKey.current===key)setState(previous=>({...previous,error:true}))}finally{checkingRef.current=false;setChecking(false)}};
 if(!eligible)return null;
 const physical=trackingPresentation(order).state;
 const canCancel=active&&!['delivered','returned','in_transit','out_for_delivery','cancelled'].includes(physical||'')&&!blocked&&operation?.status!=='confirmed';
 return <section className="ordersDrawerSection" aria-label="Cancelación del envío">
  {loading?<p role="status">Comprobando solicitudes de cancelación…</p>:state.error?<><p className="errorBox" role="alert">No se pudo comprobar si hay una cancelación en curso. Actualiza antes de utilizar la etiqueta.</p><button type="button" className="secondary" onClick={()=>setRetry(value=>value+1)}>Reintentar comprobación</button></>:null}
  {operation&&<div className={`cancellationNotice ${operation.status}`} role="status"><strong>{cancellationStatusLabels[operation.status]}</strong><p>{operation.message}</p>{uncertain&&<><p>La etiqueta se conserva hasta la confirmación. No se reenviará la solicitud.</p><button type="button" className="secondary" disabled={checking} onClick={()=>void refresh()}><RefreshCw size={16}/>{checking?'Comprobando…':'Comprobar estado'}</button></>}</div>}
  {confirmedActive&&<><p>La etiqueta anterior ya no se puede utilizar. Actualiza el pedido para preparar otra.</p><button type="button" className="secondary" disabled={checking} onClick={()=>void refresh()}>Actualizar pedido</button></>}
  {canCancel&&<button type="button" className="secondary" onClick={()=>setModal(true)}><Ban size={16}/>Cancelar envío</button>}
  {modal&&<CancelShipmentModal order={order} onClose={()=>setModal(false)} onResult={accept} onUncertain={()=>setRetry(value=>value+1)}/>}
 </section>;
}
