import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Banknote, CheckCircle2, Download, FileCheck2, PackageSearch, Pencil, Plus, Printer,
  ReceiptText, Search, Trash2, UserRound, X,
} from 'lucide-react';
import { ProductCatalogPicker } from '../components/ProductCatalogPicker';
import { SearchableSelect } from '../components/forms/SearchableSelect';
import { SelectField } from '../components/forms/SelectField';
import { StatCard } from '../components/StatCard';
import { BulkSelectCheckbox, BulkSelectionToolbar } from '../components/BulkSelectionToolbar';
import { useSettings } from '../context/SettingsContext';
import { loadBillableProducts, type BillableProduct } from '../services/billableProducts';
import { loadCompanyBranding, type CompanyBranding } from '../services/companyBranding';
import {
  createSalesInvoiceDraft, defaultSalesDueDate, ensureSalesSeries, loadBusinessSettings, loadClients,
  resolveSalesDueDays, type BusinessSettings, type Client, type SalesInvoiceLine,
} from '../services/sales';
import { deleteSalesInvoiceDraftSafe } from '../services/salesDraftDelete';
import {
  addSalesReceiptPayment, createSalesReceipt, deleteSalesReceipt, loadSalesReceipts, updateSalesReceipt,
  type SalesReceipt, type SalesReceiptInput, type SalesReceiptLine,
} from '../services/salesReceipts';
import { downloadSalesReceiptPdf, printSalesReceiptPdf } from '../services/salesReceiptPdf';
import { confirmAction, openActionProcess } from '../services/actionDialog';
import { errorMessage, showError, showSuccess } from '../services/toast';
import { formatAppDate } from '../services/formatting';
import type { SalesSettings } from '../services/settingsSchema';
import '../sales.css';

const today=()=>new Date().toISOString().slice(0,10);
const money=(value:number)=>value.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
const emptyLine=(position=1,tax=21):SalesReceiptLine=>({position,description:'',quantity:1,unit:'ud',unitPrice:0,discountPercent:0,invoiceTaxRate:tax,productId:null});
const lineTotal=(line:SalesReceiptLine)=>line.quantity*line.unitPrice*(1-(line.discountPercent||0)/100);
const monthKey=(date:string)=>date.slice(0,7);
const pendingAmount=(receipt:SalesReceipt)=>Math.max(0,receipt.totalAmount-receipt.paidAmount);
const collectionStatus=(receipt:SalesReceipt):'pending'|'partial'|'paid'=>receipt.totalAmount>0&&pendingAmount(receipt)<=0.005?'paid':receipt.paidAmount>0.005?'partial':'pending';
const collectionLabel=(receipt:SalesReceipt)=>({pending:'Pendiente',partial:'Cobro parcial',paid:'Cobrado'}[collectionStatus(receipt)]);

