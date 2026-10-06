import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('model failure persists review and setup failure blocks legacy bypass',async()=>{
const source=await read('../src/services/invoiceEngine.ts');
assert.match(source,/emptyDocument/);assert.match(source,/invoice_engine_stage/);const upload=await read('../src/components/UploadInvoiceModal.tsx');assert.match(upload,/setReaderBlocked\(true\)/);assert.doesNotMatch(upload,/setCandidate\(manualCandidate\)/);
});

test('bulk import always clears busy state even when final refresh fails',async()=>{
  const source=await read('../src/components/BulkInvoiceImportModal.tsx');
  assert.match(source,/try\s*\{[\s\S]*await\s+onFinished\(\)[\s\S]*\}\s*finally\s*\{\s*setBusy\(false\)/);
});
