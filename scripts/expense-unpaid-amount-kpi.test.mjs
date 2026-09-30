import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('expense payment KPI shows the unpaid amount while keeping the unpaid invoice count as context',async()=>{
  const source=await read('src/pages/Invoices.tsx');
  assert.match(source,/const unpaidInvoices=filtered\.filter\(invoice=>invoice\.paymentStatus!=='paid'\)/);
  assert.match(source,/const unpaidAmount=groupedMoney\(unpaidInvoices,invoice=>invoice\.total\)/);
  assert.match(source,/label="Pendiente de pago"/);
  assert.match(source,/label="Pendiente de pago" value=\{unpaidAmount\}/);
  assert.match(source,/factura\$\{unpaidCount===1\?'':'s'\} por pagar/);
});
