import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');
async function loadTs(path){const source=await read(path);const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);}
const core=()=>loadTs('../src/services/invoiceCore.ts');

// ------------------------------------------------------------------------------------------
// Independent synthetic multiple-reading example. No operational source document.
// ------------------------------------------------------------------------------------------
const SYNTH_HEADER={supplierName:'Synthetic Supplier Multiple',supplierTaxId:'SYNTH-TAX-A',invoiceNumber:'SYNTHETIC-MULTI-01',invoiceDate:'2031-02-03',subtotal:3191,vat:670.11,total:3861.11};
const L=(description,quantity,unitPrice,extra={})=>({description,quantity,unitPrice,lineNet:Math.round(quantity*unitPrice*100)/100,taxRate:21,...extra});
const SYNTH_PDF=[
  L('Synthetic item alpha',11,3,{supplierSku:'SYNTHETIC-SKU-A',verified:true}),
  L('Synthetic item beta',13,5,{supplierSku:'SYNTHETIC-SKU-B',verified:true}),
  L('Synthetic item gamma 72 4 KG',17,7,{supplierSku:'SYNTHETIC-SKU-C',verified:true}),
  L('Synthetic item delta',19,11,{supplierSku:'SYNTHETIC-SKU-D',verified:true}),
  L('Synthetic item repeated',23,13,{supplierSku:'SYNTHETIC-SKU-REPEAT',verified:false}),
  L('Synthetic item epsilon',29,17,{supplierSku:'SYNTHETIC-SKU-E',verified:true}),
  L('Synthetic item zeta',31,19,{supplierSku:'SYNTHETIC-SKU-F',verified:true}),
  L('Synthetic item eta',37,23,{supplierSku:'SYNTHETIC-SKU-G',verified:true}),
  L('Synthetic item repeated',41,13,{supplierSku:'SYNTHETIC-SKU-REPEAT',verified:false}),
];
const SYNTH_OCR=SYNTH_PDF.filter(line=>line.supplierSku!=='SYNTHETIC-SKU-REPEAT').map(line=>({...line,verified:undefined,description:line.description.replace('72 4 KG','724 KG')}));

test('Sintético multifuente · texto + OCR del mismo PDF cuentan una vez y las láminas no se pierden',async()=>{
  const {checkInvoiceIntegrity}=await core();
  const result=checkInvoiceIntegrity({header:SYNTH_HEADER,sources:[{kind:'ai',lines:SYNTH_PDF},{kind:'ocr',lines:SYNTH_OCR}],requireLines:true});
  assert.equal(result.lines.length,9);
  assert.equal(result.totals.linesNet,3191);
  assert.equal(result.totals.difference,0);
  const laminas=result.lines.filter(line=>line.supplierSku==='SYNTHETIC-SKU-REPEAT');
  assert.equal(laminas.length,2,'las 2 líneas no verificadas se conservan');
  assert.ok(laminas.every(line=>line.status==='review'));
  assert.equal(result.status,'needs_review','hay líneas no verificadas: no se confirma sola');
  assert.equal(result.autoConfirmAllowed,false);
});

test('Sintético multifuente · las 14 líneas de una lectura duplicada quedan bloqueadas con la sugerencia exacta',async()=>{
  const {checkInvoiceIntegrity}=await core();
  const stored=[...SYNTH_OCR,...SYNTH_PDF.filter(line=>line.supplierSku!=='SYNTHETIC-SKU-REPEAT')].map(line=>({...line,taxRate:null}));
  const result=checkInvoiceIntegrity({header:SYNTH_HEADER,sources:[{kind:'ai',lines:stored}],requireLines:true});
  assert.equal(result.lines.length,14,'no se elimina nada en silencio');
  assert.equal(result.totals.linesNet,4718);
  assert.equal(result.status,'needs_review');
  assert.ok(result.issues.some(issue=>issue.code==='LINES_NOT_MATCH_SUBTOTAL'));
  assert.ok(result.issues.some(issue=>issue.code==='POSSIBLE_DUPLICATE_LINES'&&issue.severity==='warning'));
  assert.match(result.issues.find(issue=>issue.code==='SUGGESTION').message,/faltarían 832\.00/);
});

