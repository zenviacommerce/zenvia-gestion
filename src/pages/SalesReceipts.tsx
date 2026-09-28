import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, CheckCircle2, Download, FileCheck2, PackageSearch, Pencil, Plus, Printer,
  ReceiptText, Search, Trash2, UserRound, X,
} from 'lucide-react';
import { ProductCatalogPicker } from '../components/ProductCatalogPicker';
import { SearchableSelect } from '../components/forms/SearchableSelect';
import { SelectField } from '../components/forms/SelectField';
import { StatCard } from '../components/StatCard';
import { useSettings } from '../context/SettingsContext';
import { loadBillableProducts, type BillableProduct } from '../services/billableProducts';
import { loadCompanyBranding, type CompanyBranding } from '../services/companyBranding';
import {
  createSalesInvoiceDraft, defaultSalesDueDate, ensureSalesSeries, loadBusinessSettings, loadClients,
  resolveSalesDueDays, type BusinessSettings, type Client, type SalesInvoiceLine,
} from '../services/sales';
import { deleteSalesInvoiceDraftSafe } from '../services/salesDraftDelete';
import {
  createSalesReceipt, deleteSalesReceipt, linkSalesReceiptsToInvoice, loadSalesReceipts, updateSalesReceipt,
  type SalesReceipt, type SalesReceiptInput, type SalesReceiptLine,
} from '../services/salesReceipts';
import { downloadSalesReceiptPdf, printSalesReceiptPdf } from '../services/salesReceiptPdf';
import { confirmAction, openActionProcess } from '../services/actionDialog';
import { errorMessage, showError, showSuccess } from '../services/toast';
import { formatAppDate } from '../services/formatting';
import '../sales.css';

