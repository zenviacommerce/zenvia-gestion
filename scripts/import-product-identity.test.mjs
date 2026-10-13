import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const path='src/services/importProductIdentity.ts';
function identity(){
 assert.ok(fs.existsSync(path),'The shared importer product identity matcher is missing');
 const code=stripTypeScriptTypes(fs.readFileSync(path,'utf8').replaceAll('export ',''));
 return vm.runInNewContext(code+'\n({normalizeImportedProductName,matchImportedSupplierProduct})',{Error});
}
test('punctuation around packaging quantities does not create a distinct product',()=>{
 const {normalizeImportedProductName:n}=identity();
 assert.equal(n('CAÑITA RECTA RPP 8X18 NEGRA PQ/100 C/50'),n('CAÑITA RECTA RPP 8X18 NEGRA PQ100 C/50'));
 assert.notEqual(n('PAJITA 8X18 PQ100'),n('PAJITA 8X18 PQ200'));
 assert.notEqual(n('PAJITA 8X18 PQ100'),n('PAJITA 8X21 PQ100'));
 assert.notEqual(n('FILM 1,5 KG'),n('FILM 15 KG'));
});
test('supplier reference wins when OCR changes the description',()=>{
 const {matchImportedSupplierProduct:match}=identity();
 const existing=[{id:'link',product_id:'existing',supplier_sku:'014082110053',supplier_description:'CAÑITA RECTA RPP 8X18 NEGRA PQ/100 C/50'}];
 assert.equal(match(existing,'description altered by OCR','014082110053').product_id,'existing');
});
test('format variants match an existing supplier product when reference is absent',()=>{
 const {matchImportedSupplierProduct:match}=identity();
 const existing=[{id:'link',product_id:'existing',supplier_sku:null,supplier_description:'CAÑITA RECTA RPP 8X18 NEGRA PQ/100 C/50'}];
 assert.equal(match(existing,'CAÑITA RECTA RPP 8X18 NEGRA PQ100 C/50',null).product_id,'existing');
 assert.equal(match(existing,'CAÑITA RECTA RPP 8X18 NEGRA PQ200 C/50',null),null);
});
test('ambiguous references require review rather than creating another product',()=>{
 const {matchImportedSupplierProduct:match}=identity();
 assert.throws(()=>match([{id:'a',product_id:'a',supplier_sku:'001',supplier_description:'A'},{id:'b',product_id:'b',supplier_sku:'001',supplier_description:'B'}],'C','001'),/referencia.*varios productos/i);
});