test('Líneas idénticas legítimas con totales que cuadran se conservan sin bloquear',async()=>{
  const {checkInvoiceIntegrity}=await core();
  const lines=[L('Producto A',2,25),L('Producto A',2,25)];
  const result=checkInvoiceIntegrity({header:{supplierName:'X',invoiceNumber:'1',invoiceDate:'2031-10-01',subtotal:100,vat:21,total:121},sources:[{kind:'ai',lines},{kind:'text_layer',lines}]});
  assert.equal(result.lines.length,2);
  assert.equal(result.status,'ready');
  assert.ok(result.issues.some(issue=>issue.code==='POSSIBLE_DUPLICATE_LINES'&&issue.severity==='info'));
});

test('Sintético sin líneas (Gmail) · mercancía sin líneas ya no se contabiliza sola',async()=>{
  const {checkInvoiceIntegrity}=await core();
  const result=checkInvoiceIntegrity({header:{supplierName:'Synthetic Supplier Missing',invoiceNumber:'SYNTHETIC-MISSING-01',invoiceDate:'2031-03-04',subtotal:613.27,vat:128.79,total:742.06},sources:[{kind:'ocr',lines:[]}],requireLines:true});
  assert.equal(result.status,'needs_review');
  assert.ok(result.issues.some(issue=>issue.code==='MISSING_LINES'));
});

test('Gasto de servicios sin líneas (p. ej. proveedor cloud) sigue entrando sin revisión',async()=>{
  const {checkInvoiceIntegrity}=await core();
  const result=checkInvoiceIntegrity({header:{supplierName:'Synthetic Supplier Service',invoiceNumber:'SYNTHETIC-SERVICE-01',invoiceDate:'2031-04-05',subtotal:27.43,vat:0,total:27.43},sources:[{kind:'text_layer',lines:[]}],requireLines:false});
  assert.equal(result.status,'ready');
});

test('Valores imposibles (código leído como cantidad) se marcan en vez de romper el guardado',async()=>{
  const {checkInvoiceIntegrity,implausibleLineValues}=await core();
  const line={description:'Synthetic item units 240U R/8 C/9',quantity:98765432109,unitPrice:7.13,lineNet:192.51,taxRate:21};
  assert.deepEqual(implausibleLineValues(line),['cantidad']);
  const result=checkInvoiceIntegrity({header:{supplierName:'Synthetic Supplier Units',invoiceNumber:'SYNTHETIC-OVERFLOW-01',invoiceDate:'2031-06-01',subtotal:192.51,vat:40.43,total:232.94},sources:[{kind:'ocr',lines:[line]}],requireLines:true});
  assert.equal(result.status,'needs_review');
  assert.match(result.lines[0].blocking.join(' '),/Valor imposible en cantidad/);
});

test('Precio por retráctil sin factor confirmado: la línea no actualiza costes pero la factura no se bloquea',async()=>{
  const {checkInvoiceIntegrity,parseInvoiceUnits}=await core();
  const line={description:'Synthetic item units 240U R/8 C/9',supplierSku:'098765432109',quantity:27,unit:'Retractil',unitPrice:7.13,lineNet:192.51,taxRate:21};
  const units=parseInvoiceUnits(line.description,line.unit);
  assert.equal(units.invoiceUnit,'retractil');
  assert.equal(units.perPack.retractil,8);
  assert.equal(units.innerQty,240);
  const result=checkInvoiceIntegrity({header:{supplierName:'Synthetic Supplier Units',invoiceNumber:'SYNTHETIC-UNITS-01',invoiceDate:'2031-08-21',subtotal:192.51,vat:40.43,total:232.94},sources:[{kind:'ai',lines:[line]}],requireLines:true});
  assert.equal(result.status,'ready');
  assert.match(result.lines[0].priceReview.join(' '),/retractil/);
});

test('Importación repetida: mismo archivo, o mismo proveedor + número aunque cambie el formato',async()=>{
  const {checkInvoiceIntegrity}=await core();
  const base={header:SYNTH_HEADER,sources:[{kind:'text_layer',lines:SYNTH_PDF}],fileHash:'abc'};
  assert.equal(checkInvoiceIntegrity({...base,priorImports:[{invoiceId:'inv-1',fileHash:'abc'}]}).status,'duplicate');
  const byNumber=checkInvoiceIntegrity({...base,fileHash:'otro',priorImports:[{invoiceId:'inv-1',supplierTaxId:'SYNTH - TAX - A',invoiceNumber:'SYNTHETIC - MULTI - 01'}]});
  assert.equal(byNumber.duplicateOf,'inv-1');
});

