import {useRef,useState} from 'react';
import {FormSection} from '@zenvia/ui';
import {LoaderCircle,RefreshCw,ShieldCheck} from 'lucide-react';
import type {ShipmentCreationResult} from '../services/orders';
import './shipment-creation-recovery.css';
export function ShipmentCreationRecovery({provider,onCheck}:{provider:'mrw'|'sendcloud'|'envia';onCheck?:()=>Promise<ShipmentCreationResult>}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');const running=useRef(false);
 const name=provider==='mrw'?'MRW':provider==='envia'?'Envia':'Sendcloud';
 const check=async()=>{
  if(!onCheck||running.current)return;running.current=true;setBusy(true);setError('');setMessage('');
  try{const result=await onCheck();setMessage(result.status==='recovered'?'Expedición recuperada. Ya puedes descargar su etiqueta.':result.status==='released'?'No se ha encontrado una expedición. Ya puedes preparar la etiqueta.':'La respuesta del transportista sigue pendiente. Puedes volver a comprobarla sin crear otro envío.');}
  catch(e){setError(e instanceof Error?e.message:'No se pudo comprobar el envío. No se ha creado otro envío.');}
  finally{running.current=false;setBusy(false)}
 };
 return <FormSection className="shipmentCreationRecovery" icon={<ShieldCheck size={20}/>} title="Envío pendiente de confirmar" subtitle={`Hay una solicitud a ${name} pendiente de comprobar. Antes de generar otra etiqueta, comprobaremos si la expedición ya existe.`}>
  <button type="button" className="secondary" disabled={busy||!onCheck} aria-busy={busy} onClick={()=>void check()}>{busy?<LoaderCircle size={16} className="spin"/>:<RefreshCw size={16}/>} {busy?`Comprobando con ${name}…`:`Comprobar con ${name}`}</button>
  {message&&<p role="status">{message}</p>}{error&&<p role="alert" className="errorText">{error}</p>}
 </FormSection>;
}
