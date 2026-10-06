import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');
async function loadTs(path){const source=await read(path);const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);}

test('strong merchandise evidence wins over generic transport wording',async()=>{
  const source=await read('../src/services/invoiceReaderEnhanced.ts');
  assert.match(source,/const merchandiseCategoryId\s*=\s*detectMerchandiseCategory\(categories,\s*base\.text,\s*invoiceLines\)/);
  assert.match(source,/const serviceCategoryId\s*=\s*merchandiseCategoryId\s*\?\s*undefined\s*:\s*serviceCategoryByContent\(categories,\s*base\.text\)/);
  assert.match(source,/const categoryId\s*=\s*merchandiseCategoryId\s*\|\|\s*serviceCategoryId\s*\|\|\s*base\.categoryId/);
});

test('expense invoice page exposes period-aware KPI cards',async()=>{
  const source=await read('../src/pages/Invoices.tsx');
  assert.match(source,/import \{ StatCard \} from ['"]\.\.\/components\/StatCard['"]/);
  for(const label of ['Gasto total','IVA soportado','Nº de facturas','Pendientes de revisar','Ticket medio','Proveedores distintos']){
    assert.match(source,new RegExp(`label=["']${label}["']`));
  }
  assert.match(source,/className=["']stats expenseStats["']/);
});


test('matches a safe abbreviated supplier name against its full legal name',async()=>{
  const {isLikelySameSupplier}=await loadTs('../src/services/supplierIdentity.ts');
  assert.equal(isLikelySameSupplier('Compost and Paper S.L','Sierra Nevada Compost and Paper S.L.'),true);
  assert.equal(isLikelySameSupplier('Paper S.L','Sierra Nevada Compost and Paper S.L.'),false);
  assert.equal(isLikelySameSupplier('Compost Solutions S.L','Sierra Nevada Compost and Paper S.L.'),false);
});

test('expense duplicate detection uses shared supplier identity matching',async()=>{
const {fingerprint}=await import('../shared/invoiceEngineCore.mjs');const d={supplier:{name:'Prueba SL',taxId:'ES B-12345674'},number:'F-001',issueDate:'2026-09-20',total:121};assert.equal(fingerprint(d),fingerprint({...d,supplier:{name:'Otro texto OCR',taxId:'B12345674'}}));assert.notEqual(fingerprint(d),fingerprint({...d,total:122}));
});

test('supplier contact extraction tolerates OCR variants of CIF',async()=>{
  const source=await read('../src/services/supplierContactExtractor.ts');
  assert.match(source,/c\\\.\?\\s\*\[il1\]/i);
});
