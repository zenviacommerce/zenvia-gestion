import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('expense originals live in an immutable source_documents archive',async()=>{
  const migration=await read('supabase/migrations/20260929173000_source_documents.sql');
  assert.match(migration,/create table if not exists public\.source_documents/);
  assert.match(migration,/source_document_id uuid references public\.source_documents\(id\) on delete restrict/);
  assert.match(migration,/revoke update,delete on public\.source_documents from authenticated/);
  assert.match(migration,/grant select,insert on public\.source_documents to authenticated/);
  assert.match(migration,/backfilledFrom','invoices'/);
  assert.match(migration,/gmail_imports_orphaned_source/);
});

test('creating or deleting an accounting interpretation never deletes the archived original',async()=>{
const repository=await read('src/services/repository.ts');assert.match(repository,/archiveSourceDocument/);assert.match(repository,/return InvoiceEngine.save\(input\)/);const deleteBlock=repository.slice(repository.indexOf('export async function deleteInvoice'),repository.indexOf('export async function getInvoiceFileUrl'));assert.doesNotMatch(deleteBlock,/storage.*remove/);const sql=await read('supabase/migrations/20261002190000_invoice_engine.sql');assert.match(sql,/on delete restrict/);assert.match(sql,/src.id,src.storage_path/);
});

test('Gmail originals are archived before inference and linked to their email',async()=>{
const engine=await read('src/services/invoiceEngine.ts');const archive=engine.indexOf('await archiveSourceDocument');const infer=engine.indexOf("fetch('/api/invoice-engine'");assert.ok(archive>0&&infer>archive);assert.match(engine,/source_document_id:archived.id/);
});

test('exports use the source-document path resolved by loadAppData and do not re-run extraction',async()=>{
  const [repository,exporter]=await Promise.all([
    read('src/services/repository.ts'),
    read('src/services/exportQuarter.ts'),
  ]);
  assert.match(repository,/sourceDocument\?\.storage_path\|\|i\.file_path/);
  assert.match(repository,/sourceDocument\?\.original_name\|\|i\.file_name/);
  assert.match(exporter,/downloadInvoiceFile\(invoice\.filePath\)/);
  assert.doesNotMatch(exporter,/ocr|prepareInvoiceCandidate|readInvoice/i);
});
