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

test('all purchase and expense channels converge on InvoiceEngine',async()=>{
const gmail=await read('src/services/gmailImport.ts');const pipeline=await read('src/services/invoiceImportPipeline.ts');assert.match(gmail,/InvoiceEngine.analyze/);assert.match(pipeline,/InvoiceEngine.analyze/);assert.doesNotMatch(gmail,/readInvoiceDocumentEnhanced/);
});

test('camera passes the original image to the intelligence layer rather than only the generated PDF',async()=>{
const upload=await read('src/components/UploadInvoiceModal.tsx');assert.match(upload,/analysisFile=allImages&&files.length===1\?files\[0\]:prepared/);assert.match(upload,/prepareInvoiceCandidates\(prepared,categories,setReaderMessage,analysisFile,policy,nextSource\)/);assert.match(upload,/archiveSourceDocument\(original/);
});


test('expense imports require human review when the AI verifier is unavailable',async()=>{
const engine=await read('src/services/invoiceEngine.ts');assert.match(engine,/emptyDocument/);assert.match(engine,/extractionWarning:reason/);assert.match(engine,/invoice_engine_stage/);assert.match(engine,/validateDocument/);
});

test('sales invoice import accepts images and supports multi-page camera scanning',async()=>{
  const modal=await read('src/components/SalesInvoiceImportModal.tsx');
  assert.match(modal,/imageFilesToPdf/);
  assert.match(modal,/cameraRef/);
  assert.match(modal,/capture="environment"/);
  assert.match(modal,/accept="application\/pdf,image\/\*"/);
  assert.match(modal,/Escanear con cámara/);
});
