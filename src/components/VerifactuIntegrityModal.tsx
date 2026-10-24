import {useCallback,useEffect,useState} from 'react';
import {FormModal,FormSection,FormGrid,SortableTableHeader,TableSortReset,useSortableTable} from '@zenvia/ui';
import {loadVerifactuIntegrityReport,integrityIssueLabels,type VerifactuIntegrityReport} from '../services/verifactuMonitor';
import './VerifactuIntegrityModal.css';

export function VerifactuIntegrityContent({report:r}:{report:VerifactuIntegrityReport}){
 const sorting=useSortableTable('verifactu-integrity-days',r.days,{day:d=>d.day,altas:d=>d.altas,cancellations:d=>d.cancellations},{key:'day',direction:'desc'});
 return <>
  <div className={r.status==='broken'?'errorBox':'softNotice'} role={r.status==='broken'?'alert':'status'}>
   <strong>{r.status==='broken'?'Integridad con incidencias':r.status==='empty'?'Aún no hay registros fiscales en sombra.':'Cadena correcta'}</strong>
   <p>{r.status==='empty'?'La primera emisión nueva abrirá la cadena de registros. Los eventos existentes se han comprobado.':r.status==='broken'?'Revisa las incidencias antes de continuar. Este informe no repara ni modifica registros.':'Huellas, contenido de cálculo, enlaces, secuencias y cabezas comprobados.'}</p>
  </div>
  <p>No se ha remitido información a la AEAT. Modo: {r.mode==='shadow'?'sombra':'captura desactivada'}.</p>
  <FormSection title="Última verificación" subtitle={new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',dateStyle:'short',timeStyle:'medium'}).format(new Date(r.checkedAt))}>
   <FormGrid><div><strong>{r.recordCount}</strong><p>Registros</p></div><div><strong>{r.altaCount}</strong><p>Altas</p></div><div><strong>{r.cancellationCount}</strong><p>Anulaciones</p></div><div><strong>{r.eventCount}</strong><p>Eventos</p></div></FormGrid>
  </FormSection>
  {r.issueCount>0&&<FormSection title={`Incidencias (${r.issueCount})`}><ul>{r.issues.map((x,i)=><li key={`${x.recordId||x.eventId}-${x.code}-${i}`}>{integrityIssueLabels[x.code]||'Incidencia de integridad'} · secuencia {x.sequence}</li>)}</ul>{r.issuesTruncated&&<p>Se muestran las primeras 100 incidencias; el total incluye todas las detectadas.</p>}</FormSection>}
  <FormSection title="Resumen diario" subtitle="Hasta 31 días con actividad. Fechas en Europe/Madrid.">
   {r.days.length?<><TableSortReset sorting={sorting}/><div className="vfIntegrityTable"><table><thead><tr>{[['day','Día'],['altas','Altas'],['cancellations','Anulaciones']].map(([key,label])=><SortableTableHeader key={key} label={label} sortKey={key} activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>)}</tr></thead><tbody>{sorting.rows.map(d=><tr key={d.day}><td>{d.day}</td><td>{d.altas}</td><td>{d.cancellations}</td></tr>)}</tbody></table></div></>:<p>Sin actividad fiscal registrada.</p>}
  </FormSection>
  {!!r.recent.length&&<FormSection title="Registros recientes" subtitle="Últimos 25 registros; se muestra la huella sin datos del cliente."><ol>{r.recent.map(x=><li key={x.id}>#{x.sequence} · {x.kind==='alta'?'Alta':'Anulación'} · <code title={x.hash}>{x.hash.slice(0,16)}…</code></li>)}</ol></FormSection>}
 </>;
}

export function VerifactuIntegrityModal({onClose}:{onClose:()=>void}){
 const [report,setReport]=useState<VerifactuIntegrityReport|null>(null);const [busy,setBusy]=useState(true);const [error,setError]=useState(false);const [round,setRound]=useState(0);
 const retry=useCallback(()=>setRound(x=>x+1),[]);
 useEffect(()=>{let alive=true;setBusy(true);setError(false);setReport(null);void loadVerifactuIntegrityReport().then(r=>{if(alive)setReport(r)}).catch(()=>{if(alive)setError(true)}).finally(()=>{if(alive)setBusy(false)});return()=>{alive=false}},[round]);
 return <FormModal className="vfIntegrityModal" title="Integridad de la sombra" eyebrow="VERI*FACTU · SEGUIMIENTO" subtitle="Verificación de solo lectura; no cambia facturas ni registros." onClose={onClose} actions={<><button className="secondary" disabled={busy} onClick={retry}>Volver a comprobar</button><button className="primary" onClick={onClose}>Cerrar</button></>}>
  {busy&&<p role="status">Comprobando huellas y enlaces…</p>}{error&&<div className="errorBox" role="alert">No se pudo completar la verificación. El estado de la cadena es desconocido; vuelve a comprobarlo.</div>}{report&&<VerifactuIntegrityContent report={report}/>}
 </FormModal>;
}
