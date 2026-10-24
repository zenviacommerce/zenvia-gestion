// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createSalesInvoicePdfBlob} from '../src/services/salesInvoicePdf';
import {createVerifactuPreviewBlock} from '../src/services/verifactuQr';
import type {SalesInvoice} from '../src/services/sales';
const invoice={id:'synthetic',status:'issued',invoiceType:'standard',invoiceNumber:'TEST-QR-2026-0001',issueDate:'2026-10-24',currency:'EUR',issuerName:'EMISOR SINTETICO - SIN VALIDEZ FISCAL',issuerTaxId:'89890001K',clientName:'Cliente de demostración',clientTaxId:'89890001K',subtotal:100,taxAmount:21,totalAmount:121,discountAmount:0,paidAmount:0,lines:[{description:'Producto sintético',quantity:1,unit:'ud',unitPrice:100,taxRate:21,lineTotal:121}],payments:[],notes:'DEMOSTRACION SIN VALIDEZ FISCAL. NO REMITIDA.'} as SalesInvoice;
it('adds QR only to explicit synthetic preview and leaves ordinary PDFs unchanged',async()=>{
 const plain=Buffer.from(await createSalesInvoicePdfBlob(invoice).arrayBuffer());
 const context=createVerifactuPreviewBlock({nif:'89890001K',number:invoice.invoiceNumber!,date:invoice.issueDate,total:'121.00'});
 const preview=Buffer.from(await createSalesInvoicePdfBlob(invoice,null,{verifactuPreview:context}).arrayBuffer());
 expect(plain.toString('latin1')).not.toContain('NO REMITIDO');expect(preview.toString('latin1')).toContain('NO REMITIDO');expect(preview.length).toBeGreaterThan(plain.length+1000);
 if(process.env.VF_PDF_EXPORT){mkdirSync(process.env.VF_PDF_EXPORT,{recursive:true});writeFileSync(`${process.env.VF_PDF_EXPORT}/before-no-qr.pdf`,plain);writeFileSync(`${process.env.VF_PDF_EXPORT}/after-test-qr.pdf`,preview);}
});
it('rejects a preview QR belonging to another invoice',()=>{const wrong=createVerifactuPreviewBlock({nif:'89890001K',number:'OTHER',date:invoice.issueDate,total:'121.00'});expect(()=>createSalesInvoicePdfBlob(invoice,null,{verifactuPreview:wrong})).toThrow('VF_PDF_QR_MISMATCH');});
