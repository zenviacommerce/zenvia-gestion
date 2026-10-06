import test from 'node:test';import assert from 'node:assert/strict';
const api=await import('../shared/imports/documentRules.ts').catch(()=>({}));
const good={supplierName:'Proveedor SL',invoiceNumber:'F-123',invoiceDate:'2026-10-01',subtotal:100,vat:21,equivalenceSurcharge:0,withholding:0,total:121,currency:'EUR',confidence:.99,lines:[]};
test('rejects invalid fiscal close and missing currency even after review',()=>{
 assert.equal(typeof api.validateDocumentCandidate,'function');
 assert.equal(api.validateDocumentCandidate({...good,total:123},'expense_document',true).safe,false);
 assert.equal(api.validateDocumentCandidate({...good,currency:''},'expense_document',true).safe,false);
});
test('low confidence requires review but reviewed valid amounts can be accepted',()=>{
 assert.equal(typeof api.validateDocumentCandidate,'function');
 assert.equal(api.validateDocumentCandidate({...good,confidence:.2},'expense_document').safe,false);
 assert.equal(api.validateDocumentCandidate({...good,confidence:.2},'expense_document',true).safe,true);
});
test('negative credit notes and unknown documents never auto create expense invoice',()=>{
 assert.equal(typeof api.validateDocumentCandidate,'function');
 assert.equal(api.validateDocumentCandidate({...good,total:-121,subtotal:-100,vat:-21},'expense_document').safe,false);
 assert.equal(api.validateDocumentCandidate({...good,documentKind:'not_invoice'},'expense_document').safe,false);
});
test('tariff requires valid weight bands and prices and explicit review',()=>{
 assert.equal(typeof api.validateDocumentCandidate,'function');
 const tariff={carrierCode:'mrw',carrierName:'MRW',currencyCode:'EUR',services:[{serviceName:'24h',canonicalServiceKey:'24h',bands:[{countryCode:'ES',zoneCode:'ES',zoneName:'España',minWeightKg:0,maxWeightKg:1,basePrice:3}]}]};
 assert.equal(api.validateDocumentCandidate(tariff,'transport_tariff').safe,false);
 assert.equal(api.validateDocumentCandidate(tariff,'transport_tariff',true).safe,true);
 assert.equal(api.validateDocumentCandidate({...tariff,services:[]},'transport_tariff',true).safe,false);
});
test('sales headers cannot hide different totals in the persisted lines',()=>{const c={invoiceNumber:'F-123',issueDate:'2026-10-01',currency:'EUR',clientId:'client',seriesId:'series',subtotal:100,taxAmount:21,totalAmount:121,confidence:1,lines:[{description:'Servicio',quantity:1,unitPrice:200,taxRate:21}]};assert.equal(api.validateDocumentCandidate(c,'sales_document',true).safe,false)});
test('line prices and discounts must be finite and within fiscal limits',()=>{const c={invoiceNumber:'F-123',issueDate:'2026-10-01',currency:'EUR',clientId:'client',seriesId:'series',subtotal:100,taxAmount:21,totalAmount:121,confidence:1,lines:[{description:'Servicio',quantity:1,unitPrice:100,taxRate:21,discountPercent:150}]};assert.equal(api.validateDocumentCandidate(c,'sales_document',true).safe,false)});
test('incomplete expense lines stay in review rather than failing during business commit',()=>{assert.equal(api.validateDocumentCandidate({...good,lines:[{description:'Producto',quantity:1}]},'expense_document').safe,false)});
test('positive credit notes cannot be booked as ordinary invoices, even after review',()=>{for(const kind of ['expense_document','sales_document']){const credit={...good,documentKind:'credit_note',issueDate:good.invoiceDate,clientId:'client',seriesId:'series',taxAmount:21,totalAmount:121,lines:[{description:'Abono',quantity:1,unitPrice:100,taxRate:21}]};assert.equal(api.validateDocumentCandidate(credit,kind).safe,false);assert.equal(api.validateDocumentCandidate(credit,kind,true).safe,false)}});
