import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('shared invoice reader runs deterministic extraction then evidence-validated AI',async()=>{
  const [reader,client]=await Promise.all([
    read('src/services/invoiceReaderEnhanced.ts'),
    read('src/services/invoiceIntelligence.ts'),
  ]);
  assert.match(reader,/analyzeInvoiceWithIntelligence/);
  assert.match(reader,/Contrastando la lectura con IA y evidencia documental/);
  assert.match(client,/invoice-document-intelligence/);
  assert.match(client,/verification\.fiscalConsistent/);
  assert.match(client,/verifiedParty/);
  assert.match(client,/verifiedLines/);
});

test('AI backend uses strict structured outputs and rejects unsupported claims',async()=>{
  const edge=await read('supabase/functions/invoice-document-intelligence/index.ts');
  assert.match(edge,/type:'json_schema'/);
  assert.match(edge,/strict:true/);
  assert.match(edge,/evidenceSupported/);
  assert.match(edge,/fiscalConsistent/);
  assert.match(edge,/Si un dato no aparece con evidencia suficiente, devuelve null/);
  assert.match(edge,/No uses el nombre del archivo como evidencia/);
  assert.match(edge,/verifiedLines/);
  assert.match(edge,/OPENAI_API_KEY/);
});

test('expense upload camera Gmail and sales use one server analysis engine',async()=>{
  const registry=await read('supabase/functions/_shared/imports/registry.ts');const gmail=await read('supabase/functions/_shared/imports/gmailAdapter.ts');const ui=await read('src/components/PersistentImports.tsx');assert.match(registry,/executeDocument/);assert.match(gmail,/executeDocument/);assert.match(ui,/startDocumentImport/);assert.doesNotMatch(ui,/invoice-document-intelligence/);
});

test('camera uploads a multipage original and local analysis renders every PDF page',async()=>{
  const ui=await read('src/components/PersistentImports.tsx');const reader=await read('tools/document-worker/documents.py');assert.match(ui,/imageFilesToPdf\(files\)/);assert.match(reader,/for index,page in enumerate\(pdf\)/);assert.match(reader,/page.get_pixmap/);
});


test('expense imports require human review when the AI verifier is unavailable',async()=>{
  const pipeline=await read('src/services/invoiceImportPipeline.ts');
  assert.match(pipeline,/aiUnavailable/);
  assert.match(pipeline,/La validación IA documental no está disponible/);
  assert.match(pipeline,/status='needs_review'/);
});

test('sales invoice import delegates to the common camera and document flow',async()=>{
  const modal=await read('src/components/SalesInvoiceImportModal.tsx');const ui=await read('src/components/PersistentImports.tsx');assert.match(modal,/kind="sales_document"/);assert.match(ui,/capture="environment"/);assert.match(ui,/accept="application\/pdf,image\/\*"/);assert.match(ui,/Escanear con cámara/);
});
