import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileText, Trash2, X } from 'lucide-react';
import type { ExpenseCategory, Invoice, InvoicePaymentStatus, Supplier } from '../types';
import { SearchableSelect } from './forms/SearchableSelect';
import { SortableTableHeader, useSortableTable } from './SortableTableHeader';
import { useSettings } from '../context/SettingsContext';
import { formatAppMoney } from '../services/formatting';

export function InvoiceDetailModal({invoice,suppliers,categories,onClose,onOpenFile,onDelete,onSupplierChange,onCategoryChange,onPaymentStatusChange,deleting=false}:{invoice:Invoice|null;suppliers:Supplier[];categories:ExpenseCategory[];onClose:()=>void;onOpenFile:(invoice:Invoice)=>Promise<void>;onDelete:(invoice:Invoice)=>Promise<void>;onSupplierChange:(invoice:Invoice,supplierId:string)=>Promise<void>;onCategoryChange:(invoice:Invoice,categoryId:string)=>Promise<void>;onPaymentStatusChange:(id:string,status:InvoicePaymentStatus,paidAt?:string|null)=>Promise<void>;deleting?:boolean}) {
  const {settings}=useSettings();
  const money=(value:number,currency?:string)=>formatAppMoney(value,currency,settings.general,{minimumFractionDigits:2,maximumFractionDigits:2});
  const [supplierId,setSupplierId]=useState('');
  const [categoryId,setCategoryId]=useState('');
  const [savingSupplier,setSavingSupplier]=useState(false);
  const [savingCategory,setSavingCategory]=useState(false);
  const [supplierError,setSupplierError]=useState('');
  const [categoryError,setCategoryError]=useState('');
  const [paidAtDraft,setPaidAtDraft]=useState('');
  const [savingPayment,setSavingPayment]=useState(false);
  const supplierOptions=useMemo(()=>suppliers.map(s=>({
    value:s.id,
    label:s.name,
    description:s.taxId||s.email||undefined,
    searchText:[s.name,s.taxId,s.email,s.phone,s.address].filter(Boolean).join(' '),
  })),[suppliers]);
  const categoryOptions=useMemo(()=>categories.map(category=>({value:category.id,label:category.name,searchText:category.name})),[categories]);

  useEffect(()=>{
    setSupplierId(invoice?.supplierId || '');
    setSupplierError('');
  },[invoice?.id,invoice?.supplierId]);

  useEffect(()=>{
    setCategoryId(invoice?.categoryId || '');
    setCategoryError('');
  },[invoice?.id,invoice?.categoryId]);

  useEffect(()=>{
    setPaidAtDraft(invoice?.paidAt || new Date().toISOString().slice(0,10));
  },[invoice?.id,invoice?.paidAt]);

  const lineSorting=useSortableTable(`expense-lines-${invoice?.id||'closed'}`,invoice?.lines||[],{
    description:line=>line.description,
    quantity:line=>line.quantity,
    unitPrice:line=>line.unitPrice,
    total:line=>line.lineTotal,
  },{key:'description',direction:'asc'});

  if(!invoice) return null;

  const saveSupplier=async()=>{
    if(!supplierId){setSupplierError('Selecciona un proveedor.');return;}
    setSavingSupplier(true);setSupplierError('');
    try{await onSupplierChange(invoice,supplierId)}
    catch(e){setSupplierError(e instanceof Error?e.message:'No se pudo cambiar el proveedor.');}
    finally{setSavingSupplier(false)}
  };

  const saveCategory=async()=>{
    if(!categoryId){setCategoryError('Selecciona una categoría.');return;}
    setSavingCategory(true);setCategoryError('');
    try{await onCategoryChange(invoice,categoryId)}
    catch(e){setCategoryError(e instanceof Error?e.message:'No se pudo cambiar la categoría.');}
    finally{setSavingCategory(false)}
  };

  const setPayment=async(status:InvoicePaymentStatus)=>{
    setSavingPayment(true);
    try{await onPaymentStatusChange(invoice.id,status,status==='paid'?(paidAtDraft||new Date().toISOString().slice(0,10)):null)}
    finally{setSavingPayment(false)}
  };

  const supplierChanged=supplierId!==String(invoice.supplierId||'');
  const categoryChanged=categoryId!==String(invoice.categoryId||'');
  return <div className="modalBackdrop zenviaDetailDrawerBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget) onClose()}}><div className="modal invoiceDetailModal zenviaDetailDrawer">
    <div className="modalHead"><div><h3>{invoice.supplierName}</h3><p>{invoice.invoiceNumber === '—' ? 'Factura sin número' : `Factura ${invoice.invoiceNumber}`}</p></div><button onClick={onClose}><X/></button></div>

    <div className="detailFile">
      <FileText size={22}/><div><strong>{invoice.fileName || 'Documento de factura'}</strong><span>{invoice.filePath ? 'Archivo almacenado de forma privada' : 'No hay archivo asociado'}</span></div>
      <button className="secondary" disabled={!invoice.filePath} onClick={()=>onOpenFile(invoice)}><ExternalLink size={16}/> Abrir documento</button>
    </div>

    <div className="invoiceMetadataEditors">
      <div className="invoiceSupplierEditor">
        <label>Proveedor asignado</label>
        <div className="invoiceSupplierEditorRow">
          <SearchableSelect value={supplierId} options={supplierOptions} onChange={setSupplierId} placeholder="Selecciona un proveedor…" searchPlaceholder="Buscar proveedor, CIF, email…" ariaLabel="Proveedor asignado"/>
          <button className="secondary" disabled={!supplierChanged||!supplierId||savingSupplier} onClick={saveSupplier}>{savingSupplier?'Guardando…':'Guardar proveedor'}</button>
        </div>
        <span className={`invoiceSupplierHint ${!invoice.supplierId?'warn':''}`}>{!invoice.supplierId?'Esta factura no tiene proveedor asignado. Selecciona uno y guarda el cambio.':'Puedes reasignar esta factura a cualquier proveedor existente.'}</span>
        {supplierError&&<div className="errorBox">{supplierError}</div>}
      </div>

      <div className="invoiceCategoryEditor">
        <label>Categoría</label>
        <div className="invoiceCategoryEditorRow">
          <SearchableSelect value={categoryId} options={categoryOptions} onChange={setCategoryId} placeholder="Selecciona una categoría…" searchPlaceholder="Buscar categoría…" ariaLabel="Categoría asignada"/>
          <button className="secondary" disabled={!categoryChanged||!categoryId||savingCategory} onClick={saveCategory}>{savingCategory?'Guardando…':'Guardar categoría'}</button>
        </div>
        <span className={`invoiceCategoryHint ${!invoice.categoryId?'warn':''}`}>{!invoice.categoryId?'Esta factura no tiene categoría asignada. Selecciona una y guarda el cambio.':'Puedes reclasificar la factura sin volver a importarla.'}</span>
        {categoryError&&<div className="errorBox">{categoryError}</div>}
      </div>
    </div>

    <div className="detailPaymentPanel">
      <div><span>Estado de pago</span><strong className={invoice.paymentStatus==='paid'?'paymentState paid':'paymentState unpaid'}>{invoice.paymentStatus==='paid'?'Pagada':'Por pagar'}</strong></div>
      <label><span>Fecha de pago</span><input type="date" value={paidAtDraft} disabled={savingPayment} onChange={event=>setPaidAtDraft(event.target.value)}/></label>
      <div className="detailPaymentActions">
        <button type="button" className={invoice.paymentStatus!=='paid'?'secondary activePaymentState':'secondary'} disabled={savingPayment} onClick={()=>void setPayment('unpaid')}>Por pagar</button>
        <button type="button" className={invoice.paymentStatus==='paid'?'primary':'secondary'} disabled={savingPayment||!paidAtDraft} onClick={()=>void setPayment('paid')}>{savingPayment?'Guardando…':'Marcar pagada'}</button>
      </div>
    </div>

    <div className="detailGrid">
      <div><span>Fecha</span><strong>{new Date(`${invoice.invoiceDate}T12:00:00`).toLocaleDateString('es-ES')}</strong></div>
      <div><span>Categoría</span><strong>{invoice.category}</strong></div>
      <div><span>Moneda</span><strong>{invoice.currency}</strong></div>
      <div><span>Base imponible</span><strong>{money(invoice.subtotal,invoice.currency)}</strong></div>
      <div><span>IVA</span><strong>{money(invoice.vat,invoice.currency)}</strong></div>
      {invoice.equivalenceSurcharge!==0&&<div><span>Recargo de equivalencia</span><strong>{money(invoice.equivalenceSurcharge,invoice.currency)}</strong></div>}
      <div><span>Retención</span><strong>{money(invoice.withholding,invoice.currency)}</strong></div>
      <div className="detailTotal"><span>Total</span><strong>{money(invoice.total,invoice.currency)}</strong></div>
    </div>

    <div className="detailSection">
      <div className="detailSectionHead"><div><strong>Líneas de producto</strong><span>{invoice.lines.length ? `${invoice.lines.length} línea${invoice.lines.length>1?'s':''} registrada${invoice.lines.length>1?'s':''}` : 'No se detectaron líneas'}</span></div></div>
      {invoice.lines.length ? <div className="detailLinesWrap"><table className="detailLines"><thead><tr>
      <SortableTableHeader label="Descripción" sortKey="description" activeKey={lineSorting.sort.key} direction={lineSorting.sort.direction} onSort={lineSorting.toggleSort}/>
      <SortableTableHeader label="Cantidad" sortKey="quantity" activeKey={lineSorting.sort.key} direction={lineSorting.sort.direction} onSort={lineSorting.toggleSort} className="right"/>
      <SortableTableHeader label="Precio ud." sortKey="unitPrice" activeKey={lineSorting.sort.key} direction={lineSorting.sort.direction} onSort={lineSorting.toggleSort} className="right"/>
      <SortableTableHeader label="Total" sortKey="total" activeKey={lineSorting.sort.key} direction={lineSorting.sort.direction} onSort={lineSorting.toggleSort} className="right"/>
      </tr></thead><tbody>{lineSorting.rows.map(line=><tr key={line.id}><td>{line.description}</td><td className="right">{line.quantity.toLocaleString('es-ES')}</td><td className="right">{line.unitPrice==null?'—':money(line.unitPrice,invoice.currency)}</td><td className="right">{line.lineTotal==null?'—':money(line.lineTotal,invoice.currency)}</td></tr>)}</tbody></table></div> : <div className="detailEmpty">Esta factura no tiene líneas de producto registradas.</div>}
    </div>

    <div className="modalActions detailActions"><button className="danger" disabled={deleting} onClick={()=>onDelete(invoice)}><Trash2 size={16}/>{deleting?'Eliminando…':'Eliminar factura'}</button><button className="secondary" onClick={onClose}>Cerrar</button></div>
  </div></div>;
}
