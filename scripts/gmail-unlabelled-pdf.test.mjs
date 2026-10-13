import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';

function classifier(text=''){
 const source=fs.readFileSync('src/services/invoiceCandidateClassifier.ts','utf8').replace(/^import[\s\S]*?;\n/gm,'').replaceAll('export ','');
 return vm.runInNewContext(stripTypeScriptTypes(source)+'\n({shouldInspectInvoiceAttachment,classifyInvoiceFile})',{readInvoiceDocument:async()=>({text})});
}
const opaque={filename:'BRWACD564E7F29.pdf',subject:null,snippet:'',sender:'shop@example.org'};
test('a PDF with an opaque filename and no subject reaches document classification',()=>{
 assert.equal(classifier().shouldInspectInvoiceAttachment(opaque),true);
});
test('real invoice content is recognized without any email or filename billing hint',async()=>{
 const c=classifier('FACTURA Nº F2026-123 Fecha factura: 13/10/2026 Proveedor: Tienda Ejemplo CIF B12345678 Base imponible 100,00 EUR IVA 21,00 EUR Total factura 121,00 EUR');
 assert.equal((await c.classifyInvoiceFile({},opaque)).isInvoice,true);
});
test('reading an unlabelled PDF does not turn an ordinary document into an invoice',async()=>{
 const c=classifier('Manual de instrucciones. Conservar en un lugar seco. Garantía de dos años.');
 assert.equal((await c.classifyInvoiceFile({},opaque)).isInvoice,false);
});
test('opaque PDF content marked as a proforma remains excluded',async()=>{
 const c=classifier('PROFORMA FACTURA Nº F2026-123 Base imponible 100,00 EUR IVA 21,00 EUR Total factura 121,00 EUR');
 assert.equal((await c.classifyInvoiceFile({},opaque)).isInvoice,false);
});
