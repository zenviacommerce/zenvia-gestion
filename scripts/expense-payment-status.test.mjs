import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('expense invoices keep payment state separate from accounting status',async()=>{
  const types=await read('../src/types.ts');
  const repository=await read('../src/services/repository.ts');
  assert.match(types,/InvoicePaymentStatus = 'unpaid' \| 'paid'/);
  assert.match(types,/paymentStatus: InvoicePaymentStatus/);
  assert.match(types,/paidAt\?: string \| null/);
  assert.match(repository,/paymentStatus:\s*i\.payment_status==='paid'\?'paid':'unpaid'/);
  assert.match(repository,/updateInvoicePaymentStatus/);
  assert.match(repository,/paid_at:resolvedPaidAt/);
});

test('expense list exposes payment controls, filtering and unpaid KPI',async()=>{
  const invoices=await read('../src/pages/Invoices.tsx');
  const filters=await read('../src/components/InvoiceFilters.tsx');
  const service=await read('../src/services/filters.ts');
  assert.match(invoices,/Pendiente(?:s)? de pago/);
  assert.match(invoices,/className="paymentActions"/);
  assert.match(invoices,/title="Por pagar"/);
  assert.match(invoices,/title="Pagada"/);
  assert.match(filters,/Filtrar por estado de pago/);
  assert.match(filters,/Por pagar/);
  assert.match(filters,/Pagadas/);
  assert.match(service,/filter\.paymentStatus/);
  assert.match(service,/invoice\.paymentStatus/);
});

test('mobile expense cards proxy both accounting and payment controls',async()=>{
  const source=await read('../src/components/UnifiedListExperience.tsx');
  assert.match(source,/\.statusActions \.statusBtn/);
  assert.match(source,/\.paymentActions \.paymentBtn/);
  assert.match(source,/zenviaMobileExpenseStatus/);
  assert.match(source,/zenviaMobilePaymentStatus/);
  assert.match(source,/zenviaMobilePaymentButton/);
});

test('expense detail allows payment date and payment state changes',async()=>{
  const detail=await read('../src/components/InvoiceDetailModal.tsx');
  assert.match(detail,/Estado de pago/);
  assert.match(detail,/Fecha de pago/);
  assert.match(detail,/Marcar pagada/);
  assert.match(detail,/onPaymentStatusChange/);
});
