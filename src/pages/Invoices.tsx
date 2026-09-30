import { useEffect, useMemo, useState } from 'react';
import { Download, Search, Camera, FileUp, CheckCircle2, CircleDollarSign, Eye, Trash2, Files, Euro, BadgeEuro, ReceiptText, Clock3, Calculator, Building2, WalletCards } from 'lucide-react';
import type { ExpenseCategory, Invoice, InvoicePaymentStatus, Supplier } from '../types';
import { exportInvoices } from '../services/exportQuarter';
import { InvoiceDetailModal } from '../components/InvoiceDetailModal';
import { InvoiceFilters } from '../components/InvoiceFilters';
import { Pagination } from '../components/Pagination';
import { StatCard } from '../components/StatCard';
import { BulkSelectCheckbox, BulkSelectionToolbar } from '../components/BulkSelectionToolbar';
import { defaultInvoiceFilter, filterInvoices, periodLabel, safeExportLabel } from '../services/filters';
import { errorMessage, showError, showSuccess } from '../services/toast';
import { confirmAction, openActionProcess } from '../services/actionDialog';
import { useSettings } from '../context/SettingsContext';
import { orderedTableColumns, persistRememberedFilter, rememberedFilter } from '../services/uiPreferences';
import { formatAppDate, formatAppMoney } from '../services/formatting';
import { SortableTableHeader, useSortableTable } from '../components/SortableTableHeader';


