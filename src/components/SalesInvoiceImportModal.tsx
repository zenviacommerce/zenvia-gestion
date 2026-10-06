import {PersistentDocumentImportModal} from './PersistentImports';
import type {Client,SalesInvoice} from '../services/sales';
export function SalesInvoiceImportModal(props:{open:boolean;onClose:()=>void;clients:Client[];existingInvoices:SalesInvoice[];onFinished:()=>Promise<void>|void}){return <PersistentDocumentImportModal open={props.open} onClose={props.onClose} kind="sales_document"/>;}
