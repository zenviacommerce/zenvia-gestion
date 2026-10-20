import {PageTabs} from '../components/PageTabs';
import {RetainedImportPage} from '../components/RetainedImportPage';
import { useState } from 'react';
import { FileText, Mail } from 'lucide-react';
import type { ExpenseCategory, Invoice, InvoicePaymentStatus, Supplier } from '../types';
import { Invoices } from './Invoices';
import { GmailPage } from './Gmail';

export function ExpenseInvoicesHub({invoices,suppliers,categories,onUpload,onBulkUpload,onStatusChange,onPaymentStatusChange,onBulkPaymentStatusChange,onOpenFile,onDelete,onSupplierChange,onCategoryChange,onImported,onManageAccounts,canManageAccounts}:{invoices:Invoice[];suppliers:Supplier[];categories:ExpenseCategory[];onUpload:()=>void;onBulkUpload:()=>void;onStatusChange:(id:string,status:'pending'|'reviewed'|'accounted')=>Promise<void>;onPaymentStatusChange:(id:string,status:InvoicePaymentStatus,paidAt?:string|null)=>Promise<void>;onBulkPaymentStatusChange:(ids:string[],status:InvoicePaymentStatus,paidAt?:string|null)=>Promise<void>;onOpenFile:(invoice:Invoice)=>Promise<void>;onDelete:(invoice:Invoice)=>Promise<void>;onSupplierChange:(invoiceId:string,supplierId:string)=>Promise<void>;onCategoryChange:(invoiceId:string,categoryId:string)=>Promise<void>;onImported:()=>Promise<void>|void;onManageAccounts:()=>void;canManageAccounts:boolean}){
 const [tab,setTab]=useState<'invoices'|'gmail'>('invoices');
 return <div className="expenseInvoicesHub">
   <div className="expenseHubNavShell">
     <PageTabs label="Facturas de gasto" value={tab} onChange={setTab} items={[{id:'invoices',label:'Facturas de gasto',description:'Histórico, filtros y exportación',icon:<FileText size={18}/>},{id:'gmail',label:'Importar desde Gmail',description:'Buscar y añadir facturas recibidas',icon:<Mail size={18}/>}]} />
   </div>
   <RetainedImportPage active={tab==='invoices'}><Invoices invoices={invoices} suppliers={suppliers} categories={categories} onUpload={onUpload} onBulkUpload={onBulkUpload} onStatusChange={onStatusChange} onPaymentStatusChange={onPaymentStatusChange} onBulkPaymentStatusChange={onBulkPaymentStatusChange} onOpenFile={onOpenFile} onDelete={onDelete} onSupplierChange={onSupplierChange} onCategoryChange={onCategoryChange}/></RetainedImportPage><RetainedImportPage active={tab==='gmail'}><GmailPage categories={categories} onImported={onImported} onManageAccounts={onManageAccounts} canManageAccounts={canManageAccounts}/></RetainedImportPage>
 </div>
}
