import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('sales receipts persist independently from invoices and keep future tax metadata',async()=>{
  const migration=await read('supabase/migrations/20260928133000_sales_receipts.sql');
  assert.match(migration,/create table if not exists public\.sales_receipts/);
  assert.match(migration,/create table if not exists public\.sales_receipt_lines/);
  assert.match(migration,/invoice_tax_rate/);
  assert.match(migration,/invoice_id uuid references public\.sales_invoices\(id\) on delete set null/);
  assert.match(migration,/REC-%s-%s/);
  assert.match(migration,/sales_receipts_workspace_all/);
});

test('Facturación exposes Facturas and Recibos as sibling tabs',async()=>{
  const page=await read('src/pages/SalesInvoices.tsx');
  assert.match(page,/>Facturas<\/strong>/);
  assert.match(page,/>Recibos<\/strong>/);
  assert.match(page,/<SalesReceipts\/>/);
});

test('receipt totals exclude VAT but preserve the rate used by the later invoice',async()=>{
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

test('batch conversion groups selected receipts by client and calendar month',async()=>{
  const page=await read('src/pages/SalesReceipts.tsx');
  assert.match(page,/receipt\.clientId.*monthKey\(receipt\.receiptDate\)/);
  assert.match(page,/agrupando los recibos por cliente y mes natural/);
  assert.match(page,/linkSalesReceiptsToInvoice/);
  assert.match(page,/deleteSalesInvoiceDraftSafe/);
});
