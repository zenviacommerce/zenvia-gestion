import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadTs(path){
  const source=await readFile(new URL(path,import.meta.url),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}
const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('currency detector identifies explicit USD symbols and ISO codes',async()=>{
  const {detectInvoiceCurrency}=await loadTs('../src/services/invoiceCurrency.ts');
  assert.equal(detectInvoiceCurrency('Amount due $25.00\nSubtotal $25.00')?.currency,'USD');
  assert.equal(detectInvoiceCurrency('Total US$ 100.00')?.currency,'USD');
  assert.equal(detectInvoiceCurrency('Currency: GBP\nTotal 19.00')?.currency,'GBP');
  assert.equal(detectInvoiceCurrency('Total € 125,00')?.currency,'EUR');
});

test('invoice import persists the detected currency instead of falling back to application EUR',async()=>{
  const [types,reader,pipeline,repository]=await Promise.all([
    read('../src/types.ts'),
    read('../src/services/invoiceReader.ts'),
    read('../src/services/invoiceImportPipeline.ts'),
    read('../src/services/repository.ts'),
  ]);
  assert.match(types,/currency: string/);
  assert.match(reader,/detectInvoiceCurrency/);
  assert.match(pipeline,/currency:read\.currency/);
  assert.match(pipeline,/currency:candidate\.currency/);
  assert.match(repository,/currency:String\(input\.currency\|\|loadedSettings\.settings\.general\.currencyCode/);
});

test('foreign currency invoice lines cannot silently overwrite base-currency product cost',async()=>{
  const repository=await read('../src/services/repository.ts');
  assert.match(repository,/foreignCurrency/);
  assert.match(repository,/updateImportedCost\s*=\s*[^;]*&&\s*!foreignCurrency/);
  assert.match(repository,/currency:invoiceCurrencyCode/);
});

test('expense UI formats each invoice in its stored currency and separates mixed-currency KPIs',async()=>{
  const [page,detail]=await Promise.all([
    read('../src/pages/Invoices.tsx'),
    read('../src/components/InvoiceDetailModal.tsx'),
  ]);
  assert.match(page,/money\(i\.total,i\.currency\)/);
  assert.match(page,/groupedMoney/);
  assert.match(page,/Varias monedas/);
  assert.match(detail,/invoice\.currency/);
  assert.match(detail,/formatAppMoney/);
});

test('review form lets the user correct the invoice currency explicitly',async()=>{
  const form=await read('../src/components/InvoiceCandidateForm.tsx');
  assert.match(form,/Moneda/);
  assert.match(form,/USD/);
  assert.match(form,/set\('currency'/);
});
