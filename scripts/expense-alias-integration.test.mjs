import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('expense supplier resolution consults explicit aliases before heuristic matching and creation',async()=>{
const source=await read('../supabase/migrations/20261002190000_invoice_engine.sql');
  const alias=source.indexOf('public.entity_alias_rules');const fuzzy=source.indexOf('select count(*) into matches from public.suppliers');assert.ok(alias>0&&fuzzy>alias);assert.match(source,/sp.owner_id=o/);assert.match(source,/target_entity_id/);
});

test('Gmail delegates supplier aliases and duplicate resolution to the common engine',async()=>{
const source=await read('../src/services/gmailImport.ts');assert.match(source,/InvoiceEngine.analyze/);assert.match(source,/InvoiceEngine.save/);assert.doesNotMatch(source,/findInvoiceBySupplierAndNumber/);
});
