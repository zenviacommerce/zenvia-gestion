import './SalesCorrectionModals.css';
import {useState} from 'react';
import {FormModal,FormSection,FormGrid} from '@zenvia/ui';
import {SelectField} from './forms/SelectField';
import type {SalesInvoice} from '../services/sales';
import {createSalesInvoiceCorrection,cancelSalesInvoice,correctionErrorMessage,rectificationTypes,type RectificationType,type RectificationMode} from '../services/salesRectifying';

export function CorrectionSetupModal({invoice,onClose,onCreated}:{invoice:SalesInvoice;onClose:()=>void;onCreated:(id:string)=>Promise<void>}){
 const [createdId,setCreatedId]=useState<string|null>(null);const [type,setType]=useState('');const [mode,setMode]=useState('');const [reason,setReason]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const simplified=invoice.verifactuType==='F2'||invoice.verifactuType==='R5';
 const valid=Boolean(type&&mode&&reason.trim().length>=5&&reason.trim().length<=1000);
 const create=async()=>{if(!valid||busy)return;setBusy(true);setError('');try{const id=createdId||await createSalesInvoiceCorrection(invoice.id,{type:type as RectificationType,mode:mode as RectificationMode,reason});setCreatedId(id);await onCreated(id);}catch(e){setError(correctionErrorMessage(e,'No se pudo crear la rectificativa.'));}finally{setBusy(false);}};
 return <FormModal className="salesCorrectionModal" title="Crear rectificativa" eyebrow="CORRECCIÓN REGISTRADA" subtitle={`Original: ${invoice.invoiceNumber} · ${invoice.issueDate}`} onClose={()=>{if(!busy)onClose()}} actions={<><button className="secondary" disabled={busy} onClick={onClose}>Cancelar</button><button className="primary" disabled={!valid||busy} onClick={()=>void create()}>{busy?'Preparando…':createdId?'Abrir borrador creado':'Crear borrador rectificativo'}</button></>}>
  <FormSection title="Tipo y modalidad" subtitle="La original conserva su número y contenido. La nueva factura se numera al emitirla en una serie rectificativa.">
   <FormGrid><label>Tipo de rectificativa<SelectField ariaLabel="Tipo de rectificativa" disabled={busy||!!createdId} value={type} onChange={setType} placeholder="Selecciona el motivo fiscal…" options={rectificationTypes.filter(t=>simplified?t.value==='R5':t.value!=='R5')}/></label><label>Modalidad de rectificación<SelectField ariaLabel="Modalidad de rectificación" disabled={busy||!!createdId} value={mode} onChange={setMode} placeholder="Selecciona la modalidad…" options={[{value:'S',label:'S · Por sustitución'},{value:'I',label:'I · Por diferencias'}]}/></label></FormGrid>
   {type&&<p>{rectificationTypes.find(t=>t.value===type)?.description}</p>}
   {mode&&<p role="status">{mode==='S'?'Sustitución: se copian las líneas originales. Introduce los importes correctos finales; se conserva la base y cuota originales.':'Diferencias: se copian los conceptos con precio cero. Introduce solo el aumento positivo o la reducción negativa; no el total final.'}</p>}
   <label>Motivo de la rectificación<textarea aria-label="Motivo de la rectificación" readOnly={!!createdId} disabled={busy} value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)} rows={3} placeholder="Explica qué se corrige (mínimo 5 caracteres)"/></label>
  </FormSection>{createdId&&<p role="status">El borrador está guardado. Puedes volver a abrirlo sin crear otro.</p>}{error&&<div className="errorBox" role="alert">{error}</div>}
 </FormModal>;
}

export function InvoiceCancellationModal({invoice,onClose,onCancelled}:{invoice:SalesInvoice;onClose:()=>void;onCancelled:()=>Promise<void>}){
 const [category,setCategory]=useState('');const [reason,setReason]=useState('');const [confirmed,setConfirmed]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const valid=Boolean(category&&confirmed&&reason.trim().length>=5&&reason.trim().length<=900);
 const cancel=async()=>{if(!valid||busy)return;setBusy(true);setError('');try{await cancelSalesInvoice(invoice.id,category as 'nonexistent'|'duplicate',reason);await onCancelled();}catch(e){setError(correctionErrorMessage(e,'No se pudo registrar la anulación.'));}finally{setBusy(false);}};
 return <FormModal className="salesCorrectionModal" title="Anular factura" eyebrow="ANULACIÓN REGISTRADA" subtitle={invoice.invoiceNumber||''} onClose={()=>{if(!busy)onClose()}} actions={<><button className="secondary" disabled={busy} onClick={onClose}>Volver</button><button className="primary dangerText" disabled={!valid||busy} onClick={()=>void cancel()}>{busy?'Registrando…':'Registrar anulación'}</button></>}>
  <FormSection title="Comprueba que procede anular" subtitle="Para corregir importes, impuestos o una operación real, crea una rectificativa. La anulación conserva el número, el documento y los registros; no devuelve cobros.">
   <label>Supuesto de anulación<SelectField ariaLabel="Supuesto de anulación" value={category} onChange={value=>{setCategory(value);setConfirmed(false)}} placeholder="Selecciona un supuesto…" options={[{value:'nonexistent',label:'Operación inexistente: factura emitida por error'},{value:'duplicate',label:'Emisión duplicada de la misma operación'}]}/></label>
   <label>Motivo de la anulación<textarea aria-label="Motivo de la anulación" maxLength={900} value={reason} onChange={e=>setReason(e.target.value)} rows={3}/></label>
   <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Confirmo que procede anular esta emisión y que he revisado sus cobros y documentos relacionados.</label>
  </FormSection>{error&&<div className="errorBox" role="alert">{error}</div>}
 </FormModal>;
}
