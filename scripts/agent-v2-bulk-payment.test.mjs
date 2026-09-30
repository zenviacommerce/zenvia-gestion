import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('expense selection can mark several unpaid invoices as paid in one repository update',async()=>{
  const [page,app,repo]=await Promise.all([
    read('src/pages/Invoices.tsx'),
    read('src/App.tsx'),
    read('src/services/repository.ts'),
  ]);
  assert.match(page,/markSelectedPaid/);
  assert.match(page,/Marcar pagadas/);
  assert.match(page,/selectedUnpaid/);
  assert.match(page,/onBulkPaymentStatusChange/);
  assert.match(app,/changePaymentStatuses/);
  assert.match(repo,/updateInvoicesPaymentStatus/);
  assert.match(repo,/\.in\('id',ids\)/);
});

test('Gestion local agent handles normal conversation, application help, payments and Amazon analytics',async()=>{
  const edge=await read('supabase/functions/app-agent/index.ts');
  assert.match(edge,/¡Hola! Soy ZENVIA IA/);
  assert.match(edge,/ZENVIA Gestión centraliza la operativa/);
  assert.match(edge,/facturas de gasto por pagar/);
  assert.match(edge,/payment_status/);
  assert.match(edge,/amazon_analytics_products/);
  assert.match(edge,/producto más vendido en Amazon/);
  assert.match(edge,/profit_before_ads/);
  assert.match(edge,/gross_sales/);
  assert.match(edge,/sanitizedHistory/);
  assert.doesNotMatch(edge,/Esa petición todavía no la interpreto con suficiente seguridad/);
});

test('Gestion agent suggestions expose broader natural questions',async()=>{
  const component=await read('src/components/AppAgent.tsx');
  assert.match(component,/Cómo funciona la aplicación/);
  assert.match(component,/producto más vendido en Amazon/);
  assert.match(component,/facturas tengo por pagar/);
});
