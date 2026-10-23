import {useId,useRef,useState} from 'react';
import {FormModal,StatusBadge} from '@zenvia/ui';
import type {FulfillmentOrder} from '../services/orders';
import {useFormDialog} from './forms/useFormDialog';
import '../order-dispatch.css';
export function OrderDispatchModal({orders,onClose,onSave}:{orders:FulfillmentOrder[];onClose:()=>void;onSave:()=>Promise<void>}){
 const [confirmed,setConfirmed]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const busy=useRef(false),root=useRef<HTMLDivElement>(null),title=useId();
 const close=()=>{if(!busy.current)onClose()};useFormDialog(root,close,true,title);
 const submit=async()=>{if(!confirmed||busy.current)return;busy.current=true;setSaving(true);setError('');try{await onSave()}catch(e){setError(e instanceof Error?e.message:'No se pudo registrar la salida.')}finally{busy.current=false;setSaving(false)}};
 return <div ref={root}><FormModal title="Marcar como enviado" subtitle="Registra la salida física de los paquetes del almacén." onClose={close} className="orderDispatchModal" actions={<><button className="secondary" disabled={saving} onClick={close}>Cancelar</button><button className="primary" disabled={!confirmed||saving} onClick={()=>void submit()}>{saving?'Registrando…':'Confirmar salida'}</button></>}>
  <div className="orderDispatchBody"><h2 hidden id={title}>Marcar como enviado</h2><h4>{orders.length} {orders.length===1?'envío comprobado':'envíos comprobados'}</h4><StatusBadge tone="warning">Pendientes de recogida</StatusBadge>
  <ul className="orderDispatchList">{orders.map(o=><li key={o.id}><strong>{o.orderNumber||o.orderId||o.id}</strong><span className="orderDispatchTracking">{o.trackingNumber||'Sin tracking'}</span></li>)}</ul>
  <p>Se guardarán la fecha de salida y el usuario que la registra.</p>
  <label className="orderDispatchConfirm"><input type="checkbox" checked={confirmed} disabled={saving} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo que estos paquetes han salido del almacén</label>
  {error&&<p role="alert" className="errorText">{error}</p>}</div>
 </FormModal></div>;
}
