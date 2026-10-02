import {useEffect,useState} from 'react';
import type {ExpenseCategory,InvoiceImportCandidate} from '../types';
import type {EngineDocument,EngineLine,EngineTax} from '../../shared/invoiceEngineCore.mjs';
import {documentFromCandidate} from '../services/invoiceEngine';
import {htmlInvoiceText} from '../services/invoiceEnginePages';
import {SelectField} from './forms/SelectField';
import {SearchableSelect} from './forms/SearchableSelect';
import '../invoice-engine.css';
type Props={candidate:InvoiceImportCandidate;categories:ExpenseCategory[];onChange:(next:InvoiceImportCandidate)=>void};
const numeric=(v:string)=>Number(v.replace(',','.'))||0;
export function InvoiceCandidateForm({candidate:c,categories,onChange}:Props){
  const [url,setUrl]=useState(''),[html,setHtml]=useState('');
  useEffect(()=>{let active=true,objectUrl='';setHtml('');setUrl('');void(async()=>{let blob:Blob=c.file;if(/\.hei[cf]$/i.test(c.file.name)){const {heicTo}=await import('heic-to');blob=await heicTo({blob:c.file,type:'image/jpeg',quality:.9}) as Blob;}
    if(c.file.type==='text/html'){const text=htmlInvoiceText(await c.file.text());if(active)setHtml(text);return;}
    objectUrl=URL.createObjectURL(blob);if(active)setUrl(objectUrl);else URL.revokeObjectURL(objectUrl);
  })().catch(()=>{});return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl)}},[c.file]);
  const d=documentFromCandidate(c),confidence=d.confidence;
  const set=<K extends keyof InvoiceImportCandidate>(key:K,value:InvoiceImportCandidate[K])=>onChange({...c,[key]:value});
  const extra=<K extends keyof EngineDocument>(key:K,value:EngineDocument[K])=>onChange({...c,engineDocument:{...d,[key]:value}});
  const supplier=(key:keyof EngineDocument['supplier'],value:string)=>extra('supplier',{...d.supplier,[key]:value});
  const badge=(field:string)=><small className={(confidence[field]??0)>=.92?'confidenceHigh':'confidenceLow'}>{Math.round((confidence[field]??0)*100)} % de confianza</small>;
  const line=(index:number,key:keyof EngineLine,value:string|number)=>{const lines=d.lines.map((l,i)=>i===index?{...l,[key]:value}:l);onChange({...c,engineDocument:{...d,lines},lines:lines.map(l=>({description:l.description,supplierSku:l.reference,quantity:l.quantity,unit:l.unit,unitPrice:l.unitPrice,discountPercent:l.discountPercent,lineNet:l.net,taxRate:l.vatRate,taxAmount:l.vat,lineTotal:l.total}))});};
  const removeLine=(index:number)=>onChange({...c,engineDocument:{...d,lines:d.lines.filter((_,i)=>i!==index)},lines:c.lines.filter((_,i)=>i!==index)});
  const taxes=(index:number,key:keyof EngineTax,value:number)=>extra('taxes',d.taxes.map((t,i)=>i===index?{...t,[key]:value}:t));
  return <div className="invoiceEngineReview">
    <aside className="invoiceEngineOriginal"><strong>Documento original{d.pages?.length?` · páginas ${d.pages.join(', ')}`:''}</strong>
      {html?<pre>{html}</pre>:url?(c.file.type.startsWith('image/')?<img src={url} alt="Factura original para comparar los datos"/>:<iframe title="Documento original" src={`${url}#page=${d.pages?.[0]||1}`} sandbox="allow-same-origin"/>):<span>Preparando original…</span>}
      {url&&<a href={url} target="_blank" rel="noreferrer">Abrir original</a>}
    </aside>
    <div className="invoiceEngineFields"><div className="invoiceFormGrid">
      <label>Proveedor *<input value={c.supplierName} onChange={e=>set('supplierName',e.target.value)}/>{badge('supplier')}</label>
      <label>NIF / CIF / VAT<input value={c.supplierTaxId||''} onChange={e=>set('supplierTaxId',e.target.value)}/>{badge('taxId')}</label>
      <label>Dirección<input value={c.supplierAddress||''} onChange={e=>set('supplierAddress',e.target.value)}/>{badge('address')}</label>
      {(['postalCode','city','province','countryCode','iban'] as const).map((key,i)=><label key={key}>{['Código postal','Ciudad','Provincia','País (ISO)','IBAN'][i]}<input value={d.supplier[key]||''} onChange={e=>supplier(key,e.target.value)}/>{badge(key==='iban'?'iban':'address')}</label>)}
      <label>Email<input type="email" value={c.supplierEmail||''} onChange={e=>set('supplierEmail',e.target.value)}/>{badge('email')}</label>
      <label>Teléfono<input value={c.supplierPhone||''} onChange={e=>set('supplierPhone',e.target.value)}/>{badge('phone')}</label>
      <label>Páginas de esta factura<input value={(d.pages||[]).join(", ")} onChange={e=>extra('pages',e.target.value.split(/[,\s]+/).map(Number).filter(n=>Number.isInteger(n)&&n>0&&n<=60))}/></label>
      {d.segmentationWarning&&<label><span>{d.segmentationWarning}</span><input type="checkbox" checked={!!d.segmentationResolved} onChange={e=>extra('segmentationResolved',e.target.checked)}/> He revisado y corregido la separación, las páginas y las líneas.</label>}
      <label>Tipo<SelectField value={d.type} onChange={v=>extra('type',v as EngineDocument['type'])} options={[{value:"complete",label:"Completa"},{value:"simplified",label:"Ticket / simplificada"},{value:"rectification",label:"Rectificativa"},{value:"credit",label:"Abono"}]} ariaLabel="Tipo de factura"/></label>
      <label>Serie<input value={d.series||''} onChange={e=>extra('series',e.target.value)}/>{badge('series')}</label>
      <label>Nº de factura *<input value={c.invoiceNumber} onChange={e=>set('invoiceNumber',e.target.value)}/>{badge('number')}</label>
      <label>Fecha de emisión *<input type="date" value={c.invoiceDate} onChange={e=>set('invoiceDate',e.target.value)}/>{badge('issueDate')}</label>
      <label>Vencimiento<input type="date" value={d.dueDate||''} onChange={e=>extra('dueDate',e.target.value)}/>{badge('dueDate')}</label>
      <label>Moneda<SearchableSelect value={c.currency||"EUR"} options={[...new Set(["EUR","USD","GBP","CHF","CAD","AUD","JPY","CNY",c.currency||"EUR"])].map(value=>({value,label:value}))} onChange={value=>set('currency',value)} ariaLabel="Moneda de factura"/>{badge('currency')}</label>
      <label>Categoría<SearchableSelect value={c.categoryId||''} options={categories.map(v=>({value:v.id,label:v.name,searchText:v.name}))} onChange={v=>set('categoryId',v||undefined)} allowEmpty emptyLabel="Sin categoría" ariaLabel="Categoría de gasto"/></label>
      {(['paymentMethod','orderNumber','deliveryNoteNumber','rectifiesNumber','qrVerifactu','qrTicketBai'] as const).map((key,i)=><label key={key}>{['Forma de pago','Pedido','Albarán','Factura rectificada','QR VeriFactu','QR TicketBAI'][i]}<input value={d[key]||''} onChange={e=>extra(key,e.target.value)}/>{badge(key)}</label>)}
      {(['subtotal','vat','equivalenceSurcharge','withholding','total'] as const).map((key,i)=><label key={key}>{['Base imponible','IVA','Recargo equivalencia','Retención IRPF','Total'][i]}<input type="number" step="0.01" value={c[key]} onChange={e=>set(key,numeric(e.target.value))}/>{badge(key==='total'?'total':'taxes')}</label>)}
      <label>Retención %<input type="number" value={d.withholdingRate??''} onChange={e=>extra('withholdingRate',e.target.value?numeric(e.target.value):undefined)}/></label>
      <label><input type="checkbox" checked={!!d.intraCommunity} onChange={e=>extra('intraCommunity',e.target.checked)}/> Intracomunitaria</label>
      <label><input type="checkbox" checked={!!d.reverseCharge} onChange={e=>extra('reverseCharge',e.target.checked)}/> Inversión del sujeto pasivo</label>
    </div>
    <h4>Líneas {badge('lines')}</h4><div className="invoiceEngineTable"><div role="table"><div role="row" className="invoiceEngineLineRow"><strong role="columnheader">Descripción / referencia</strong><strong role="columnheader">Tipo</strong><strong role="columnheader">Cantidad</strong><strong role="columnheader">Precio</strong><strong role="columnheader">Dto. %</strong><strong role="columnheader">Base</strong><strong role="columnheader">IVA %</strong><strong role="columnheader">Cuota</strong><strong role="columnheader">Total</strong><strong role="columnheader">Acción</strong></div><div role="rowgroup">{d.lines.map((l,i)=><div role="row" className="invoiceEngineLineRow" key={i}><div role="cell"><input aria-label={`Descripción ${i+1}`} value={l.description} onChange={e=>line(i,'description',e.target.value)}/><input aria-label={`Referencia ${i+1}`} value={l.reference||''} onChange={e=>line(i,'reference',e.target.value)}/></div><div role="cell"><SelectField value={l.kind} onChange={v=>line(i,'kind',v)} options={[{value:"product",label:"Producto"},{value:"expense",label:"Gasto"}]} ariaLabel={`Tipo línea ${i+1}`}/></div>{(['quantity','unitPrice','discountPercent','net','vatRate','vat','total'] as const).map(key=><div role="cell" key={key}><input aria-label={`${key} línea ${i+1}`} type="number" step="0.01" value={l[key]??0} onChange={e=>line(i,key,numeric(e.target.value))}/></div>)}<div role="cell"><button type="button" className="secondary" onClick={()=>removeLine(i)} aria-label={`Eliminar línea ${i+1}`}>Eliminar</button></div></div>)}</div></div></div>
    <button className="secondary" type="button" onClick={()=>{const lines=[...d.lines,{description:'',quantity:1,unitPrice:0,net:0,vatRate:21,vat:0,total:0,kind:'expense' as const}];onChange({...c,engineDocument:{...d,lines},lines:[...c.lines,{description:'',quantity:1,unitPrice:0,lineNet:0,taxRate:21,taxAmount:0,lineTotal:0}]});}}>Añadir línea</button>
    <h4>Desglose de IVA {badge('taxes')}</h4>{d.taxes.map((t,i)=><div className="invoiceEngineTax" key={i}>{(['rate','base','amount'] as const).map((key,k)=><label key={key}>{['Tipo %','Base','Cuota'][k]}<input type="number" step="0.01" value={t[key]} onChange={e=>taxes(i,key,numeric(e.target.value))}/></label>)}<label><input type="checkbox" checked={!!t.exempt} onChange={e=>extra('taxes',d.taxes.map((v,j)=>j===i?{...v,exempt:e.target.checked}:v))}/> Exento</label><button type="button" className="secondary" onClick={()=>extra('taxes',d.taxes.filter((_,j)=>j!==i))}>Eliminar IVA</button></div>)}
    <button className="secondary" type="button" onClick={()=>extra('taxes',[...d.taxes,{rate:21,base:0,amount:0}])}>Añadir tipo de IVA</button>
    <h4>Desglose de recargo</h4>{(d.surcharges||[]).map((t,i)=><div className="invoiceEngineTax" key={i}>{(['rate','base','amount'] as const).map((key,k)=><label key={key}>{['Tipo %','Base','Cuota'][k]}<input type="number" step="0.01" value={t[key]} onChange={e=>extra('surcharges',(d.surcharges||[]).map((v,j)=>j===i?{...v,[key]:numeric(e.target.value)}:v))}/></label>)}<button type="button" className="secondary" onClick={()=>extra('surcharges',(d.surcharges||[]).filter((_,j)=>j!==i))}>Eliminar recargo</button></div>)}<button className="secondary" type="button" onClick={()=>extra('surcharges',[...(d.surcharges||[]),{rate:5.2,base:0,amount:0}])}>Añadir recargo</button>
    </div>
  </div>;
}