function ReceiptModal({receipt,clients,products,onClose,onSaved}:{receipt:SalesReceipt|null;clients:Client[];products:BillableProduct[];onClose:()=>void;onSaved:()=>Promise<void>}){
  const {settings}=useSettings();
  const [clientId,setClientId]=useState(receipt?.clientId||clients[0]?.id||'');
  const [receiptDate,setReceiptDate]=useState(receipt?.receiptDate||today());
  const [notes,setNotes]=useState(receipt?.notes||'');
  const [lines,setLines]=useState<SalesReceiptLine[]>(receipt?.lines.length?receipt.lines.map((line,index)=>({...line,position:index+1})):[emptyLine(1,settings.sales.defaultVatRate)]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const clientOptions=clients.map(client=>({value:client.id,label:client.name,description:client.taxId||client.city||undefined,searchText:[client.taxId,client.email,client.phone,client.city].filter(Boolean).join(' ')}));
  const updateLine=(index:number,patch:Partial<SalesReceiptLine>)=>setLines(current=>current.map((line,i)=>i===index?{...line,...patch}:line));
  const addFree=()=>setLines(current=>[...current,emptyLine(current.length+1,settings.sales.defaultVatRate)]);
  const addProduct=(product:BillableProduct)=>setLines(current=>{
    const next:SalesReceiptLine={position:current.length+1,productId:product.id,description:product.description,quantity:1,unit:product.unit,unitPrice:product.salePrice??0,discountPercent:0,invoiceTaxRate:product.taxRate};
    if(current.length===1&&!current[0].description.trim()&&!current[0].productId)return [next];
    return [...current,next];
  });
  const removeLine=(index:number)=>setLines(current=>current.length===1?[emptyLine(1,settings.sales.defaultVatRate)]:current.filter((_,i)=>i!==index).map((line,i)=>({...line,position:i+1})));
  const total=lines.reduce((sum,line)=>sum+lineTotal(line),0);
  const save=async()=>{
    if(!clientId){setError('Selecciona un cliente.');return;}
    const clean=lines.filter(line=>line.description.trim());
    if(!clean.length){setError('Añade al menos un producto o concepto.');return;}
    if(clean.some(line=>line.quantity<=0)){setError('Las cantidades deben ser superiores a 0.');return;}
    if(receipt&&receipt.paidAmount>total+0.005){setError('El nuevo importe no puede ser inferior a lo que ya se ha cobrado de este recibo.');return;}
    setBusy(true);setError('');
    const input:SalesReceiptInput={clientId,receiptDate,currency:settings.general.currencyCode,notes:notes||undefined,lines:clean};
    try{
      if(receipt)await updateSalesReceipt(receipt.id,input);
      else await createSalesReceipt(input);
      await onSaved();showSuccess(receipt?'Recibo actualizado.':'Recibo creado.');onClose();
    }catch(e){setError(errorMessage(e,'No se pudo guardar el recibo.'))}
    finally{setBusy(false)}
  };
  return <div className="modalBackdrop"><div className="modal salesInvoiceModal polishedModal">
    <div className="modalHead salesModalHead"><div><div className="eyebrow">RECIBO DE TIENDA</div><h3>{receipt?'Editar recibo':'Nuevo recibo'}</h3><p>Control de mercancía entregada y deuda del cliente. El cobro y la facturación son procesos independientes.</p></div><button onClick={onClose} aria-label="Cerrar"><X/></button></div>
    <section className="salesFormSection"><div className="salesSectionTitle"><UserRound/><div><strong>Cliente y fecha</strong><span>El recibo seguirá existiendo aunque después lo cobres o prepares una factura.</span></div></div>
      <div className="salesFormGrid"><label>Cliente *<SearchableSelect value={clientId} options={clientOptions} onChange={setClientId} placeholder="Selecciona cliente" searchPlaceholder="Buscar cliente…" ariaLabel="Cliente del recibo"/></label><label>Fecha<input type="date" value={receiptDate} onChange={e=>setReceiptDate(e.target.value)}/></label></div>
    </section>
    <section className="salesFormSection"><div className="salesSectionTitle"><PackageSearch/><div><strong>Productos y conceptos</strong><span>Los importes del recibo son sin IVA; guardamos el tipo únicamente para una futura factura.</span></div></div>
      <ProductCatalogPicker products={products} onAdd={addProduct}/>
      <div className="salesLinesEditor"><div className="salesLinesHead"><div><strong>Líneas del recibo</strong><span>{lines.length} línea{lines.length===1?'':'s'}</span></div><button className="secondary" type="button" onClick={addFree}><Plus size={15}/> Concepto libre</button></div>
        {lines.map((line,index)=><div className="salesReceiptLineCard" key={`${line.id||'new'}-${index}`}>
          <div className="salesLineIdentity"><div className="salesLineIndex">{index+1}</div><div><strong>{products.find(item=>item.id===line.productId)?.name||'Concepto libre'}</strong><small>{line.productId?'Producto vinculado':'Sin producto vinculado'}</small></div></div>
          <label className="salesLineDescription">Descripción<input value={line.description} onChange={e=>updateLine(index,{description:e.target.value})}/></label>
          <label>Cantidad<input type="number" min="0.001" step="0.001" value={line.quantity} onChange={e=>updateLine(index,{quantity:Number(e.target.value)})}/></label>
          <label>Precio sin IVA<input type="number" step="0.01" value={line.unitPrice} onChange={e=>updateLine(index,{unitPrice:Number(e.target.value)})}/></label>
          <label>Dto. %<input type="number" min="0" max="100" step="0.01" value={line.discountPercent} onChange={e=>updateLine(index,{discountPercent:Number(e.target.value)})}/></label>
          <label>IVA al facturar<SelectField value={String(line.invoiceTaxRate)} onChange={value=>updateLine(index,{invoiceTaxRate:Number(value)})} ariaLabel="IVA que se aplicará al facturar" options={[{value:'21',label:'21 %'},{value:'10',label:'10 %'},{value:'4',label:'4 %'},{value:'0',label:'0 %'}]}/></label>
          <div className="salesLineTotal"><small>Importe recibo</small><strong>{money(lineTotal(line))}</strong></div>
          <button className="secondary dangerText salesReceiptRemove" type="button" onClick={()=>removeLine(index)} aria-label="Eliminar línea"><Trash2 size={15}/></button>
        </div>)}
      </div>
    </section>
    <section className="salesFormSection"><div className="salesInvoiceBottom"><label>Notas<textarea rows={4} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Observaciones internas o para el cliente…"/></label><div className="salesTotals"><span><span>Subtotal</span><strong>{money(total)}</strong></span><span><span>IVA en recibo</span><strong>0,00 €</strong></span><span className="salesGrandTotal"><span>Total recibo</span><strong>{money(total)}</strong></span>{receipt&&receipt.paidAmount>0&&<><span><span>Ya cobrado</span><strong>{money(receipt.paidAmount)}</strong></span><span><span>Pendiente</span><strong>{money(Math.max(0,total-receipt.paidAmount))}</strong></span></>}</div></div>
      <div className="salesReceiptNotice">El recibo no queda vinculado a ninguna factura. Más adelante puedes seleccionar varios recibos para preparar una factura conjunta.</div>
    </section>
    {error&&<div className="errorBox salesReceiptModalError">{error}</div>}
    <div className="modalActions salesStickyActions"><button className="secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="primary" type="button" onClick={()=>void save()} disabled={busy}>{busy?'Guardando…':'Guardar recibo'}</button></div>
  </div></div>;
}

function ReceiptPaymentModal({receipt,salesSettings,onClose,onSaved}:{receipt:SalesReceipt|null;salesSettings:SalesSettings;onClose:()=>void;onSaved:()=>Promise<void>}){
  const pending=receipt?pendingAmount(receipt):0;
  const defaultMethod=salesSettings.paymentMethods.find(item=>item.id===salesSettings.defaultPaymentMethod&&item.active)?.label||salesSettings.paymentMethods.find(item=>item.active)?.label||'';
  const paymentOptions=salesSettings.paymentMethods.filter(item=>item.active).map(item=>({value:item.label,label:item.label}));
  const [amount,setAmount]=useState(pending);
  const [date,setDate]=useState(today());
  const [method,setMethod]=useState(defaultMethod);
  const [reference,setReference]=useState('');
  const [notes,setNotes]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{if(receipt){setAmount(pendingAmount(receipt));setDate(today());setMethod(defaultMethod);setReference('');setNotes('');setError('');}},[receipt,defaultMethod]);
  if(!receipt)return null;
  const save=async()=>{
    if(amount<=0){setError('Indica un importe superior a 0.');return;}
    if(amount>pending+0.005){setError('El cobro no puede superar el importe pendiente.');return;}
    if(!salesSettings.allowPartialPayments&&amount<pending-0.005){setError('Los cobros parciales están desactivados. Registra el importe pendiente completo.');return;}
    setBusy(true);setError('');
    try{
      await addSalesReceiptPayment(receipt.id,{amount,paymentDate:date,method,reference,notes});
      await onSaved();
      showSuccess(amount>=pending-0.005?'Recibo cobrado completamente.':'Cobro parcial registrado.');
      onClose();
    }catch(e){setError(errorMessage(e,'No se pudo registrar el cobro.'))}
    finally{setBusy(false)}
  };
  return <div className="modalBackdrop"><div className="modal smallModal polishedModal salesPaymentModal">
    <div className="modalHead salesModalHead"><div><div className="eyebrow">COBRO DE RECIBO</div><h3>Registrar cobro</h3><p>{receipt.receiptNumber} · {receipt.clientName} · Pendiente {money(pending)}</p></div><button onClick={onClose}><X/></button></div>
    <div className="salesPaymentQuick"><button type="button" className="primary" onClick={()=>setAmount(pending)}>Cobrar todo · {money(pending)}</button><span>{salesSettings.allowPartialPayments?'Puedes registrar también un cobro parcial.':'Los cobros parciales están desactivados.'}</span></div>
    <div className="salesFormSection"><div className="salesFormGrid"><label>Importe<input type="number" min="0.01" max={pending} step="0.01" value={amount} disabled={!salesSettings.allowPartialPayments} onChange={e=>setAmount(Number(e.target.value))}/></label><label>Fecha<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Método<SelectField value={method} onChange={setMethod} ariaLabel="Método de cobro" options={paymentOptions}/></label><label>Referencia<input value={reference} onChange={e=>setReference(e.target.value)} placeholder="Nº operación, transferencia…"/></label><label className="salesSpan2">Notas<input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Opcional"/></label></div></div>
    {receipt.payments.length>0&&<div className="salesReceiptPaymentHistory"><strong>Cobros anteriores</strong>{receipt.payments.map(payment=><div key={payment.id}><span>{formatAppDate(payment.paymentDate,undefined,'—')}{payment.method?` · ${payment.method}`:''}</span><strong>{money(payment.amount)}</strong></div>)}</div>}
    {error&&<div className="errorBox">{error}</div>}
    <div className="modalActions"><button className="secondary" onClick={onClose} disabled={busy}>Cancelar</button><button className="primary" disabled={busy||pending<=0.005} onClick={()=>void save()}>{busy?'Guardando…':amount>=pending-0.005?'Cobrar recibo':'Registrar cobro parcial'}</button></div>
  </div></div>;
}

