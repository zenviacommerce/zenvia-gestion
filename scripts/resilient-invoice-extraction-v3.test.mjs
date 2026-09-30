import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadTs(path){
  const source=await readFile(new URL(path,import.meta.url),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}
const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('date extractor understands English textual invoice dates used by international SaaS invoices',async()=>{
  const {extractInvoiceDate}=await loadTs('../src/services/invoiceDateExtractor.ts');
  assert.equal(extractInvoiceDate('Invoice No. NGAZBM-00001\nDate of issue Sep 27, 2026\nPayment due Sep 27, 2026'),'2026-09-27');
  assert.equal(extractInvoiceDate('Invoice date: September 27, 2026'),'2026-09-27');
});

test('date extractor understands Spanish and continental European textual dates',async()=>{
  const {extractInvoiceDate}=await loadTs('../src/services/invoiceDateExtractor.ts');
  assert.equal(extractInvoiceDate('Fecha de factura: 26 de septiembre de 2026'),'2026-09-26');
  assert.equal(extractInvoiceDate('Date de facture 26 septembre 2026'),'2026-09-26');
  assert.equal(extractInvoiceDate('Data fattura 26 settembre 2026'),'2026-09-26');
  assert.equal(extractInvoiceDate('Rechnungsdatum 26.09.2026'),'2026-09-26');
});

test('issue date beats due, delivery and stay-related dates',async()=>{
  const {extractInvoiceDate}=await loadTs('../src/services/invoiceDateExtractor.ts');
  const text=[
    'Check-in 25/09/2026',
    'Check-out 26/09/2026',
    'Payment due Sep 30, 2026',
    'Date of issue Sep 26, 2026',
  ].join('\n');
  assert.equal(extractInvoiceDate(text),'2026-09-26');
});

test('reader confidence treats zero VAT as valid evidence instead of a missing field',async()=>{
  const source=await read('../src/services/invoiceReader.ts');
  assert.match(source,/Un IVA 0 es perfectamente/);
  assert.match(source,/hasTaxEvidence/);
  assert.match(source,/fiscalRelation/);
  assert.doesNotMatch(source,/\[supplierName, invoiceNumber, invoiceDate, subtotal, vat, total\]\.filter\(Boolean\)/);
});

test('text PDFs with incomplete extraction are automatically cross-checked with OCR',async()=>{
  const source=await read('../src/services/invoiceReader.ts');
  assert.match(source,/shouldCrossCheckWithOcr/);
  assert.match(source,/Contrastando con OCR/);
  assert.match(source,/mergeReadResults/);
  assert.match(source,/if\(!shouldCrossCheckWithOcr\(nativeRead\)\)return nativeRead/);
});
