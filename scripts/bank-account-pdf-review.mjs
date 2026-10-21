// Offline fixture only: renders local PDFs, never creates documents in a DB.
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const out='docs/deploy/bank-accounts-20261021/pdf';
await mkdir(out,{recursive:true});
const source=`import {createSalesInvoicePdfBlob} from './src/services/salesInvoicePdf';import {createSalesReceiptPdfBlob} from './src/services/salesReceiptPdf';
const bank={version:1,accountId:'fixture-b',alias:'Ventas',iban:'DE89370400440532013000',bic:'COBADEFFXXX',holder:'Empresa de prueba'};
const settings={legalName:'EMPRESA FICTICIA - PRUEBA LOCAL',iban:'ES9121000418450200051332',taxId:'TEST',addressLine1:'Direccion ficticia 1',countryCode:'ES'};
const invoice={id:'fixture',clientName:'CLIENTE FICTICIO',clientAddress:'Direccion de prueba',status:'issued',invoiceNumber:'PRUEBA-SIN-VALIDEZ',invoiceType:'standard',issueDate:'2026-10-21',currency:'EUR',subtotal:10,discountAmount:0,taxAmount:2.1,totalAmount:12.1,lines:[{description:'DATOS FICTICIOS - SIN VALIDEZ FISCAL',quantity:1,unitPrice:10,taxRate:21,lineTotal:12.1}],payments:[],paidAmount:0,paymentMethod:'Transferencia bancaria',bankAccountSnapshot:bank,bankSnapshotSource:'issued',notes:'PRUEBA LOCAL SIN VALIDEZ FISCAL. No enviar ni contabilizar.'};
export const blobs=[['invoice-bank-b.pdf',createSalesInvoicePdfBlob(invoice,settings)],['receipt-bank-b.pdf',createSalesReceiptPdfBlob({...invoice,receiptNumber:'PRUEBA-RECIBO',receiptDate:'2026-10-21',bankSnapshotSource:'receipt_created'},settings)]];`;
// jsPDF's browser default and Node named export have different interop shapes.
const bundle=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',packages:'external',plugins:[{name:'jspdf-node-interop',setup(b){
 b.onResolve({filter:/^jspdf$/},()=>({path:'jspdf',namespace:'node-adapter'}));
 b.onLoad({filter:/.*/,namespace:'node-adapter'},()=>({contents:"export {jsPDF as default} from 'jspdf/dist/jspdf.node.min.js'",resolveDir:process.cwd()}));
}}]});
await mkdir('tmp/pdfs',{recursive:true});
const modulePath=resolve('tmp/pdfs/bank-review.mjs');
await writeFile(modulePath,bundle.outputFiles[0].text);
const {blobs}=await import(pathToFileURL(modulePath).href);
for(const [name,blob] of blobs)await writeFile(out+'/'+name,Buffer.from(await blob.arrayBuffer()));
console.log('Two offline synthetic PDFs rendered from production PDF generators.');
