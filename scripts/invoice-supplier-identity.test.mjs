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

test('persistence can still resolve an invalid OCR name by an exact tax id but will not create it',async()=>{
  const repository=await readFile(new URL('../src/services/repository.ts',import.meta.url),'utf8');
  assert.match(repository,/const plausibleName=isPlausibleSupplierName\(clean\)/);
  assert.match(repository,/contact\.taxId && existingTaxId && contact\.taxId === existingTaxId/);
  assert.match(repository,/supplierSettings\.detectDuplicates && plausibleName && cleanKey/);
  assert.match(repository,/if\(!plausibleName\)\{/);
  assert.match(repository,/no parece una razón social válida/);
});
