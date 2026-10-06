import { InvoiceEngineQueue } from '../components/InvoiceEngineQueue';
import { useState } from 'react';
import { FileText, Mail } from 'lucide-react';
import type { ExpenseCategory, Invoice, InvoicePaymentStatus, Supplier } from '../types';
import { Invoices } from './Invoices';
import { GmailPage } from './Gmail';

export function ExpenseInvoicesHub({invoices,suppliers,categories,onUpload,onBulkUpload,onStatusChange,onPaymentStatusChange,onBulkPaymentStatusChange,onOpenFile,onDelete,onSupplierChange,onCategoryChange,onImported,onManageAccounts,canManageAccounts}:{invoices:Invoice[];suppliers:Supplier[];categories:ExpenseCategory[];onUpload:()=>void;onBulkUpload:()=>void;onStatusChange:(id:string,status:'pending'|'reviewed'|'accounted')=>Promise<void>;onPaymentStatusChange:(id:string,status:InvoicePaymentStatus,paidAt?:string|null)=>Promise<void>;onBulkPaymentStatusChange:(ids:string[],status:InvoicePaymentStatus,paidAt?:string|null)=>Promise<void>;onOpenFile:(invoice:Invoice)=>Promise<void>;onDelete:(invoice:Invoice)=>Promise<void>;onSupplierChange:(invoiceId:string,supplierId:string)=>Promise<void>;onCategoryChange:(invoiceId:string,categoryId:string)=>Promise<void>;onImported:()=>Promise<void>|void;onManageAccounts:()=>void;canManageAccounts:boolean}){
 const [tab,setTab]=useState<'invoices'|'gmail'>('invoices');
 return <div className="expenseInvoicesHub">
   <InvoiceEngineQueue categories={categories} onImported={onImported}/>
   <div className="expenseHubNavShell">
     <div className="expenseHubNav" role="tablist" aria-label="Facturas de gasto">
       <button role="tab" aria-selected={tab==='invoices'} className={tab==='invoices'?'active':''} onClick={()=>setTab('invoices')}>
         <span className="expenseHubTabIcon"><FileText size={18}/></span>
         <span className="expenseHubTabText"><strong>Facturas de gasto</strong><small>Histórico, filtros y exportación</small></span>
       </button>
       <button role="tab" aria-selected={tab==='gmail'} className={tab==='gmail'?'active':''} onClick={()=>setTab('gmail')}>
         <span className="expenseHubTabIcon"><Mail size={18}/></span>
         <span className="expenseHubTabText"><strong>Importar desde Gmail</strong><small>Buscar y añadir facturas recibidas</small></span>
       </button>
     </div>
   </div>
   {tab==='invoices'?<Invoices invoices={invoices} suppliers={suppliers} categories={categories} onUpload={onUpload} onBulkUpload={onBulkUpload} onStatusChange={onStatusChange} onPaymentStatusChange={onPaymentStatusChange} onBulkPaymentStatusChange={onBulkPaymentStatusChange} onOpenFile={onOpenFile} onDelete={onDelete} onSupplierChange={onSupplierChange} onCategoryChange={onCategoryChange}/>:<GmailPage categories={categories} onImported={onImported} onManageAccounts={onManageAccounts} canManageAccounts={canManageAccounts}/>}
 </div>
}
