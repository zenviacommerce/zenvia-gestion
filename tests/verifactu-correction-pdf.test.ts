import {it,expect} from 'vitest';
import {createSalesInvoicePdfBlob} from '../src/services/salesInvoicePdf';
const invoice:any={id:'correction',status:'issued',invoiceType:'rectifying',invoiceNumber:'R20260001',issueDate:'2026-10-24',currency:'EUR',subtotal:80,taxAmount:16.8,totalAmount:96.8,discountAmount:0,paidAmount:0,clientName:'Cliente sintético',issuerName:'Emisor sintético',lines:[],payments:[],rectifiesInvoiceId:'original',rectificationOriginalNumber:'F202655',rectificationOriginalDate:'2026-10-24',rectificationOriginalBase:100,rectificationOriginalTax:21,verifactuType:'R1',rectificationMode:'S',rectificationReason:'Devolución parcial de producto'};
const content=(blob:Blob)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsText(blob)});
it('prints the original number/date, classification, reason and substituted base/tax in the real PDF',async()=>{
 const pdf=await content(createSalesInvoicePdfBlob(invoice));
 for(const value of ['F202655','24/10/2026','R1','100,00','21,00','Devoluci'])expect(pdf).toContain(value);
 expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(1);
});
it('keeps legacy ordinary PDF content unchanged by correction metadata',async()=>{
 const ordinary={...invoice,invoiceType:'standard',rectifiesInvoiceId:null};
 const pdf=await content(createSalesInvoicePdfBlob(ordinary));expect(pdf).not.toContain('F202655');
});
it('paginates a 1000-character reason and subsequent line items without dropping the last line',async()=>{
 const reason=('Motivo de corrección con detalle documental.\n'.repeat(30)).slice(0,1000);
 const lines=Array.from({length:80},(_,index)=>({position:index+1,description:`Concepto ${index+1} de la corrección`,quantity:1,unit:'ud',unitPrice:1,discountPercent:0,taxRate:21,lineTotal:1.21}));
 const blob=createSalesInvoicePdfBlob({...invoice,rectificationReason:reason,lines});const pdf=await content(blob);
 if(process.env.VF_CORRECTION_PDF_CAPTURE){const {writeFileSync}=await import('node:fs');const buffer=await new Promise<ArrayBuffer>((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result as ArrayBuffer);r.onerror=rej;r.readAsArrayBuffer(blob)});writeFileSync(process.env.VF_CORRECTION_PDF_CAPTURE,Buffer.from(buffer));}
 expect(pdf.match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(1);expect(pdf).toContain('F202655');expect(pdf).toContain('Concepto 80');
});
