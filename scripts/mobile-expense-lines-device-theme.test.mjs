import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');
async function loadTs(path){
  const source=await read(path);
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

test('manual theme toggle is a device override and does not persist the global user preference',async()=>{
  const app=await read('../src/App.tsx');
  const html=await read('../index.html');
  assert.match(app,/zenvia-gestion-theme-device-override/);
  assert.match(app,/safeStorageRemove\('local',DEVICE_THEME_OVERRIDE_KEY\)/);
  assert.match(app,/safeStorageSet\('local',DEVICE_THEME_OVERRIDE_KEY,next\)/);
  assert.doesNotMatch(app,/patchPreferences\(\{theme:next\}\)/);
  assert.ok(html.indexOf('zenvia-gestion-theme-device-override')<html.indexOf('zenvia-gestion-theme-preference'));
});

test('mobile expense cards expose the real active status and quick status controls',async()=>{
  const source=await read('../src/components/UnifiedListExperience.tsx');
  assert.match(source,/\.statusActions \.statusBtn\.active/);
  assert.match(source,/zenviaMobileExpenseStatus/);
  assert.match(source,/zenviaMobileStatusButton/);
  assert.match(source,/source\.click\(\)/);
});

test('structured invoice rows tolerate OCR dashes and recover every Sierra Nevada line',async()=>{
  const {extractStructuredProductLines}=await loadTs('../src/services/invoiceReaderV2.ts');
  const rows=[
    '201425312002 — 20 BOLSA ASA42X53 AZUL G-200 REUT. 400,00KG 1.410 1,410 0,000 1,410 564,00',
    '70% REC. 1KG C/20 NEVAPLAST',
    '2014253120020 732 BOLSA ASA42X53 BLANCA G-200 640,00KG 1,410 1.410 0,000 1,410 902,40',
    'REUT. 70% REC. 1KG C/20',
    '2014253120021 -32 BOLSA ASA42X53 VERDE G-200 640,00KG 1,410 1.410 0,000 1.410 902,40',
    'REUT. 70% REC. 1KG C/20',
    '014082110052 — 5 CAÑITA FLEXIB. R-PP ENFUND 6X23 250,00 1,465 1,465 0,000 1,465 366,25',
    'COLORES PQ/100 C/50',
    '806001030100. 2 TARRINA SALSA PP TRANSPARENTE 2,00 18,130 18,130 1,340 19,470 38,94',
    '10Z/30CC PQ. 100 U C/1000 UDS',
    'Basado en Entregas 34748. 34751.',
  ];
  const lines=extractStructuredProductLines(rows);
  assert.equal(lines.length,5);
  assert.deepEqual(lines.map(line=>line.supplierSku),['201425312002','2014253120020','2014253120021','014082110052','806001030100']);
  assert.deepEqual(lines.map(line=>line.lineTotal),[564,902.4,902.4,366.25,38.94]);
  assert.equal(Number(lines.reduce((sum,line)=>sum+Number(line.lineTotal||0),0).toFixed(2)),2773.99);
});

test('structured invoice rows recover compact SKU-package OCR separators too',async()=>{
  const {extractStructuredProductLines}=await loadTs('../src/services/invoiceReaderV2.ts');
  const rows=[
    '201425312002 — 5 BOLSA ASA42X53 AZUL G-200 REUT 100,00KG 1,410 1,410 0,000 1.410 141,00',
    '70% REC. 1KG C/20 NEVAPLAST',
    '2014253120020. 5 BOLSA ASA42X53 BLANCA G-200 100,00KG 1,410 1,410 0,000 1.410 141,00',
    'REUT. 70% REC. 1KG C/20',
    '2032535300025— 15 BOLSA BLOCK 25X35+3 ESTANDAR 75,00 3,788 3,788 0,000 3,788 284,10',
    '900U C/5',
    '203304000050020-15 BOLSA BLOCK 30X40+3 ESTANDAR 75,00Paquete 5,909 5,909 0,000 5.909 443,18',
    'TRANSP. 900U C/5',
    '014082110052 5 CAÑITA FLEXIB. R-PP ENFUND 6X23 250,00 1,465 1,465 0,000 1.465 366,25',
    'COLORES PQ/100 C/50',
    'Palet europeo blanco que le sea entregado y no recogido se le facturará a 6 euros.',
  ];
  const lines=extractStructuredProductLines(rows);
  assert.equal(lines.length,5);
  assert.deepEqual(lines.map(line=>line.supplierSku),['201425312002','2014253120020','2032535300025','203304000050020','014082110052']);
  assert.equal(Number(lines.reduce((sum,line)=>sum+Number(line.lineTotal||0),0).toFixed(2)),1375.53);
  assert.ok(!lines.at(-1)?.description.toLowerCase().includes('palet europeo'));
});
