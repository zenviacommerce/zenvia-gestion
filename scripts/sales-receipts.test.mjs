import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('sales receipts keep future tax metadata but are not linked to invoices',async()=>{
  const [base,followup]=await Promise.all([
    read('supabase/migrations/20260928133000_sales_receipts.sql'),
    read('supabase/migrations/20260928163500_receipt_payments_unlinked.sql'),
  ]);
  assert.match(base,/create table if not exists public\.sales_receipts/);
  assert.match(base,/create table if not exists public\.sales_receipt_lines/);
  assert.match(base,/invoice_tax_rate/);
  assert.match(followup,/drop column if exists invoice_id/);
  assert.match(base,/REC-%s-%s/);
  assert.match(base,/sales_receipts_workspace_all/);
});

test('receipt payments are independent and protected from overpayment',async()=>{
  const [migration,service]=await Promise.all([
    read('supabase/migrations/20260928163500_receipt_payments_unlinked.sql'),
    read('src/services/salesReceipts.ts'),
  ]);
  assert.match(migration,/create table if not exists public\.sales_receipt_payments/);
  assert.match(migration,/guard_sales_receipt_payment/);
  assert.match(migration,/El cobro no puede superar el importe pendiente del recibo/);
  assert.match(service,/addSalesReceiptPayment/);
  assert.match(service,/paidAmount/);
  assert.doesNotMatch(service,/linkSalesReceiptsToInvoice/);
});

test('Facturación exposes Facturas and Recibos as sibling tabs',async()=>{
  const page=await read('src/pages/SalesInvoices.tsx');
  assert.match(page,/>Facturas<\/strong>/);
  assert.match(page,/>Recibos<\/strong>/);
  assert.match(page,/<SalesReceipts\/>/);
});

test('receipt selection uses the application bulk checkbox component',async()=>{
  const page=await read('src/pages/SalesReceipts.tsx');
  assert.match(page,/BulkSelectCheckbox/);
  assert.match(page,/BulkSelectionToolbar/);
  assert.doesNotMatch(page,/<input type="checkbox"/);
});

test('receipt totals exclude VAT but preserve the rate used by a later invoice',async()=>{
  const [page,pdf]=await Promise.all([
    read('src/pages/SalesReceipts.tsx'),
    read('src/services/salesReceiptPdf.ts'),
  ]);
  assert.match(page,/IVA al facturar/);
  assert.match(page,/IVA en recibo<\/span><strong>0,00 €/);
  assert.match(page,/taxRate:line\.invoiceTaxRate/);
  assert.match(pdf,/Pendiente \(sin IVA\)/);
  assert.match(pdf,/No es una factura ni sustituye a la factura correspondiente/);
});

test('batch invoice preparation groups by client and month without mutating receipts',async()=>{
  const page=await read('src/pages/SalesReceipts.tsx');
  assert.match(page,/receipt\.clientId.*monthKey\(receipt\.receiptDate\)/);
  assert.match(page,/agrupando los recibos seleccionados por cliente y mes natural/);
  assert.doesNotMatch(page,/linkSalesReceiptsToInvoice/);
  assert.match(page,/los recibos no se han modificado/);
  assert.match(page,/deleteSalesInvoiceDraftSafe/);
});
