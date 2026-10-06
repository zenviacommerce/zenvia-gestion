import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('single invoice upload uses the persistent document flow and shared review form',async()=>{
  const modal=await read('../src/components/UploadInvoiceModal.tsx');const ui=await read('../src/components/PersistentImports.tsx');assert.match(modal,/PersistentDocumentImportModal/);assert.match(ui,/InvoiceCandidateForm/);assert.doesNotMatch(modal,/readInvoiceDocumentEnhanced/);
});

test('shared candidate form includes equivalence surcharge and editable invoice header',async()=>{
  const source=await read('../src/components/InvoiceCandidateForm.tsx');
  assert.match(source,/Proveedor/);
  assert.match(source,/Nº de factura/);
  assert.match(source,/Fecha/);
  assert.match(source,/Base imponible/);
  assert.match(source,/IVA/);
  assert.match(source,/Recargo equivalencia/);
  assert.match(source,/Total/);
});

test('single upload receives existing invoices for duplicate classification',async()=>{
  const [upload,app]=await Promise.all([
    read('../src/components/UploadInvoiceModal.tsx'),
    read('../src/App.tsx'),
  ]);
  assert.match(upload,/existingInvoices/);
  assert.match(app,/existingInvoices=\{data\.invoices\}/);
});
