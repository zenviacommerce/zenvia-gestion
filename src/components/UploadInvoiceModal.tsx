import {PersistentDocumentImportModal} from './PersistentImports';
import type {ExpenseCategory,Invoice,NewInvoiceInput} from '../types';
export function UploadInvoiceModal(props:{open:boolean;onClose:()=>void;onSave:(input:NewInvoiceInput)=>Promise<void>;categories:ExpenseCategory[];existingInvoices:Invoice[]}){return <PersistentDocumentImportModal open={props.open} onClose={props.onClose} kind="expense_document" categories={props.categories} multiple={false}/>;}
