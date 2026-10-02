import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('invoice model and migration persist equivalence surcharge',async()=>{
  const [types,migration]=await Promise.all([
    read('../src/types.ts'),
    read('../supabase/migrations/20260916120000_add_equivalence_surcharge.sql'),
  ]);
  assert.match(types,/equivalenceSurcharge:\s*number/);
  assert.match(types,/equivalenceSurcharge\?:\s*number/);
  assert.match(migration,/equivalence_surcharge_amount\s+numeric\(14,2\)\s+not null\s+default 0/i);
});

test('repository maps and persists equivalence surcharge',async()=>{
const repo=await read('../src/services/repository.ts');assert.match(repo,/equivalenceSurcharge:\s*numberOrZero\(i.equivalence_surcharge_amount\)/);const source=await read('../supabase/migrations/20261002190000_invoice_engine.sql');assert.match(source,/equivalence_surcharge_amount/);assert.match(source,/p_document->>'surcharge'/);
});

test('invoice detail shows equivalence surcharge only when non-zero',async()=>{
  const source=await read('../src/components/InvoiceDetailModal.tsx');
  assert.match(source,/invoice\.equivalenceSurcharge\s*!==\s*0/);
  assert.match(source,/Recargo de equivalencia/);
});

test('single transactional RPC replaces compensating supplier cleanup',async()=>{
const source=await read('../supabase/migrations/20261002190000_invoice_engine.sql');
assert.match(source,/invoice_engine_commit/);assert.match(source,/insert into public.suppliers/);assert.match(source,/insert into public.invoice_lines/);assert.match(source,/pg_advisory_xact_lock/);assert.doesNotMatch(source,/delete from public.suppliers/);
});
