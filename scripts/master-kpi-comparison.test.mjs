import {test} from 'node:test';
import assert from 'node:assert/strict';
import {masterKpiTexts} from './master-kpi-comparison.mjs';
test('approved Products wording preserves strict comparison of values and periods',()=>{
 const before=[{text:'Productos visibles 32 Este mes'},{text:'Con precio de venta 24 de 32 visibles'},{text:'Coste medio 10,00 € Este mes'}];
 const after=[{text:'Productos en periodo 32 Este mes'},{text:'Con precio de venta 24 de 32 en el periodo'},{text:'Coste medio 10,00 € Este mes'}];
 assert.deepEqual(masterKpiTexts('products',before),masterKpiTexts('products',after));
 assert.notDeepEqual(masterKpiTexts('products',before),masterKpiTexts('products',[...after.slice(0,2),{text:'Coste medio 11,00 € Este mes'}]));
 assert.notDeepEqual(masterKpiTexts('products',before),masterKpiTexts('products',[{text:'Productos en periodo 31 Este mes'},...after.slice(1)]));
 assert.notDeepEqual(masterKpiTexts('clients',before),masterKpiTexts('clients',after));
});
