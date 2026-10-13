import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const strip=path=>stripTypeScriptTypes(fs.readFileSync(path,'utf8').replace(/^import[\s\S]*?;\n/gm,'').replaceAll('export ',''));
const currency=vm.runInNewContext(strip('src/services/invoiceCurrency.ts')+'\ndetectInvoiceCurrency',{});
const reader=vm.runInNewContext(strip('src/services/invoiceReader.ts')+'\nextractInvoiceNumber',{pdfjsLib:{GlobalWorkerOptions:{}},pdfWorker:'worker'});
const validate=vm.runInNewContext(strip('src/services/invoiceImportPipeline.ts')+'\nvalidateInvoiceCandidateIntegrity',{Date,isPlausibleSupplierName:()=>true,invoiceAmountsConsistent:()=>true});
test('OCR representative text Ron does not override the actual euro symbol',()=>{
 assert.equal(currency('FACTURA N= 12615247\nRon ANTONIO REPRESENTANTE\nTOTAL FACTURA 3.571,92\n€')?.currency,'EUR');
});
test('Romanian currency is still recognized beside an amount or explicit currency label',()=>{
 assert.equal(currency('Total 120,00 RON')?.currency,'RON');
 assert.equal(currency('Currency: RON\nTotal 120,00')?.currency,'RON');
});
test('OCR invoice N= label wins over the later total invoice heading',()=>{
 const text='FACTURA N= 12615247\nFECHA 09/10/2026\nBase Imponible % IVA Importe IVA TOTAL FACTURA\n2.952.00 21,00 619,92';
 assert.equal(reader(text.split('\n'),text),'12615247');
});
test('a monetary value is never accepted as an invoice identifier',()=>{
 const text='TOTAL FACTURA\n2.952.00';assert.equal(reader(text.split('\n'),text),'');
 const result=validate({supplierName:'Empresa Ejemplo SL',invoiceNumber:'2.952.00',invoiceDate:'2026-10-09',subtotal:2952,vat:619.92,equivalenceSurcharge:0,withholding:0,total:3571.92});
 assert.equal(result.safe,false);assert.ok(result.reasons.some(reason=>reason.includes('número')));
});
const products=vm.runInNewContext(strip('src/services/invoiceProductLine.ts')+'\n({repairInvoiceProductLines,parseSimpleInvoiceProductRow})',{});
test('product codes do not become quantities when one row omits its box-count column',()=>{
 const text='Código Descripción Cajas Cantidad Precio Importe\n0889 35 x 50 camiseta 200 uds blanca 40.00 1.000,00 2.0000 2.000,00\n1724 LAMINA CARTON COMPLEJO ORO/PLATA 17X24 (100 UDS) 80.00 11,9000 952,00\nBase Imponible % IVA Importe IVA TOTAL FACTURA\n2.952.00 21,00 619,92';
 const rows=products.repairInvoiceProductLines(text,[]);
 assert.equal(rows.length,2);assert.equal(rows[0].quantity,1000);assert.equal(rows[1].quantity,80);
 assert.equal(rows[0].supplierSku,'0889');assert.equal(rows[1].supplierSku,'1724');
 assert.equal(rows.reduce((sum,row)=>sum+row.lineTotal,0),2952);
});
test('fiscal numeric rows are not interpreted as purchased products',()=>{
 assert.equal(products.parseSimpleInvoiceProductRow('2.952.00 21,00 619,92'),null);
});
