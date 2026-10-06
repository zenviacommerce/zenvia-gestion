import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
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

test('expense upload, camera, Gmail and sales import all converge on the shared reader',async()=>{
  const [upload,gmail,pipeline,sales]=await Promise.all([
    read('src/components/UploadInvoiceModal.tsx'),
    read('src/services/gmailImport.ts'),
    read('src/services/invoiceImportPipeline.ts'),
    read('src/services/salesInvoiceImport.ts'),
  ]);
  assert.match(upload,/prepareInvoiceCandidate/);
  assert.match(upload,/source==='camera'/);
  assert.match(gmail,/prepareInvoiceCandidate/);
  assert.match(pipeline,/readInvoiceDocumentEnhanced/);
  assert.match(sales,/readInvoiceDocumentEnhanced\(file,\[\],undefined,\{mode:'sales'\}\)/);
});

test('camera passes the original image to the intelligence layer rather than only the generated PDF',async()=>{
  const upload=await read('src/components/UploadInvoiceModal.tsx');
  assert.match(upload,/analysisFile=allImages&&files\.length===1\?files\[0\]:prepared/);
  assert.match(upload,/prepareInvoiceCandidate\(prepared,categories,setReaderMessage,analysisFile,policy\)/);
});


test('expense imports retain policy, recipient and integrity review gates with deterministic fallback',async()=>{
  const pipeline=await read('src/services/invoiceImportPipeline.ts');
  assert.match(pipeline,/if\(configuredReview\.required\)\{\s*status='needs_review'/);
  assert.match(pipeline,/else if\(recipient\.needsReview\)\{\s*status='needs_review'/);
  assert.match(pipeline,/if\(!integrity\.safe\)\{\s*status='needs_review'/);
  assert.match(pipeline,/No se pudo completar la lectura automática\. Revisa y completa los datos antes de guardar/);
  const source=await read('src/services/expenseImportPolicy.ts');
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  const {expenseImportPolicyFromSettings,expenseRequiresReview}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  const policy=expenseImportPolicyFromSettings();
  const complete={invoiceNumber:'INV-100',supplierName:'Proveedor S.L.',invoiceDate:'2026-09-21',total:121,confidence:.95};
  assert.equal(expenseRequiresReview(policy,complete).required,false);
  assert.equal(expenseRequiresReview(policy,{...complete,confidence:.5}).required,true);
  for(const key of ['invoiceNumber','supplierName','invoiceDate','total']){
    assert.equal(expenseRequiresReview(policy,{...complete,[key]:undefined}).required,true,key);
  }
});

test('sales invoice import accepts images and supports multi-page camera scanning',async()=>{
  const modal=await read('src/components/SalesInvoiceImportModal.tsx');
  assert.match(modal,/imageFilesToPdf/);
  assert.match(modal,/cameraRef/);
  assert.match(modal,/capture="environment"/);
  assert.match(modal,/accept="application\/pdf,image\/\*"/);
  assert.match(modal,/Escanear con cámara/);
});
