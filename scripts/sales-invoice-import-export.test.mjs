import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('sales invoice page exposes import and filtered export actions',async()=>{
  const page=await source('src/pages/SalesInvoices.tsx');
  assert.match(page,/SalesInvoiceImportModal/);
  assert.match(page,/exportSalesInvoices/);
  assert.match(page,/Importar facturas/);
  assert.match(page,/Exportar \(/);
});

test('sales invoice import reads PDFs into reviewable draft candidates and never auto-issues',async()=>{
  const service=await source('src/services/salesInvoiceImport.ts');
  assert.match(service,/readInvoiceDocumentEnhanced/);
  assert.match(service,/createSalesInvoiceDraft/);
  assert.match(service,/updateSalesInvoiceNumber/);
  assert.match(service,/matchSalesInvoiceClient/);
  assert.doesNotMatch(service,/issueSalesInvoice\s*\(/);
});

test('persistent sales review confirms client series and lines before creating drafts',async()=>{
  const modal=await source('src/components/SalesInvoiceImportModal.tsx');const ui=await source('src/components/PersistentImports.tsx');const engine=await source('supabase/functions/_shared/imports/documentEngine.ts');assert.match(modal,/PersistentDocumentImportModal/);assert.match(ui,/Cliente/);assert.match(ui,/Serie/);assert.match(ui,/Confirmar datos e importar/);assert.match(engine,/job.kind==='sales_document'/);
});

test('sales invoice export creates a zip with CSV summary and generated invoice PDFs',async()=>{
  const service=await source('src/services/salesInvoiceExport.ts');
  assert.match(service,/JSZip/);
  assert.match(service,/createSalesInvoicePdfBlob/);
  assert.match(service,/resumen_/);
  assert.match(service,/facturas/);
  assert.match(service,/\.csv/);
});

test('sales persistence keeps fiscal identity and the configured due-date trigger',async()=>{
  const migration=await source('supabase/migrations/20261006170531_persistent_import_hardening.sql');const defaults=await source('supabase/migrations/20260921002000_configurable_sales_due_days.sql');assert.match(migration,/proposedClient,taxId/);assert.match(migration,/tax_registration_id/);assert.match(defaults,/private.sales_default_due_days/);assert.match(migration,/nullif\(c->>'dueDate',''\)/);
});

test('desktop sidebar hides the mobile drawer close button',async()=>{
  const css=await source('src/mobile-nav.css');
  assert.match(css,/\.sidebar \.mobileMenuClose\{display:none!important\}/);
  assert.match(css,/@media[\s\S]*\.sidebar \.mobileMenuClose\{[\s\S]*display:grid!important/);
});