test('Cabecera incoherente (IVA o total) bloquea la confirmación',async()=>{
  const {checkInvoiceIntegrity}=await core();
  const verified=SYNTH_PDF.map(line=>({...line,verified:true}));
  const result=checkInvoiceIntegrity({header:{...SYNTH_HEADER,vat:1100},sources:[{kind:'text_layer',lines:verified}]});
  assert.ok(result.issues.some(issue=>issue.code==='HEADER_TOTAL_MISMATCH'));
  assert.ok(result.issues.some(issue=>issue.code==='VAT_MISMATCH'));
  assert.equal(result.status,'needs_review');
});

test('Factura completa y coherente: única situación en que se permite confirmar automáticamente',async()=>{
  const {checkInvoiceIntegrity}=await core();
  const verified=SYNTH_PDF.map(line=>({...line,verified:true}));
  const result=checkInvoiceIntegrity({header:SYNTH_HEADER,sources:[{kind:'text_layer',lines:verified}],requireLines:true});
  assert.equal(result.status,'ready');
  assert.equal(result.autoConfirmAllowed,true);
});

test('Redondeos al céntimo dentro de la tolerancia justificada',async()=>{
  const {checkInvoiceIntegrity,invoiceAmountTolerance}=await core();
  const lines=[L('A',3,0.333),L('B',3,0.333),L('C',3,0.333)].map(line=>({...line,lineNet:1}));
  assert.equal(invoiceAmountTolerance(3),0.03);
  const result=checkInvoiceIntegrity({header:{supplierName:'X',invoiceNumber:'9',invoiceDate:'2031-10-01',subtotal:2.99,vat:0.63,total:3.62},sources:[{kind:'ai',lines}]});
  assert.ok(!result.issues.some(issue=>issue.code==='LINES_NOT_MATCH_SUBTOTAL'));
});

test('Cantidad × precio que no cuadra: bloquea si la factura no cuadra; si cuadra, solo excluye la línea de costes',async()=>{
  const {checkInvoiceIntegrity}=await core();
  const lines=[{description:'A',quantity:10,unitPrice:4,lineNet:50,taxRate:21},{description:'B',quantity:1,unitPrice:10,lineNet:10,taxRate:21}];
  const broken=checkInvoiceIntegrity({header:{supplierName:'X',invoiceNumber:'9',invoiceDate:'2031-10-01',subtotal:70,vat:14.7,total:84.7},sources:[{kind:'ai',lines}]});
  assert.equal(broken.status,'needs_review');
  assert.match(broken.lines[0].blocking.join(' '),/no coincide/);
  const reconciled=checkInvoiceIntegrity({header:{supplierName:'X',invoiceNumber:'9',invoiceDate:'2031-10-01',subtotal:60,vat:12.6,total:72.6},sources:[{kind:'ai',lines}]});
  assert.equal(reconciled.status,'ready');
  assert.match(reconciled.lines[0].priceReview.join(' '),/no coincide/);
});

test('Regresión Sintético precio con IVA · precio impreso con IVA: la factura cuadra y la línea no alimenta costes',async()=>{
  const {checkInvoiceIntegrity}=await core();
  const line={description:'Synthetic item gross price',quantity:240,unit:'ud',unitPrice:8.47,lineNet:1680,taxRate:21};
  const result=checkInvoiceIntegrity({header:{supplierName:'Synthetic Supplier Gross',invoiceNumber:'SYNTHETIC-GROSS-01',invoiceDate:'2031-09-01',subtotal:1680,vat:352.8,total:2032.8},sources:[{kind:'ai',lines:[line]}],requireLines:true});
  assert.equal(result.status,'ready');
  assert.match(result.lines[0].priceReview.join(' '),/incluir IVA/);
});

test('Regresión Sintético retención · retención guardada con signo negativo no se toma como descuadre',async()=>{
  const {checkInvoiceIntegrity}=await core();
  const result=checkInvoiceIntegrity({header:{supplierName:'Synthetic Supplier Withholding',invoiceNumber:'SYNTHETIC-WITHHOLD-01',invoiceDate:'2031-09-01',subtotal:137,vat:28.77,withholding:-20.55,total:145.22},sources:[{kind:'manual',lines:[]}]});
  assert.ok(!result.issues.some(issue=>issue.code==='HEADER_TOTAL_MISMATCH'));
});