export function Invoices({invoices,suppliers,categories,onUpload,onBulkUpload,onStatusChange,onPaymentStatusChange,onBulkPaymentStatusChange,onOpenFile,onDelete,onSupplierChange,onCategoryChange}:{invoices:Invoice[];suppliers:Supplier[];categories:ExpenseCategory[];onUpload:()=>void;onBulkUpload:()=>void;onStatusChange:(id:string,status:'pending'|'reviewed'|'accounted')=>Promise<void>;onPaymentStatusChange:(id:string,status:InvoicePaymentStatus,paidAt?:string|null)=>Promise<void>;onBulkPaymentStatusChange:(ids:string[],status:InvoicePaymentStatus,paidAt?:string|null)=>Promise<void>;onOpenFile:(invoice:Invoice)=>Promise<void>;onDelete:(invoice:Invoice)=>Promise<void>;onSupplierChange:(invoiceId:string,supplierId:string)=>Promise<void>;onCategoryChange:(invoiceId:string,categoryId:string)=>Promise<void>}){
 const {settings,preferences,patchPreferences}=useSettings();
 const money=(value:number,currency:string=settings.general.currencyCode)=>formatAppMoney(value,currency,settings.general,{minimumFractionDigits:2,maximumFractionDigits:2});
 const groupedMoney=(rows:Invoice[],selector:(invoice:Invoice)=>number)=>{
   const totals=new Map<string,number>();
   for(const invoice of rows){const code=invoice.currency||settings.general.currencyCode;totals.set(code,(totals.get(code)||0)+selector(invoice));}
   return [...totals.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([currency,total])=>money(total,currency)).join(' + ')||money(0);
 };
 const pageSize=preferences.pageSize;
 const columns=orderedTableColumns(preferences,'expenses');
 const remembered=rememberedFilter<{query:string;filter:ReturnType<typeof defaultInvoiceFilter>}>(preferences,'expenses.filters',{query:'',filter:defaultInvoiceFilter(preferences.defaultPeriod)});
 const [query,setQuery]=useState(remembered.query); const [exporting,setExporting]=useState(false);
 const [filter,setFilter]=useState(remembered.filter);
 const [selected,setSelected]=useState<Invoice|null>(null);
 const [checkedIds,setCheckedIds]=useState<Set<string>>(()=>new Set());
 const [busyId,setBusyId]=useState<string|null>(null);
 const [bulkDeleting,setBulkDeleting]=useState(false);
 const [bulkPaying,setBulkPaying]=useState(false);
 const [page,setPage]=useState(1);
 const filtered=useMemo(()=>{
   const periodFiltered=filterInvoices(invoices,filter);
   const q=query.trim().toLowerCase();
   return !q?periodFiltered:periodFiltered.filter(i=>[i.supplierName,i.invoiceNumber,i.category].some(v=>v.toLowerCase().includes(q)));
 },[invoices,query,filter]);
 const sorting=useSortableTable('expenses',filtered,{
   date:i=>i.invoiceDate,
   supplier:i=>i.supplierName,
   invoice:i=>i.invoiceNumber,
   category:i=>i.category,
   source:i=>i.source,
   status:i=>i.status,
   vat:i=>i.vat,
   total:i=>i.total,
 },{key:'date',direction:'desc'});
 const sorted=sorting.rows;
 const totalPages=Math.max(1,Math.ceil(sorted.length/pageSize));
 const paged=useMemo(()=>sorted.slice((page-1)*pageSize,page*pageSize),[sorted,page,pageSize]);
 useEffect(()=>{setPage(1);setCheckedIds(new Set())},[query,filter]);
 useEffect(()=>{const timer=window.setTimeout(()=>{void persistRememberedFilter(preferences,patchPreferences,'expenses.filters',{query,filter})},350);return()=>window.clearTimeout(timer)},[query,filter,preferences.rememberFilters]);
 useEffect(()=>{setPage(current=>Math.min(current,totalPages))},[totalPages]);
 const selectedSupplier=suppliers.find(s=>s.id===filter.supplierId);
 const selectedCategory=categories.find(category=>category.id===filter.categoryId);
 const statusLabels:Record<string,string>={pending:'Pendientes',reviewed:'Revisadas',accounted:'Contabilizadas'};
 const sourceLabels:Record<string,string>={manual:'Archivo / manual',camera:'Cámara',gmail:'Gmail'};
 const paymentLabels:Record<string,string>={unpaid:'Por pagar',paid:'Pagadas'};
 const selectionLabel=[periodLabel(filter),selectedSupplier?.name,selectedCategory?.name,filter.status?statusLabels[filter.status]:null,filter.paymentStatus?paymentLabels[filter.paymentStatus]:null,filter.source?sourceLabels[filter.source]:null].filter(Boolean).join(' · ');
 const expenseTotal=groupedMoney(filtered,invoice=>invoice.total);
 const vatTotal=groupedMoney(filtered,invoice=>invoice.vat);
 const invoiceCount=filtered.length;
 const pendingReview=filtered.filter(invoice=>invoice.status==='pending').length;
 const unpaidInvoices=filtered.filter(invoice=>invoice.paymentStatus!=='paid');
 const unpaidCount=unpaidInvoices.length;
 const unpaidAmount=groupedMoney(unpaidInvoices,invoice=>invoice.total);
 const currencies=[...new Set(filtered.map(invoice=>invoice.currency||settings.general.currencyCode))];
 const averageTicket=invoiceCount&&currencies.length===1?filtered.reduce((sum,invoice)=>sum+invoice.total,0)/invoiceCount:null;
 const supplierCount=new Set(filtered.map(invoice=>invoice.supplierId||invoice.supplierName)).size;
 const selectedRows=filtered.filter(invoice=>checkedIds.has(invoice.id));
 const selectedUnpaid=selectedRows.filter(invoice=>invoice.paymentStatus!=='paid');
 const allFilteredSelected=filtered.length>0&&filtered.every(invoice=>checkedIds.has(invoice.id));
 const toggleChecked=(id:string,checked:boolean)=>setCheckedIds(current=>{const next=new Set(current);if(checked)next.add(id);else next.delete(id);return next;});
 const toggleAllFiltered=(checked:boolean)=>setCheckedIds(checked?new Set(filtered.map(invoice=>invoice.id)):new Set());
 const exportRows=selectedRows.length?selectedRows:filtered;
 const doExport=async()=>{setExporting(true);try{const label=selectedRows.length?`${selectedRows.length} seleccionadas`:selectionLabel;const blob=await exportInvoices(exportRows,label);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`ZENVIA_Gastos_${safeExportLabel(label)||'seleccion'}.zip`;a.click();URL.revokeObjectURL(url);}catch(e){showError(e instanceof Error?e.message:'No se pudo preparar la exportación.')}finally{setExporting(false)}};
 const openFile=async(invoice:Invoice)=>{try{await onOpenFile(invoice)}catch(e){showError(e instanceof Error?e.message:'No se pudo abrir el documento.')}};
 const changeStatus=async(id:string,status:'pending'|'reviewed'|'accounted')=>{try{await onStatusChange(id,status);const labels={pending:'pendiente',reviewed:'revisada',accounted:'contabilizada'} as const;showSuccess(`Factura marcada como ${labels[status]}.`)}catch(e){showError(e instanceof Error?e.message:'No se pudo cambiar el estado de la factura.')}};
 const changePaymentStatus=async(id:string,status:InvoicePaymentStatus,paidAt?:string|null)=>{try{await onPaymentStatusChange(id,status,paidAt);const resolvedPaidAt=status==='paid'?(paidAt||new Date().toISOString().slice(0,10)):null;setSelected(current=>current?.id===id?{...current,paymentStatus:status,paidAt:resolvedPaidAt}:current);showSuccess(status==='paid'?'Factura marcada como pagada.':'Factura marcada como pendiente de pago.')}catch(e){showError(e instanceof Error?e.message:'No se pudo cambiar el estado de pago.')}};
 const remove=async(invoice:Invoice)=>{
   const confirmed=await confirmAction({title:'Eliminar factura de gasto',message:`Se eliminará ${invoice.invoiceNumber==='—'?'la factura seleccionada':invoice.invoiceNumber} de ${invoice.supplierName}.`,confirmLabel:'Eliminar',tone:'danger',details:['Esta acción no se puede deshacer.']});
   if(!confirmed)return;
   setBusyId(invoice.id);
   try{await onDelete(invoice);if(selected?.id===invoice.id)setSelected(null);setCheckedIds(current=>{const next=new Set(current);next.delete(invoice.id);return next});showSuccess('Factura eliminada correctamente.')}catch(e){showError(e instanceof Error?e.message:'No se pudo eliminar la factura.')}finally{setBusyId(null)}
 };
 const markSelectedPaid=async()=>{
   if(!selectedUnpaid.length)return;
   const paidAt=new Date().toISOString().slice(0,10);
   const confirmed=await confirmAction({
     title:`Marcar ${selectedUnpaid.length} factura${selectedUnpaid.length===1?'':'s'} como pagada${selectedUnpaid.length===1?'':'s'}`,
     message:`Se marcarán como pagadas con fecha ${formatAppDate(paidAt,settings.general)}.`,
     confirmLabel:'Marcar como pagadas',
     tone:'default',
     details:['El estado contable no se modificará.','La fecha de pago podrá cambiarse después desde el detalle de cada factura.'],
   });
   if(!confirmed)return;
   setBulkPaying(true);
   try{
     await onBulkPaymentStatusChange(selectedUnpaid.map(invoice=>invoice.id),'paid',paidAt);
     setCheckedIds(new Set());
     showSuccess(`${selectedUnpaid.length} factura${selectedUnpaid.length===1?'':'s'} marcada${selectedUnpaid.length===1?'':'s'} como pagada${selectedUnpaid.length===1?'':'s'}.`);
   }catch(e){showError(errorMessage(e,'No se pudieron marcar las facturas como pagadas.'))}
   finally{setBulkPaying(false)}
 };
 const removeSelected=async()=>{
   if(!selectedRows.length)return;
   const confirmed=await confirmAction({title:`Eliminar ${selectedRows.length} factura${selectedRows.length===1?'':'s'} de gasto`,message:'Se eliminarán las facturas seleccionadas.',confirmLabel:'Eliminar seleccionadas',tone:'danger',details:['Esta acción no se puede deshacer.']});
   if(!confirmed)return;
   setBulkDeleting(true);
   const process=openActionProcess({title:'Eliminando gastos',description:'El resultado permanecerá visible al terminar.',items:selectedRows.map(invoice=>({id:invoice.id,label:`${invoice.invoiceNumber==='—'?invoice.supplierName:invoice.invoiceNumber} · ${invoice.supplierName}`}))});
   let removed=0;let failed=0;
   try{
     for(const invoice of selectedRows){
       process.setItem(invoice.id,'running','Eliminando…');
       try{await onDelete(invoice);removed+=1;process.setItem(invoice.id,'success','Eliminada correctamente.');}
       catch(e){failed+=1;process.setItem(invoice.id,'error',errorMessage(e,'No se pudo eliminar.'));}
     }
     if(selected&&selectedRows.some(invoice=>invoice.id===selected.id))setSelected(null);
     setCheckedIds(new Set());
     process.finish(`${removed} eliminada${removed===1?'':'s'}.${failed?` ${failed} con error.`:''}`,failed?(removed?'warning':'error'):'success');
   }finally{setBulkDeleting(false);}
 };
 const changeSupplier=async(invoice:Invoice,supplierId:string)=>{
   setBusyId(invoice.id);
   try{await onSupplierChange(invoice.id,supplierId);const supplier=suppliers.find(s=>s.id===supplierId);if(supplier)setSelected(current=>current?.id===invoice.id?{...current,supplierId,supplierName:supplier.name}:current);showSuccess('Proveedor de la factura actualizado correctamente.')}catch(e){throw e instanceof Error?e:new Error('No se pudo cambiar el proveedor de la factura.')}finally{setBusyId(null)}
 };
 const changeCategory=async(invoice:Invoice,categoryId:string)=>{
   setBusyId(invoice.id);
   try{await onCategoryChange(invoice.id,categoryId);const category=categories.find(c=>c.id===categoryId);if(category)setSelected(current=>current?.id===invoice.id?{...current,categoryId,category:category.name}:current);showSuccess('Categoría de la factura actualizada correctamente.')}catch(e){throw e instanceof Error?e:new Error('No se pudo cambiar la categoría de la factura.')}finally{setBusyId(null)}
 };
 const columnHeader=(key:string)=>{
   const labels:Record<string,string>={date:'Fecha',supplier:'Proveedor',invoice:'Factura',category:'Categoría',source:'Origen',status:'Estado',vat:'IVA',total:'Total'};
   const label=labels[key];if(!label)return null;
   return <SortableTableHeader key={key} label={label} sortKey={key} activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort} className={key==='vat'||key==='total'?'right':''}/>;
 };
 const columnCell=(key:string,i:Invoice)=>{
   if(key==='date')return <td key={key}>{formatAppDate(i.invoiceDate,settings.general)}</td>;
   if(key==='supplier')return <td key={key}><strong>{i.supplierName}</strong></td>;
   if(key==='invoice')return <td key={key}>{i.invoiceNumber}</td>;
   if(key==='category')return <td key={key}><span className="tag">{i.category}</span></td>;
   if(key==='source')return <td key={key}>{i.source==='camera'?<><Camera size={14}/> Cámara</>:i.source==='manual'?<><FileUp size={14}/> Archivo</>:'Gmail'}</td>;
   if(key==='status')return <td key={key}><div className="statusActions" onClick={e=>e.stopPropagation()}><button title="Pendiente" className={i.status==='pending'?'statusBtn active warnBtn':'statusBtn'} onClick={()=>void changeStatus(i.id,'pending')}>P</button><button title="Revisada" className={i.status==='reviewed'?'statusBtn active okBtn':'statusBtn'} onClick={()=>void changeStatus(i.id,'reviewed')}><CheckCircle2 size={13}/></button><button title="Contabilizada" className={i.status==='accounted'?'statusBtn active accountBtn':'statusBtn'} onClick={()=>void changeStatus(i.id,'accounted')}><CircleDollarSign size={13}/></button></div></td>;
   if(key==='vat')return <td key={key} className="right">{money(i.vat,i.currency)}</td>;
   if(key==='total')return <td key={key} className="right"><strong>{money(i.total,i.currency)}</strong></td>;
   return null;
 };
 return <div className="page"><div className="pageHead"><div><div className="eyebrow">DOCUMENTACIÓN · {periodLabel(filter)}</div><h1>Facturas de gastos</h1><p>Consulta el histórico completo, filtra y exporta cualquier periodo.</p></div><div className="actions"><button className="secondary" onClick={doExport} disabled={exporting||!exportRows.length}><Download size={17}/> {exporting?'Preparando…':selectedRows.length?`Exportar seleccionadas (${selectedRows.length})`:`Exportar (${filtered.length})`}</button><button className="secondary" onClick={onBulkUpload}><Files size={17}/> Importar facturas</button><button className="primary" onClick={onUpload}>+ Nueva factura</button></div></div>
 <InvoiceFilters filter={filter} onChange={setFilter} invoices={invoices} suppliers={suppliers} categories={categories}/>
 <div className="stats expenseStats"><StatCard label="Gasto total" value={expenseTotal} sub={selectionLabel} icon={<Euro/>}/><StatCard label="IVA soportado" value={vatTotal} sub={selectionLabel} icon={<BadgeEuro/>}/><StatCard label="Nº de facturas" value={String(invoiceCount)} sub={selectionLabel} icon={<ReceiptText/>}/><StatCard label="Pendientes de revisar" value={String(pendingReview)} sub={pendingReview?`${pendingReview} pendiente${pendingReview===1?'':'s'}`:'Todo revisado'} icon={<Clock3/>}/><StatCard label="Pendiente de pago" value={unpaidAmount} sub={unpaidCount?`${unpaidCount} factura${unpaidCount===1?'':'s'} por pagar`:'Todo pagado'} icon={<WalletCards/>}/><StatCard label="Ticket medio" value={averageTicket==null?'—':money(averageTicket,currencies[0])} sub={averageTicket==null&&invoiceCount?'Varias monedas':'Media por factura'} icon={<Calculator/>}/><StatCard label="Proveedores distintos" value={String(supplierCount)} sub={selectionLabel} icon={<Building2/>}/></div>
 <div className="toolbar invoiceSearchToolbar"><div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar proveedor, nº factura, categoría…"/></div><span className="filterResultCount">{filtered.length} factura{filtered.length===1?'':'s'} · {selectionLabel}</span></div>
 {filtered.length>0&&<BulkSelectionToolbar selectedCount={selectedRows.length} totalCount={filtered.length} allSelected={allFilteredSelected} onToggleAll={toggleAllFiltered} label="gastos visibles">
   <button className="secondary" type="button" disabled={!selectedUnpaid.length||bulkPaying||bulkDeleting||exporting} onClick={()=>void markSelectedPaid()}><CheckCircle2 size={15}/> {bulkPaying?'Marcando…':`Marcar pagadas (${selectedUnpaid.length})`}</button>
   <button className="secondary dangerText" type="button" disabled={!selectedRows.length||bulkDeleting||bulkPaying||exporting} onClick={()=>void removeSelected()}><Trash2 size={15}/> {bulkDeleting?'Eliminando…':`Eliminar seleccionados (${selectedRows.length})`}</button>
   <button className="primary" type="button" disabled={!selectedRows.length||exporting||bulkDeleting||bulkPaying} onClick={doExport}><Download size={15}/> Exportar seleccionados ({selectedRows.length})</button>
 </BulkSelectionToolbar>}
 <section className="card tableCard">{filtered.length?<><table data-preference-table="expenses"><thead><tr><th className="bulkSelectionCell"><BulkSelectCheckbox checked={allFilteredSelected} onChange={toggleAllFiltered} label={allFilteredSelected?'Deseleccionar gastos visibles':'Seleccionar gastos visibles'}/></th>{columns.map(columnHeader)}<SortableTableHeader label="Pago" sortKey="payment" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/><th className="right">Acciones</th></tr></thead><tbody>{paged.map(i=><tr key={i.id} className={`clickableRow ${checkedIds.has(i.id)?'bulkSelectedRow':''}`} onClick={()=>setSelected(i)}><td className="bulkSelectionCell" onClick={e=>e.stopPropagation()}><BulkSelectCheckbox checked={checkedIds.has(i.id)} onChange={checked=>toggleChecked(i.id,checked)} label={`Seleccionar gasto ${i.invoiceNumber==='—'?i.supplierName:i.invoiceNumber}`}/></td>{columns.map(key=>columnCell(key,i))}<td><div className="paymentActions" onClick={e=>e.stopPropagation()}><button title="Por pagar" className={i.paymentStatus!=='paid'?'paymentBtn active unpaidBtn':'paymentBtn'} onClick={()=>void changePaymentStatus(i.id,'unpaid')}>Por pagar</button><button title="Pagada" className={i.paymentStatus==='paid'?'paymentBtn active paidBtn':'paymentBtn'} onClick={()=>void changePaymentStatus(i.id,'paid')}><CheckCircle2 size={13}/> Pagada</button></div></td><td className="right"><div className="invoiceActions" onClick={e=>e.stopPropagation()}><button className="iconBtn" title="Abrir factura" disabled={!i.filePath} onClick={()=>openFile(i)}><Eye size={16}/></button><button className="iconBtn dangerIcon" title="Eliminar factura" disabled={busyId===i.id} onClick={()=>remove(i)}><Trash2 size={16}/></button></div></td></tr>)}</tbody></table><Pagination page={page} totalItems={filtered.length} pageSize={pageSize} onPageChange={setPage}/></>:<div className="emptyState large">No hay facturas para los filtros seleccionados.</div>}</section>
 <InvoiceDetailModal invoice={selected} suppliers={suppliers} categories={categories} onClose={()=>setSelected(null)} onOpenFile={openFile} onDelete={remove} onSupplierChange={changeSupplier} onCategoryChange={changeCategory} onPaymentStatusChange={changePaymentStatus} deleting={busyId===selected?.id}/>
 </div>
}