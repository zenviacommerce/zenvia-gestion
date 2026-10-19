import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {serializeSyntheticInvoices} from './generate-synthetic-invoice-fixtures.mjs';

test('privacy: fixture contains only generated scenario identities and no imported identifiers',async()=>{
  const rows=JSON.parse(await readFile(new URL('./fixtures/historical-expense-invoices-2026-10.json',import.meta.url),'utf8'));
  assert.equal(rows.length,82);
  for(const row of rows){
    assert.match(row.id8,/^SYNTHETIC-SCENARIO-\d{3}$/);
    assert.match(row.number,/^SYNTHETIC-INVOICE-\d{3}$/);
    assert.match(row.supplier,/^Synthetic Supplier \d{3}$/);
    for(const line of row.lines){
      assert.match(line.description,/^(Synthetic (item|numeric)|DTO\. SYNTHETIC|PORTES SYNTHETIC)/);
      if(line.supplierSku)assert.match(line.supplierSku,/^SYNTHETIC-SKU-/);
    }
  }
});

test('privacy: committed fixture is exactly reproducible without any operational input',async()=>{
  const text=await readFile(new URL('./fixtures/historical-expense-invoices-2026-10.json',import.meta.url),'utf8');
  assert.equal(text,serializeSyntheticInvoices());
  const rows=JSON.parse(text);
  assert.equal(new Set(rows.map(row=>row.id8)).size,82);
  assert.equal(new Set(rows.map(row=>row.number)).size,82);
  assert.equal(new Set(rows.map(row=>row.supplier)).size,82);
  for(const row of rows){
    assert.deepEqual(Object.keys(row).filter(key=>/email|address|phone|token|password|taxid/i.test(key)),[]);
  }
});