const today=()=>new Date().toISOString().slice(0,10);
const money=(value:number)=>value.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
const emptyLine=(position=1,tax=21):SalesReceiptLine=>({position,description:'',quantity:1,unit:'ud',unitPrice:0,discountPercent:0,invoiceTaxRate:tax,productId:null});
const lineTotal=(line:SalesReceiptLine)=>line.quantity*line.unitPrice*(1-(line.discountPercent||0)/100);
const monthKey=(date:string)=>date.slice(0,7);

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
    <div className="modalHead salesModalHead"><div><div className="eyebrow">PENDIENTE DE FACTURAR</div><h3>{receipt?'Editar recibo':'Nuevo recibo'}</h3><p>Control interno de mercancía entregada. El IVA se guarda solo para la futura factura y no se suma al recibo.</p></div><button onClick={onClose} aria-label="Cerrar"><X/></button></div>
    <section className="salesFormSection"><div className="salesSectionTitle"><UserRound/><div><strong>Cliente y fecha</strong><span>El recibo queda pendiente hasta que lo conviertas en factura.</span></div></div>
      <div className="salesFormGrid"><label>Cliente *<SearchableSelect value={clientId} options={clientOptions} onChange={setClientId} placeholder="Selecciona cliente" searchPlaceholder="Buscar cliente…" ariaLabel="Cliente del recibo"/></label><label>Fecha<input type="date" value={receiptDate} onChange={e=>setReceiptDate(e.target.value)}/></label></div>
    </section>
    <section className="salesFormSection"><div className="salesSectionTitle"><PackageSearch/><div><strong>Productos y conceptos</strong><span>Los importes de este recibo son sin IVA.</span></div></div>
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
    <section className="salesFormSection"><div className="salesInvoiceBottom"><label>Notas<textarea rows={4} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Observaciones internas o para el cliente…"/></label><div className="salesTotals"><span><span>Subtotal</span><strong>{money(total)}</strong></span><span><span>IVA en recibo</span><strong>0,00 €</strong></span><span className="salesGrandTotal"><span>Pendiente</span><strong>{money(total)}</strong></span></div></div>
      <div className="salesReceiptNotice">Este recibo es un control interno pendiente de facturar. Al generar la factura se aplicará el IVA configurado en cada línea.</div>
    </section>
    {error&&<div className="errorBox salesReceiptModalError">{error}</div>}
    <div className="modalActions salesStickyActions"><button className="secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="primary" type="button" onClick={()=>void save()} disabled={busy}>{busy?'Guardando…':'Guardar recibo'}</button></div>
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
  const [status,setStatus]=useState<'all'|'pending'|'invoiced'>('pending');
  const [selected,setSelected]=useState<string[]>([]);
  const [editing,setEditing]=useState<SalesReceipt|null>(null);
  const [modal,setModal]=useState(false);
  const [busy,setBusy]=useState(false);

  const refresh=useCallback(async()=>{
    setLoading(true);
    try{
      const [nextReceipts,nextClients,nextProducts,nextBusiness,nextBranding]=await Promise.all([loadSalesReceipts(),loadClients(),loadBillableProducts(),loadBusinessSettings(),loadCompanyBranding()]);
      setReceipts(nextReceipts);setClients(nextClients);setProducts(nextProducts);setBusiness(nextBusiness);setBranding(nextBranding);
      setSelected(current=>current.filter(id=>nextReceipts.some(r=>r.id===id&&!r.invoiceId)));
    }catch(e){showError(errorMessage(e,'No se pudieron cargar los recibos.'))}
    finally{setLoading(false)}
  },[]);
  useEffect(()=>{void refresh()},[refresh]);

  const shown=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return receipts.filter(receipt=>{
      if(status==='pending'&&receipt.invoiceId)return false;
      if(status==='invoiced'&&!receipt.invoiceId)return false;
      if(q&&![receipt.receiptNumber,receipt.clientName,receipt.notes||'',receipt.invoiceNumber||''].some(value=>value.toLowerCase().includes(q)))return false;
      return true;
    });
  },[receipts,query,status]);
  const selectedRows=receipts.filter(r=>selected.includes(r.id)&&!r.invoiceId);
  const pending=receipts.filter(r=>!r.invoiceId);
  const pendingTotal=pending.reduce((sum,r)=>sum+r.totalAmount,0);
  const openNew=()=>{setEditing(null);setModal(true)};
  const toggle=(id:string)=>setSelected(current=>current.includes(id)?current.filter(x=>x!==id):[...current,id]);

  const remove=async(receipt:SalesReceipt)=>{
    const ok=await confirmAction({title:'Eliminar recibo',message:`Se eliminará ${receipt.receiptNumber}. Esta acción no afecta a ninguna factura.`,confirmLabel:'Eliminar',tone:'danger'});
    if(!ok)return;
    try{await deleteSalesReceipt(receipt.id);showSuccess('Recibo eliminado.');await refresh()}catch(e){showError(errorMessage(e,'No se pudo eliminar el recibo.'))}
  };

  const invoiceSelected=async()=>{
    if(!selectedRows.length){showError('Selecciona al menos un recibo pendiente.');return;}
    const groups=new Map<string,SalesReceipt[]>();
    for(const receipt of selectedRows){
      const key=`${receipt.clientId}|${monthKey(receipt.receiptDate)}`;
      groups.set(key,[...(groups.get(key)||[]),receipt]);
    }
    const confirmed=await confirmAction({
      title:'Generar facturas en borrador',
      message:`Se crearán ${groups.size} factura${groups.size===1?'':'s'} en borrador, agrupando los recibos por cliente y mes natural.`,
      confirmLabel:'Generar facturas',
      tone:'default',
      details:['Los recibos quedarán vinculados a su factura. Si eliminas el borrador, volverán a quedar pendientes.','El IVA se aplicará ahora según el tipo guardado en cada línea.'],
    });
    if(!confirmed)return;
    setBusy(true);
    const process=openActionProcess({title:'Generando facturas',description:'Convirtiendo recibos pendientes en borradores de factura.',items:[...groups.entries()].map(([key,rows])=>({id:key,label:`${rows[0].clientName} · ${key.split('|')[1]}`}))});
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
            currency:settings.general.currencyCode,paymentMethod,notes:`Generada desde recibos: ${rows.map(r=>r.receiptNumber).join(', ')}.`,lines:invoiceLines,
          },settings.sales.defaultDueDays);
          await linkSalesReceiptsToInvoice(rows.map(r=>r.id),invoiceId);
          created+=1;process.setItem(key,'success','Borrador creado.');
        }catch(e){
          if(invoiceId)await deleteSalesInvoiceDraftSafe(invoiceId).catch(()=>{});
          failed+=1;process.setItem(key,'error',errorMessage(e,'No se pudo generar.'));
        }
      }
      setSelected([]);await refresh();
      process.finish(`${created} factura${created===1?'':'s'} creada${created===1?'':'s'} en borrador${failed?` · ${failed} con error`:''}.`,failed?(created?'warning':'error'):'success');
      if(created)showSuccess(`${created} borrador${created===1?'':'es'} de factura creado${created===1?'':'s'}.`);
    }catch(e){process.finish(errorMessage(e,'No se pudieron generar las facturas.'),'error');showError(errorMessage(e,'No se pudieron generar las facturas.'))}
    finally{setBusy(false)}
  };

  return <div className="page salesReceiptsPage">
    <div className="pageHead"><div><div className="eyebrow">VENTAS · RECIBOS</div><h1>Recibos pendientes</h1><p>Apunta entregas de tienda sin IVA y conviértelas después en facturas. La facturación agrupa por cliente y mes natural.</p></div><div className="actions"><button className="secondary" disabled={!selectedRows.length||busy} onClick={()=>void invoiceSelected()}><FileCheck2 size={17}/> Facturar seleccionados{selectedRows.length?` (${selectedRows.length})`:''}</button><button className="primary" onClick={openNew}><Plus size={17}/> Nuevo recibo</button></div></div>
    <div className="stats salesStats normalizedKpiStats">
      <StatCard label="Pendiente sin IVA" value={money(pendingTotal)} sub="Recibos aún no facturados" icon={<ReceiptText/>}/>
      <StatCard label="Recibos pendientes" value={String(pending.length)} sub="Por convertir en factura" icon={<CalendarDays/>}/>
      <StatCard label="Ya facturados" value={String(receipts.filter(r=>r.invoiceId).length)} sub="Vinculados a factura" icon={<CheckCircle2/>}/>
    </div>
    <div className="salesReceiptNotice"><strong>Importante:</strong> el recibo es un control interno y no una factura. El IVA no se suma al recibo; se aplica al crear la factura. Si trabajas cada dos meses, puedes seleccionar todo: la aplicación generará un borrador separado por cada cliente y mes.</div>
    <div className="toolbar salesToolbar">
      <div className="search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar recibo, cliente o factura…"/></div>
      <SelectField value={status} onChange={value=>setStatus(value as typeof status)} ariaLabel="Estado de recibos" options={[{value:'pending',label:'Pendientes'},{value:'invoiced',label:'Facturados'},{value:'all',label:'Todos'}]}/>
    </div>
    <section className="card salesReceiptList">
      <div className="salesReceiptRow salesReceiptHead"><div></div><div>Recibo</div><div>Cliente</div><div>Fecha</div><div>Importe sin IVA</div><div>Estado</div><div>Acciones</div></div>
      {shown.map(receipt=><div className="salesReceiptRow" key={receipt.id}>
        <div><input type="checkbox" checked={selected.includes(receipt.id)} disabled={Boolean(receipt.invoiceId)} onChange={()=>toggle(receipt.id)} aria-label={`Seleccionar ${receipt.receiptNumber}`}/></div>
        <div className="entityCell"><strong>{receipt.receiptNumber}</strong><span>{receipt.lines.length} línea{receipt.lines.length===1?'':'s'}</span></div>
        <div><strong>{receipt.clientName}</strong></div>
        <div>{formatAppDate(receipt.receiptDate,settings.general,'—')}</div>
        <div><strong>{money(receipt.totalAmount)}</strong></div>
        <div>{receipt.invoiceId?<span className="salesReceiptStatus invoiced">Facturado{receipt.invoiceNumber?` · ${receipt.invoiceNumber}`:''}</span>:<span className="salesReceiptStatus pending">Pendiente</span>}</div>
        <div className="salesReceiptActions">
          <button className="secondary" title="Imprimir" onClick={()=>{try{printSalesReceiptPdf(receipt,business,branding,settings.general)}catch(e){showError(errorMessage(e,'No se pudo imprimir.'))}}}><Printer size={15}/></button>
          <button className="secondary" title="Descargar PDF" onClick={()=>{try{downloadSalesReceiptPdf(receipt,business,branding,settings.general)}catch(e){showError(errorMessage(e,'No se pudo generar el PDF.'))}}}><Download size={15}/></button>
          {!receipt.invoiceId&&<button className="secondary" title="Editar" onClick={()=>{setEditing(receipt);setModal(true)}}><Pencil size={15}/></button>}
          {!receipt.invoiceId&&<button className="secondary dangerText" title="Eliminar" onClick={()=>void remove(receipt)}><Trash2 size={15}/></button>}
        </div>
      </div>)}
      {!loading&&!shown.length&&<div className="emptyState large">No hay recibos para mostrar.</div>}
      {loading&&!receipts.length&&<div className="emptyState large">Cargando recibos…</div>}
    </section>
    {modal&&<ReceiptModal receipt={editing} clients={clients} products={products} onClose={()=>{setModal(false);setEditing(null)}} onSaved={refresh}/>}
  </div>;
}
