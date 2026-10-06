import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('bulk invoice modal submits multiple originals to the durable queue',async()=>{
  const modal=await read('../src/components/BulkInvoiceImportModal.tsx');const ui=await read('../src/components/PersistentImports.tsx');assert.match(modal,/PersistentDocumentImportModal/);assert.match(ui,/multiple=\{multiple\}/);assert.match(ui,/startDocumentImport/);assert.doesNotMatch(modal,/prepareInvoiceCandidate/);
});

test('bulk worker isolates each item and reviews through versioned API',async()=>{
  const worker=await read('../shared/imports/worker.ts');const ui=await read('../src/components/PersistentImports.tsx');assert.match(worker,/try\{outcome=await execute\(item\)/);assert.match(worker,/errorOutcome/);assert.match(ui,/reviewImportItem\(selected,candidate\)/);
});

test('bulk review restores fiscal candidate through the common form',async()=>{
  const ui=await read('../src/components/PersistentImports.tsx');const form=await read('../src/components/InvoiceCandidateForm.tsx');assert.match(ui,/InvoiceCandidateForm/);assert.match(form,/equivalenceSurcharge/);assert.match(ui,/item.result.candidate/);assert.match(ui,/candidate.lines/);
});

test('bulk invoice list uses polished card hierarchy, status badges and responsive dark styling',async()=>{
  const [css,main]=await Promise.all([
    read('../src/bulk-invoice-import.css'),
    read('../src/main.tsx'),
  ]);
  assert.match(main,/import ['"]\.\/bulk-invoice-import\.css['"]/);
  assert.match(css,/\.bulkInvoiceModal\{/);
  assert.match(css,/\.bulkInvoiceRow\{/);
  assert.match(css,/\.bulkInvoiceFile>div span\{/);
  assert.match(css,/\.bulkInvoiceMeta\{/);
  assert.match(css,/\.bulkInvoiceActions\{/);
  assert.match(css,/\.bulkInvoiceRow\.duplicate/);
  assert.match(css,/html\[data-theme=['"]dark['"]\]/);
  assert.match(css,/@media\(max-width:700px\)/);
});

test('invoice page exposes bulk import action and App renders the bulk modal',async()=>{
  const [invoices,hub,app]=await Promise.all([
    read('../src/pages/Invoices.tsx'),
    read('../src/pages/ExpenseInvoicesHub.tsx'),
    read('../src/App.tsx'),
  ]);
  assert.match(invoices,/onBulkUpload/);
  assert.match(invoices,/Importar facturas/);
  assert.match(hub,/onBulkUpload/);
  assert.match(app,/BulkInvoiceImportModal/);
  assert.match(app,/bulkUpload/);
});
