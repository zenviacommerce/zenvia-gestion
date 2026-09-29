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
  const repository=await read('src/services/repository.ts');
  assert.match(repository,/export async function archiveSourceDocument/);
  assert.match(repository,/source_document_id:archivedSource\.id/);
  assert.match(repository,/return invoice\.id as string/);
  const deleteBlock=repository.slice(repository.indexOf('export async function deleteInvoice'),repository.indexOf('export async function getInvoiceFileUrl'));
  assert.doesNotMatch(deleteBlock,/storage\.from\(INVOICE_BUCKET\)\.remove/);
  assert.match(deleteBlock,/evidencia inmutable/i);
});

test('Gmail archives the original attachment before classification and can link ignored documents',async()=>{
  const gmail=await read('src/services/gmailImport.ts');
  const download=gmail.indexOf('downloadGmailAttachment');
  const archive=gmail.indexOf("archiveSourceDocument(file,'gmail'",download);
  const classify=gmail.indexOf('classifyInvoiceFile',archive);
  assert.ok(download>=0&&archive>download&&classify>archive);
  assert.match(gmail,/source_document_id:archivedSource\.id/);
  assert.match(gmail,/prepared\.sourceDocumentId=archivedSource\.id/);
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