test('Descuentos y portes como líneas de ajuste: importes negativos permitidos y factura cuadrada',async()=>{
  const {checkInvoiceIntegrity}=await core();
  const lines=[L('Synthetic item discount',23,9),{description:'DTO. PRONTO PAGO 2%',quantity:1,unitPrice:-4.14,lineNet:-4.14,taxRate:21},{description:'PORTES',quantity:1,unitPrice:13,lineNet:13,taxRate:21}];
  const result=checkInvoiceIntegrity({header:{supplierName:'X',invoiceNumber:'10',invoiceDate:'2031-10-01',subtotal:215.86,vat:45.33,total:261.19},sources:[{kind:'ai',lines}],requireLines:true});
  assert.equal(result.status,'ready');
  assert.ok(result.lines[1].adjustment&&result.lines[2].adjustment);
});

test('Una diferencia explicada por un descuento del documento se explica, pero no se da por buena',async()=>{
  const {checkInvoiceIntegrity}=await core();
  const lines=[L('Synthetic item discount',23,9)];
  const text='Synthetic item discount  23  9,00  207,00\nDescuento comercial 3%   6,21\nBase imponible 200,79';
  const result=checkInvoiceIntegrity({header:{supplierName:'X',invoiceNumber:'11',invoiceDate:'2031-10-01',subtotal:200.79,vat:42.17,total:242.96},sources:[{kind:'ai',lines}],documentText:text,requireLines:true});
  assert.equal(result.status,'needs_review');
  assert.match(result.explanation||'',/descuento de 6\.21/);
});

test('La conciliación de fuentes nunca suma líneas de dos lecturas del mismo documento',async()=>{
  const {reconcileInvoiceSources}=await core();
  const {lines,collapsed}=reconcileInvoiceSources([{kind:'text_layer',lines:SYNTH_PDF},{kind:'ocr',lines:SYNTH_OCR},{kind:'ai',lines:SYNTH_PDF}]);
  assert.equal(lines.length,9);
  assert.equal(collapsed,9+7+9-9);
});

// ------------------------------------------------------------------------------------------
// Integración en el código real: todos los canales pasan por el motor.
// ------------------------------------------------------------------------------------------
test('El importador común (subida, masiva, Gmail, reproceso) usa el motor de integridad',async()=>{
  const source=await read('../src/services/invoiceImportPipeline.ts');
  assert.match(source,/import \{ checkInvoiceIntegrity, invoiceIntegritySummary, invoiceReviewReasons \} from '\.\/invoiceCore'/);
  assert.match(source,/const integrityCheck=checkInvoiceIntegrity\(/);
  assert.match(source,/if\(integrityCheck\.status!=='ready'\)\{\s*status='needs_review'/);
  assert.match(source,/integrityCheck:candidate\.integrityCheck\?\?null/);
  assert.doesNotMatch(source,/comprueba si faltan artículos/,'el control parcial anterior queda sustituido');
});

test('createInvoice aplica la barrera final: sin integridad no hay estado contabilizado, costes ni historial',async()=>{
  const source=await read('../src/services/repository.ts');
  assert.match(source,/const integrity=checkInvoiceIntegrity\(/);
  assert.match(source,/const initialStatus=integrityReady\?policy\.initialStatus:'pending'/);
  assert.match(source,/status: initialStatus,/);
  assert.match(source,/const updateImportedCost = integrityReady &&/);
  assert.match(source,/const writePriceHistory = integrityReady &&/);
  assert.match(source,/integrityCheck: invoiceIntegritySummary\(integrity/);
  assert.match(source,/if\(policy\.detectDuplicates&&sanitizeDatabaseSingleLine\(input\.invoiceNumber\)\)\{/,'proveedor + número se comprueba en todos los canales');
  assert.match(source,/unit_price: safeNumber\(line\.unitPrice, INVOICE_LINE_LIMITS\.unitPrice\)/);
});

test('La IA ya no descarta en silencio las líneas no verificadas',async()=>{
  const source=await read('../src/services/invoiceIntelligence.ts');
  assert.doesNotMatch(source,/\.filter\(line=>line\?\.verified&&/);
  assert.match(source,/verified:line\?\.verified===true/);
});
