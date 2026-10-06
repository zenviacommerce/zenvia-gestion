import {PersistentDocumentImportModal} from './PersistentImports';
import type {ExpenseCategory,Invoice,NewInvoiceInput} from '../types';
export const ANALYSIS_CONCURRENCY=2;
export function BulkInvoiceImportModal(props:{open:boolean;onClose:()=>void;categories:ExpenseCategory[];existingInvoices:Invoice[];onSave:(input:NewInvoiceInput)=>Promise<void>;onFinished:()=>Promise<void>|void}){return <PersistentDocumentImportModal open={props.open} onClose={props.onClose} kind="expense_document" categories={props.categories}/>;}
