import {describe,expect,it} from 'vitest';
import {createSalesInvoicePdfBlob} from '../src/services/salesInvoicePdf';
import {createSalesReceiptPdfBlob} from '../src/services/salesReceiptPdf';

const snapshot={version:1 as const,accountId:'b',alias:'Ventas',iban:'DE89370400440532013000',bic:'COBADEFFXXX',holder:'Empresa de prueba'};
const invoice:any={id:'fixture',clientName:'Cliente prueba',status:'issued',invoiceNumber:'TEST-1',invoiceType:'standard',issueDate:'2026-10-21',currency:'EUR',subtotal:10,discountAmount:0,taxAmount:2.1,totalAmount:12.1,lines:[],payments:[],paidAmount:0,paymentMethod:'Transferencia bancaria',bankAccountSnapshot:snapshot,bankSnapshotSource:'issued'};
const settings:any={legalName:'Empresa prueba',iban:'ES9121000418450200051332'};
const receipt:any={...invoice,receiptNumber:'TEST-R',receiptDate:'2026-10-21',bankSnapshotSource:'receipt_created'};
const content=(blob:Blob)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsText(blob)});

describe('bank snapshots in generated PDFs',()=>{
 it('prints the chosen invoice IBAN, BIC and holder and never the current settings IBAN',async()=>{
  const text=await content(createSalesInvoicePdfBlob(invoice,settings));
  expect(text).toContain(snapshot.iban);expect(text).toContain(snapshot.bic);expect(text).toContain(snapshot.holder);expect(text).not.toContain(settings.iban);
  expect(text.match(/\/Type \/Page\b/g)).toHaveLength(1);
 });
 it('keeps the selected account after live settings change and honours IBAN visibility',async()=>{
  const text=await content(createSalesInvoicePdfBlob(invoice,{...settings,iban:'FR1420041010050500013M02606'}));expect(text).toContain(snapshot.iban);expect(text).not.toContain('FR1420041010050500013M02606');
  const hidden=await content(createSalesInvoicePdfBlob(invoice,settings,null,{showIbanOnPdf:false} as any));expect(hidden).not.toContain(snapshot.iban);expect(hidden).not.toContain(snapshot.bic);
 });
 it('preserves the exact legacy current render including its spacing without inventing the original bank',async()=>{
  const legacy='  es91 2100 0418 4502 0005 1332  ';
  const text=await content(createSalesInvoicePdfBlob({...invoice,bankAccountSnapshot:{...snapshot,iban:legacy,bic:null,holder:null},bankSnapshotSource:'legacy_current_render'},settings));expect(text).toContain(`IBAN: ${legacy}`);expect(text).not.toContain(settings.iban);
 });
 it('does not attach a live bank to missing legacy invoices or unsnapshotted documents',async()=>{
  for(const source of ['legacy_missing',undefined]){const text=await content(createSalesInvoicePdfBlob({...invoice,bankAccountSnapshot:null,bankSnapshotSource:source},settings));expect(text).not.toContain(settings.iban);expect(text).not.toContain('IBAN:');}
 });
 it('preserves the old single-line rendering even for an invalid long legacy value',async()=>{
  const legacy='LEGACY'+('1234567890'.repeat(18));
  const text=await content(createSalesInvoicePdfBlob({...invoice,bankAccountSnapshot:{...snapshot,iban:legacy,bic:null,holder:null},bankSnapshotSource:'legacy_current_render'},settings));
  expect(text).toContain(`IBAN: ${legacy}`);
 });
 it('prints the frozen bank on new receipts and leaves legacy receipts without a bank',async()=>{
  const text=await content(createSalesReceiptPdfBlob(receipt,settings));expect(text).toContain(snapshot.iban);expect(text).toContain(snapshot.bic);expect(text).not.toContain(settings.iban);
  const legacy=await content(createSalesReceiptPdfBlob({...receipt,bankAccountSnapshot:null,bankSnapshotSource:'legacy_missing'},settings));expect(legacy).not.toContain('IBAN:');expect(legacy).not.toContain(settings.iban);
 });
});
