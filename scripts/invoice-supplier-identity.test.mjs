import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadTs(path){
  const source=await readFile(new URL(path,import.meta.url),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

test('rejects postal/location OCR lines as supplier names',async()=>{
  const {isPlausibleSupplierName}=await loadTs('../src/services/supplierIdentity.ts');
  assert.equal(isPlausibleSupplierName('11660 PRADO DEL REY'),false);
  assert.equal(isPlausibleSupplierName('P.I. LA VENTILLA, NAVE 44'),false);
  assert.equal(isPlausibleSupplierName('Sierra Nevada Compost and Paper S.L.'),true);
});

test('matches OCR-corrupted supplier names without merging similarly named companies',async()=>{
  const {isLikelySameSupplier}=await loadTs('../src/services/supplierIdentity.ts');
  assert.equal(isLikelySameSupplier('Siera Nevada Compost ana Paper','Sierra Nevada Compost and Paper S.L.'),true);
  assert.equal(isLikelySameSupplier('Compost and Paper S.L','Sierra Nevada Compost and Paper S.L.'),true);
  assert.equal(isLikelySameSupplier('Cash Sierra Nevada S.L','Sierra Nevada Compost and Paper S.L.'),false);
});

test('missing supplier name goes to review and VAT precedes fuzzy matching',async()=>{
const sql=await readFile(new URL('../supabase/migrations/20261002190000_invoice_engine.sql',import.meta.url),'utf8');assert.match(sql,/invoice_engine_tax_key\(tax_id\)=tax/);assert.match(sql,/invoice_engine_name_similarity/);assert.match(sql,/Coincidencia ambigua/);const {validateDocument}=await import('../shared/invoiceEngineCore.mjs');assert.equal(validateDocument({supplier:{name:''},lines:[],taxes:[],confidence:{}}).status,'needs_review');
});
