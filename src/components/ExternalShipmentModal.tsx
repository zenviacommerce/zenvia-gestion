import {useEffect,useRef,useState} from 'react';
import {FormModal,FormGrid} from '@zenvia/ui';
import {SelectField} from './forms/SelectField';
import type {IntegrationAccount} from '../services/integrationAccounts';
import type {FulfillmentOrder} from '../services/orders';
import type {ExternalShipmentInput} from '../services/externalShipment';
import '../shared-forms.css';
import '../external-shipment.css';

export function ExternalShipmentModal({order,accounts,onClose,onSave}:{order:FulfillmentOrder;accounts:IntegrationAccount[];onClose:()=>void;onSave:(input:ExternalShipmentInput,requestId:string)=>Promise<void>}){
 const [carrier,setCarrier]=useState(''),[tracking,setTracking]=useState(''),[accountId,setAccountId]=useState('');
 const [shippedAt,setShippedAt]=useState(''),[service,setService]=useState(''),[url,setUrl]=useState(''),[cost,setCost]=useState(''),[notifySource,setNotifySource]=useState(false);
 const [saving,setSaving]=useState(false),[error,setError]=useState('');const busy=useRef(false),root=useRef<HTMLDivElement>(null),origin=useRef<HTMLElement|null>(null);
 const request=useRef({id:crypto.randomUUID(),payload:''});
 const close=()=>{if(!busy.current)onClose()};
 useEffect(()=>{origin.current=document.activeElement as HTMLElement;const el=root.current?.closest('.formModal') as HTMLElement|null;
  el?.setAttribute('role','dialog');el?.setAttribute('aria-modal','true');el?.setAttribute('aria-label','Registrar envío externo');el?.querySelector<HTMLInputElement>('input')?.focus();
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();if(!busy.current)onClose()}if(e.key==='Tab'&&el){const items=[...el.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')].filter(x=>x.offsetParent!==null);const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}};
  document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);origin.current?.focus()};
 },[]);
 const submit=async()=>{
  if(busy.current)return;setError('');
  if(!carrier.trim()||!tracking.trim()){setError('Transportista y tracking son obligatorios.');return}
  if(cost!==''&&(!Number.isFinite(Number(cost))||Number(cost)<0)){setError('El coste debe ser un importe positivo o cero.');return}
  if(url){try{const u=new URL(url);if(!['http:','https:'].includes(u.protocol))throw Error()}catch{setError('Introduce una URL de seguimiento http o https.');return}}
  const input:ExternalShipmentInput={carrier:carrier.trim(),trackingNumber:tracking.trim(),notifySource,...(accountId?{accountId}:{}),...(shippedAt?{shippedAt:new Date(shippedAt).toISOString()}:{}),...(service.trim()?{service:service.trim()}:{}),...(url.trim()?{url:url.trim()}:{}),...(cost!==''?{cost:Number(cost)}:{})};
  const payload=JSON.stringify(input);if(request.current.payload&&request.current.payload!==payload)request.current.id=crypto.randomUUID();request.current.payload=payload;
  busy.current=true;setSaving(true);try{await onSave(input,request.current.id)}catch(e){setError(e instanceof Error?e.message:'No se pudo registrar el envío.')}finally{busy.current=false;setSaving(false)}
 };
 const usable=accounts.filter(a=>['mrw','envia','sendcloud'].includes(a.provider)&&a.enabled&&a.status!=='disabled'&&!a.legacy);
 return <FormModal title="Registrar envío externo" subtitle={`Pedido ${order.orderNumber||order.orderId} · Guarda un envío creado fuera de ZENVIA.`} onClose={close} className="externalShipmentModal" actions={<><button className="secondary" disabled={saving} onClick={close}>Cancelar</button><button className="primary" disabled={saving} onClick={()=>void submit()}>{saving?'Registrando…':'Registrar envío'}</button></>}>
  <div ref={root} aria-busy={saving}>
   <p className="externalShipmentHint">El transportista y el tracking son obligatorios. El registro quedará auditado y no sobrescribirá una expedición existente.</p>
   {error&&<p className="errorBox" role="alert">{error}</p>}
   <FormGrid>
    <label><span>Transportista *</span><input aria-label="Transportista *" maxLength={120} value={carrier} disabled={saving} onChange={e=>{setCarrier(e.target.value);setAccountId('')}}/></label>
    <label><span>Tracking *</span><input aria-label="Tracking *" maxLength={120} value={tracking} disabled={saving} onChange={e=>setTracking(e.target.value)}/></label>
    <label className="formSpan2"><span>Cuenta o integración (opcional)</span><SelectField ariaLabel="Cuenta o integración (opcional)" value={accountId} disabled={saving} options={[{value:'',label:'Sin integración · seguimiento manual'},...usable.filter(a=>a.provider!=='mrw'||carrier.toLowerCase().includes('mrw')).map(a=>({value:a.id,label:`${a.displayName} · ${a.provider==='envia'?'Envia.com':a.provider==='sendcloud'?'Sendcloud':'MRW'}`}))]} onChange={setAccountId}/><small>{accountId?'El seguimiento automático usará esta cuenta.':'Selecciona una cuenta para activar el seguimiento automático. El envío debe pertenecer a esa cuenta.'}</small></label>
    <label><span>Fecha de envío (opcional)</span><input aria-label="Fecha de envío (opcional)" type="datetime-local" value={shippedAt} disabled={saving} onChange={e=>setShippedAt(e.target.value)}/><small>Si se omite, se usa la fecha del registro.</small></label>
    <label><span>Servicio (opcional)</span><input aria-label="Servicio (opcional)" maxLength={200} value={service} disabled={saving} onChange={e=>setService(e.target.value)}/></label>
    <label className="formSpan2"><span>URL de seguimiento (opcional)</span><input aria-label="URL de seguimiento (opcional)" type="url" maxLength={2000} value={url} disabled={saving} onChange={e=>setUrl(e.target.value)}/></label>
    <label><span>Coste ({order.currency||'EUR'}, opcional)</span><input aria-label={`Coste (${order.currency||'EUR'}, opcional)`} type="number" min="0" max="1000000" step="0.01" value={cost} disabled={saving} onChange={e=>setCost(e.target.value)}/></label>
   </FormGrid>
   {['amazon','shopify'].includes(order.sourceChannel)&&<label className="externalShipmentNotify"><input type="checkbox" checked={notifySource} disabled={saving} onChange={e=>setNotifySource(e.target.checked)}/><span>Enviar tracking y confirmar el envío en {order.sourceChannel==='amazon'?'Amazon':'Shopify'}</span></label>}
  </div>
 </FormModal>;
}