function BulkReceiptPaymentModal({receipts,salesSettings,onClose,onSaved}:{receipts:SalesReceipt[];salesSettings:SalesSettings;onClose:()=>void;onSaved:()=>Promise<void>}){
  const defaultMethod=salesSettings.paymentMethods.find(item=>item.id===salesSettings.defaultPaymentMethod&&item.active)?.label||salesSettings.paymentMethods.find(item=>item.active)?.label||'';
  const paymentOptions=salesSettings.paymentMethods.filter(item=>item.active).map(item=>({value:item.label,label:item.label}));
  const [date,setDate]=useState(today());
  const [method,setMethod]=useState(defaultMethod);
  const [reference,setReference]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const total=receipts.reduce((sum,receipt)=>sum+pendingAmount(receipt),0);
  if(!receipts.length)return null;
  const save=async()=>{
    setBusy(true);setError('');
    const process=openActionProcess({title:'Cobrando recibos',description:'Se registrará el importe pendiente completo de cada recibo seleccionado.',items:receipts.map(receipt=>({id:receipt.id,label:`${receipt.receiptNumber} · ${receipt.clientName}`}))});
    let paid=0,failed=0;
    try{
      for(const receipt of receipts){
        const pending=pendingAmount(receipt);
        process.setItem(receipt.id,'running',`Registrando ${money(pending)}…`);
        try{
          if(pending>0.005)await addSalesReceiptPayment(receipt.id,{amount:pending,paymentDate:date,method,reference});
          paid+=1;process.setItem(receipt.id,'success','Cobrado completamente.');
        }catch(e){failed+=1;process.setItem(receipt.id,'error',errorMessage(e,'No se pudo registrar el cobro.'))}
      }
      await onSaved();
      process.finish(`${paid} recibo${paid===1?'':'s'} cobrado${paid===1?'':'s'}.${failed?` ${failed} con error.`:''}`,failed?(paid?'warning':'error'):'success');
      if(paid)onClose();
    }catch(e){setError(errorMessage(e,'No se pudo actualizar la lista de recibos.'));process.finish('No se pudo completar la actualización final.','error')}
    finally{setBusy(false)}
  };
  return <div className="modalBackdrop"><div className="modal smallModal polishedModal salesPaymentModal">
    <div className="modalHead salesModalHead"><div><div className="eyebrow">COBROS EN LOTE</div><h3>Cobrar recibos seleccionados</h3><p>{receipts.length} recibo{receipts.length===1?'':'s'} · Total pendiente {money(total)}</p></div><button onClick={onClose}><X/></button></div>
    <div className="salesFormSection"><div className="salesFormGrid"><label>Fecha de cobro<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Método<SelectField value={method} onChange={setMethod} ariaLabel="Método de cobro en lote" options={paymentOptions}/></label><label className="salesSpan2">Referencia común<input value={reference} onChange={e=>setReference(e.target.value)} placeholder="Opcional"/></label></div></div>
    <div className="salesBulkPaymentList">{receipts.map(receipt=><div key={receipt.id}><span>{receipt.receiptNumber} · {receipt.clientName}</span><strong>{money(pendingAmount(receipt))}</strong></div>)}</div>
    {error&&<div className="errorBox">{error}</div>}
    <div className="modalActions"><button className="secondary" onClick={onClose} disabled={busy}>Cancelar</button><button className="primary" disabled={busy} onClick={()=>void save()}>{busy?'Registrando…':`Cobrar ${money(total)}`}</button></div>
  </div></div>;
}

