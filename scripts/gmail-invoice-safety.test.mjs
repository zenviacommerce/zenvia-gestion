import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('Gmail invoice import uses the shared candidate pipeline and stops uncertain data before persistence',async()=>{
  const source=await read('../src/services/gmailImport.ts');
  assert.match(source,/prepareInvoiceCandidate/);
  assert.match(source,/invoiceCandidateToInput/);
  assert.match(source,/prepared\.status==='needs_review'/);
  assert.match(source,/reviewRequired:true/);
  assert.match(source,/kind:'review'/);
  assert.doesNotMatch(source,/import \{ readInvoiceDocumentEnhanced \}/);
  assert.doesNotMatch(source,/extraction\.supplierName \|\| senderFallback/);
});

test('Gmail restores a persisted review and submits an explicit versioned confirmation',async()=>{
  const source=await read('../src/pages/Gmail.tsx');const ui=await read('../src/components/PersistentImports.tsx');assert.match(source,/persistentJobId/);assert.match(source,/ImportJobDetail/);assert.match(ui,/InvoiceCandidateForm/);assert.match(ui,/reviewImportItem/);assert.match(ui,/Confirmar datos e importar/);
});

test('shared pipeline validates supplier number date total and fiscal consistency',async()=>{
  const source=await read('../src/services/invoiceImportPipeline.ts');
  assert.match(source,/validateInvoiceCandidateIntegrity/);
  assert.match(source,/saneSupplierName/);
  assert.match(source,/saneInvoiceNumber/);
  assert.match(source,/saneInvoiceDate/);
  assert.match(source,/invoiceAmountsConsistent/);
  assert.match(source,/status='needs_review'/);
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
  const source=await read('../src/services/gmailImport.ts');
  const persist=source.slice(source.indexOf('async function persistPreparedGmailInvoice'),source.indexOf('export async function saveReviewedGmailCandidate'));
  assert.match(persist,/validateInvoiceCandidateIntegrity\(prepared\)/);
  assert.match(persist,/La factura no supera la validación final/);
  assert.ok(persist.indexOf('validateInvoiceCandidateIntegrity(prepared)')<persist.indexOf('createInvoice(invoiceInput)'));
});

test('customer orders remain a hard-negative document type',async()=>{
  const classifier=await read('../src/services/invoiceCandidateClassifier.ts');
  assert.match(classifier,/pedido\\s\+de\\s\+cliente/);
  assert.match(classifier,/hardDocumentNegative/);
  assert.match(classifier,/!hardDocumentNegative/);
});
