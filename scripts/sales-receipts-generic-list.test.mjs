import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('receipt list uses shared sortable table filters and lateral record detail',async()=>{
  const page=await read('src/pages/SalesReceipts.tsx');
  assert.match(page,/PeriodFilterPanel/);
  assert.match(page,/SearchableSelect/);
  assert.match(page,/Filtrar recibos por país/);
  assert.match(page,/useSortableTable\('sales-receipts'/);
  assert.match(page,/SortableTableHeader/);
  assert.match(page,/RecordDetailDrawer/);
  assert.match(page,/onClick=\{\(\)=>setDetail\(receipt\)\}/);
  assert.doesNotMatch(page,/receipt\.lines\.length\} línea/,'line count must not be glued to receipt number in the list');
});

test('record detail drawer is a reusable generic component',async()=>{
  const drawer=await read('src/components/RecordDetailDrawer.tsx');
  assert.match(drawer,/recordDrawerBackdrop/);
  assert.match(drawer,/recordDrawerBody/);
  assert.match(drawer,/actions\?:ReactNode/);
});