export function SalesReceipts(){
  const {settings}=useSettings();
  const [receipts,setReceipts]=useState<SalesReceipt[]>([]);
  const [clients,setClients]=useState<Client[]>([]);
  const [products,setProducts]=useState<BillableProduct[]>([]);
  const [business,setBusiness]=useState<BusinessSettings>({legalName:'ZENVIA COMMERCE SL',countryCode:'ES'});
  const [branding,setBranding]=useState<CompanyBranding>({ownerId:'',logoPath:null,logoDataUrl:null});
  const [loading,setLoading]=useState(true);
  const [query,setQuery]=useState('');
  const [status,setStatus]=useState<'all'|'open'|'partial'|'paid'>('open');
  const [selected,setSelected]=useState<string[]>([]);
  const [editing,setEditing]=useState<SalesReceipt|null>(null);
  const [modal,setModal]=useState(false);
  const [paymentReceipt,setPaymentReceipt]=useState<SalesReceipt|null>(null);
  const [bulkPaymentReceipts,setBulkPaymentReceipts]=useState<SalesReceipt[]>([]);
  const [busy,setBusy]=useState(false);

  const refresh=useCallback(async()=>{
    setLoading(true);
    try{
      const [nextReceipts,nextClients,nextProducts,nextBusiness,nextBranding]=await Promise.all([loadSalesReceipts(),loadClients(),loadBillableProducts(),loadBusinessSettings(),loadCompanyBranding()]);
      setReceipts(nextReceipts);setClients(nextClients);setProducts(nextProducts);setBusiness(nextBusiness);setBranding(nextBranding);
      setSelected(current=>current.filter(id=>nextReceipts.some(receipt=>receipt.id===id)));
    }catch(e){showError(errorMessage(e,'No se pudieron cargar los recibos.'))}
    finally{setLoading(false)}
  },[]);
  useEffect(()=>{void refresh()},[refresh]);

  const shown=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return receipts.filter(receipt=>{
      const receiptStatus=collectionStatus(receipt);
      if(status==='open'&&receiptStatus==='paid')return false;
      if(status==='partial'&&receiptStatus!=='partial')return false;
      if(status==='paid'&&receiptStatus!=='paid')return false;
      if(q&&![receipt.receiptNumber,receipt.clientName,receipt.notes||''].some(value=>value.toLowerCase().includes(q)))return false;
      return true;
    });
  },[receipts,query,status]);
  const selectedSet=useMemo(()=>new Set(selected),[selected]);
  const selectedRows=shown.filter(receipt=>selectedSet.has(receipt.id));
  const collectableSelected=selectedRows.filter(receipt=>pendingAmount(receipt)>0.005);
  const allVisibleSelected=shown.length>0&&shown.every(receipt=>selectedSet.has(receipt.id));
  const openReceipts=receipts.filter(receipt=>pendingAmount(receipt)>0.005);
  const pendingTotal=receipts.reduce((sum,receipt)=>sum+pendingAmount(receipt),0);
  const collectedTotal=receipts.reduce((sum,receipt)=>sum+receipt.paidAmount,0);
  const openNew=()=>{setEditing(null);setModal(true)};
  const toggle=(id:string,checked:boolean)=>setSelected(current=>checked?[...new Set([...current,id])]:current.filter(value=>value!==id));
  const toggleAllVisible=(checked:boolean)=>setSelected(current=>{
    const next=new Set(current);
    for(const receipt of shown){if(checked)next.add(receipt.id);else next.delete(receipt.id)}
    return [...next];
  });

  const remove=async(receipt:SalesReceipt)=>{
    const ok=await confirmAction({title:'Eliminar recibo',message:`Se eliminará ${receipt.receiptNumber} junto con su historial de cobros, si lo hubiera.`,confirmLabel:'Eliminar',tone:'danger',details:['Esta acción no afecta a ninguna factura, porque los recibos no están vinculados a ellas.']});
    if(!ok)return;
    try{await deleteSalesReceipt(receipt.id);showSuccess('Recibo eliminado.');await refresh()}catch(e){showError(errorMessage(e,'No se pudo eliminar el recibo.'))}
  };

  const invoiceSelected=async()=>{
    if(!selectedRows.length){showError('Selecciona al menos un recibo.');return;}
    const groups=new Map<string,SalesReceipt[]>();
    for(const receipt of selectedRows){
      const key=`${receipt.clientId}|${monthKey(receipt.receiptDate)}`;
      groups.set(key,[...(groups.get(key)||[]),receipt]);
    }
    const confirmed=await confirmAction({
      title:'Preparar facturas en borrador',
      message:`Se crearán ${groups.size} factura${groups.size===1?'':'s'} en borrador, agrupando los recibos seleccionados por cliente y mes natural.`,
      confirmLabel:'Generar borradores',
      tone:'default',
      details:['Los recibos no se vincularán ni cambiarán de estado: seguirán siendo independientes.','El IVA se aplicará a la factura según el tipo guardado en cada línea.','Puedes combinar recibos cobrados y pendientes en la misma preparación.'],
    });
    if(!confirmed)return;
    setBusy(true);
    const process=openActionProcess({title:'Generando facturas',description:'Copiando los conceptos de los recibos a borradores de factura sin modificar los recibos.',items:[...groups.entries()].map(([key,rows])=>({id:key,label:`${rows[0].clientName} · ${key.split('|')[1]}`}))});
    let created=0,failed=0;
    try{
      const issueDate=today();
      const series=await ensureSalesSeries(Number(issueDate.slice(0,4)));
      const standardSeries=series.find(s=>s.id===settings.sales.defaultSeriesId&&s.kind==='standard')||series.find(s=>s.kind==='standard');
      if(!standardSeries)throw new Error('No existe una serie de facturación ordinaria activa.');
      for(const [key,rows] of groups){
        process.setItem(key,'running','Creando borrador…');
        let invoiceId='';
        try{
          const client=clients.find(c=>c.id===rows[0].clientId);
          const paymentId=client?.defaultPaymentMethod||settings.sales.defaultPaymentMethod;
          const paymentMethod=settings.sales.paymentMethods.find(item=>item.id===paymentId&&item.active)?.label||settings.sales.paymentMethods.find(item=>item.active)?.label||'';
          const invoiceLines:SalesInvoiceLine[]=rows.sort((a,b)=>a.receiptDate.localeCompare(b.receiptDate)).flatMap(receipt=>receipt.lines.map(line=>({
            productId:line.productId||null,position:0,description:`${receipt.receiptNumber} · ${line.description}`,quantity:line.quantity,unit:line.unit,unitPrice:line.unitPrice,discountPercent:line.discountPercent,taxRate:line.invoiceTaxRate,
          }))).map((line,index)=>({...line,position:index+1}));
          invoiceId=await createSalesInvoiceDraft({
            clientId:rows[0].clientId,seriesId:standardSeries.id,taxRegistrationId:settings.sales.defaultTaxRegistrationId,
            issueDate,operationDate:rows.map(r=>r.receiptDate).sort().at(-1),dueDate:defaultSalesDueDate(issueDate,resolveSalesDueDays(client?.paymentTermsDays,settings.sales.defaultDueDays)),
            currency:settings.general.currencyCode,paymentMethod,notes:`Preparada a partir de recibos: ${rows.map(r=>r.receiptNumber).join(', ')}.`,lines:invoiceLines,
          },settings.sales.defaultDueDays);
          created+=1;process.setItem(key,'success','Borrador creado; los recibos no se han modificado.');
        }catch(e){
          if(invoiceId)await deleteSalesInvoiceDraftSafe(invoiceId).catch(()=>{});
          failed+=1;process.setItem(key,'error',errorMessage(e,'No se pudo generar.'));
        }
      }
      setSelected([]);await refresh();
      process.finish(`${created} factura${created===1?'':'s'} creada${created===1?'':'s'} en borrador${failed?` · ${failed} con error`:''}.`,failed?(created?'warning':'error'):'success');
      if(created)showSuccess(`${created} borrador${created===1?'':'es'} creado${created===1?'':'s'} sin vincular los recibos.`);
    }catch(e){process.finish(errorMessage(e,'No se pudieron generar las facturas.'),'error');showError(errorMessage(e,'No se pudieron generar las facturas.'))}
    finally{setBusy(false)}
  };

  return <div className="page salesReceiptsPage">
    <div className="pageHead"><div><div className="eyebrow">VENTAS · RECIBOS</div><h1>Recibos</h1><p>Controla lo que se lleva cada cliente, registra sus cobros y prepara después facturas a partir de uno o varios recibos.</p></div><div className="actions"><button className="secondary" disabled={!selectedRows.length||busy} onClick={()=>void invoiceSelected()}><FileCheck2 size={17}/> Facturar seleccionados{selectedRows.length?` (${selectedRows.length})`:''}</button><button className="primary" onClick={openNew}><Plus size={17}/> Nuevo recibo</button></div></div>
    <div className="stats salesStats normalizedKpiStats">
      <StatCard label="Pendiente de cobro" value={money(pendingTotal)} sub="Importe sin IVA aún pendiente" icon={<ReceiptText/>}/>
      <StatCard label="Cobrado" value={money(collectedTotal)} sub="Cobros registrados en recibos" icon={<Banknote/>}/>
      <StatCard label="Recibos pendientes" value={String(openReceipts.length)} sub="Con saldo por cobrar" icon={<ReceiptText/>}/>
      <StatCard label="Recibos cobrados" value={String(receipts.filter(receipt=>collectionStatus(receipt)==='paid').length)} sub="Saldo completamente cobrado" icon={<CheckCircle2/>}/>
    </div>
    <div className="salesReceiptNotice"><strong>Recibos y facturas son independientes:</strong> cobrar un recibo no lo factura y generar una factura desde varios recibos no los vincula ni altera su estado. El IVA solo se aplica en la factura.</div>
    <div className="toolbar salesToolbar">
      <div className="search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar recibo o cliente…"/></div>
      <SelectField value={status} onChange={value=>setStatus(value as typeof status)} ariaLabel="Estado de cobro de recibos" options={[{value:'open',label:'Pendientes de cobro'},{value:'partial',label:'Cobro parcial'},{value:'paid',label:'Cobrados'},{value:'all',label:'Todos'}]}/>
    </div>
    {shown.length>0&&<BulkSelectionToolbar selectedCount={selectedRows.length} totalCount={shown.length} allSelected={allVisibleSelected} onToggleAll={toggleAllVisible} label="recibos visibles">
      <button className="secondary" type="button" disabled={!collectableSelected.length||busy} onClick={()=>setBulkPaymentReceipts(collectableSelected)}><Banknote size={15}/> Cobrar seleccionados ({collectableSelected.length})</button>
      <button className="primary" type="button" disabled={!selectedRows.length||busy} onClick={()=>void invoiceSelected()}><FileCheck2 size={15}/> Facturar seleccionados ({selectedRows.length})</button>
    </BulkSelectionToolbar>}
    <section className="card salesReceiptList">
      <div className="salesReceiptRow salesReceiptHead"><div className="bulkSelectionCell"><BulkSelectCheckbox checked={allVisibleSelected} onChange={toggleAllVisible} label={allVisibleSelected?'Deseleccionar recibos visibles':'Seleccionar recibos visibles'}/></div><div>Recibo</div><div>Cliente</div><div>Fecha</div><div>Importe sin IVA</div><div>Estado cobro</div><div>Acciones</div></div>
      {shown.map(receipt=>{const pending=pendingAmount(receipt);const receiptStatus=collectionStatus(receipt);return <div className={`salesReceiptRow ${selectedSet.has(receipt.id)?'bulkSelectedRow':''}`} key={receipt.id}>
        <div className="bulkSelectionCell"><BulkSelectCheckbox checked={selectedSet.has(receipt.id)} onChange={checked=>toggle(receipt.id,checked)} label={`Seleccionar ${receipt.receiptNumber}`}/></div>
        <div className="entityCell"><strong>{receipt.receiptNumber}</strong><span>{receipt.lines.length} línea{receipt.lines.length===1?'':'s'}</span></div>
        <div><strong>{receipt.clientName}</strong></div>
        <div>{formatAppDate(receipt.receiptDate,settings.general,'—')}</div>
        <div className="salesReceiptAmount"><strong>{money(receipt.totalAmount)}</strong>{receipt.paidAmount>0&&<small>Cobrado {money(receipt.paidAmount)} · Pendiente {money(pending)}</small>}</div>
        <div><span className={`salesReceiptStatus ${receiptStatus}`}>{collectionLabel(receipt)}</span></div>
        <div className="salesReceiptActions">
          {pending>0.005&&<button className="invoiceCollectButton" title="Registrar cobro" onClick={()=>setPaymentReceipt(receipt)}><Banknote size={15}/><span>Cobrar</span></button>}
          {receiptStatus==='paid'&&<span className="invoicePaidMark"><CheckCircle2 size={14}/> Cobrado</span>}
          <button className="secondary" title="Imprimir" onClick={()=>{try{printSalesReceiptPdf(receipt,business,branding,settings.general)}catch(e){showError(errorMessage(e,'No se pudo imprimir.'))}}}><Printer size={15}/></button>
          <button className="secondary" title="Descargar PDF" onClick={()=>{try{downloadSalesReceiptPdf(receipt,business,branding,settings.general)}catch(e){showError(errorMessage(e,'No se pudo generar el PDF.'))}}}><Download size={15}/></button>
          <button className="secondary" title="Editar" onClick={()=>{setEditing(receipt);setModal(true)}}><Pencil size={15}/></button>
          <button className="secondary dangerText" title="Eliminar" onClick={()=>void remove(receipt)}><Trash2 size={15}/></button>
        </div>
      </div>})}
      {!loading&&!shown.length&&<div className="emptyState large">No hay recibos para mostrar.</div>}
      {loading&&!receipts.length&&<div className="emptyState large">Cargando recibos…</div>}
    </section>
    {modal&&<ReceiptModal receipt={editing} clients={clients} products={products} onClose={()=>{setModal(false);setEditing(null)}} onSaved={refresh}/>}
    <ReceiptPaymentModal receipt={paymentReceipt} salesSettings={settings.sales} onClose={()=>setPaymentReceipt(null)} onSaved={refresh}/>
    <BulkReceiptPaymentModal receipts={bulkPaymentReceipts} salesSettings={settings.sales} onClose={()=>setBulkPaymentReceipts([])} onSaved={refresh}/>
  </div>;
}
