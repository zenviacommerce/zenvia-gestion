import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('Gmail invoice import uses the shared candidate pipeline and stops uncertain data before persistence',async()=>{
const source=await read('../src/services/gmailImport.ts');assert.match(source,/InvoiceEngine.analyze/);assert.match(source,/candidate.status==='needs_review'/);assert.match(source,/InvoiceEngine.save/);assert.match(source,/reviewRequired:true/);assert.doesNotMatch(source,/lines:\[\]/);
});

test('Gmail review UI edits the shared candidate before explicitly saving it',async()=>{
  const source=await read('../src/pages/Gmail.tsx');
  assert.match(source,/InvoiceCandidateForm/);
  assert.match(source,/saveReviewedGmailCandidate/);
  assert.match(source,/REVISIÓN SEGURA/);
  assert.match(source,/No se creará la factura ni el proveedor hasta que confirmes estos datos/);
});

test('common validation checks fiscal identity dates lines and totals',async()=>{
const source=await read('../shared/invoiceEngineCore.mjs');assert.match(source,/validateDocument/);assert.match(source,/validSpanishTaxId/);assert.match(source,/dateValid/);assert.match(source,/Las líneas no suman/);assert.match(source,/El total no cuadra/);
});

test('date parser uses the shared evidence extractor with OCR-tolerant separators',async()=>{
  const reader=await read('../src/services/invoiceReader.ts');
  const dates=await read('../src/services/invoiceDateExtractor.ts');
  assert.match(reader,/extractInvoiceDate/);
  assert.match(dates,/validDate/);
  assert.match(dates,/\\s\*\[-\/.\]\\s\*/);
});

test('merchandise detection is based on generic table structure rather than supplier names',async()=>{
  const source=await read('../src/services/invoiceReaderV2.ts');
  assert.match(source,/concepto\|descripcion\|producto\|detalle/);
  assert.match(source,/tableMarkers/);
  assert.match(source,/cantidad/);
  assert.match(source,/precio/);
  assert.doesNotMatch(source,/Cash Sierra Nevada/i);
});

test('Gmail persistence revalidates integrity immediately before writing',async()=>{
const source=await read('../src/services/invoiceEngine.ts');
const validate=source.indexOf('const validation=validateDocument(d,{reviewed})');const commit=source.indexOf("rpc('invoice_engine_commit'",validate);assert.ok(validate>0&&commit>validate);assert.match(source,/validation.status!=='ready'/);
});

test('customer orders remain a hard-negative document type',async()=>{
  const classifier=await read('../src/services/invoiceCandidateClassifier.ts');
  assert.match(classifier,/pedido\\s\+de\\s\+cliente/);
  assert.match(classifier,/hardDocumentNegative/);
  assert.match(classifier,/!hardDocumentNegative/);
});
