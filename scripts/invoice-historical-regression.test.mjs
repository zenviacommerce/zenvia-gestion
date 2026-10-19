import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// Regresión de 82 escenarios sintéticos independientes; ningún registro procede de operaciones.
const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');
async function loadTs(path){const source=await read(path);const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);}
const fixture=async()=>JSON.parse(await read('./fixtures/historical-expense-invoices-2026-10.json'));
async function checkAll(){
  const {checkStoredInvoice,storedInvoiceRequiresLines}=await loadTs('../src/services/invoiceCore.ts');
  return (await fixture()).map(invoice=>({invoice,result:checkStoredInvoice(invoice,{merchandise:storedInvoiceRequiresLines(invoice.category,invoice.supplier_type)})}));
}

test('sintético · el fixture contiene las 82 facturas: 28 incidencias abiertas (14 altas, 5 medias, 9 bajas) y un escenario conciliado',async()=>{
  const data=await fixture();
  assert.equal(data.length,82);
  const bySeverity=data.reduce((acc,invoice)=>{if(invoice.incidentSeverity)acc[invoice.incidentSeverity]=(acc[invoice.incidentSeverity]||0)+1;return acc;},{});
  assert.deepEqual(bySeverity,{Alta:14,Media:5,Baja:9});
  assert.equal(data.filter(invoice=>invoice.resolvedIncident).length,1);
});

test('sintético · las 28 incidencias quedan marcadas para revisión, cada una con motivo',async()=>{
  const missed=(await checkAll()).filter(({invoice,result})=>invoice.incidentSeverity&&(result.status==='ready'||!result.reasons.length));
  assert.deepEqual(missed.map(({invoice})=>`${invoice.supplier} ${invoice.number}`),[]);
});

test('sintético · las facturas correctas no se bloquean (sin falsos positivos)',async()=>{
  const blocked=(await checkAll()).filter(({invoice,result})=>!invoice.incidentSeverity&&invoice.scenario!=='missing-goods'&&result.status!=='ready');
  assert.deepEqual(blocked.map(({invoice,result})=>`${invoice.supplier} ${invoice.number}: ${result.reasons.join(' | ')}`),[]);
});

test('sintético · los servicios sin líneas no se tratan como errores de mercancía',async()=>{
  const rows=(await checkAll()).filter(({invoice})=>invoice.scenario==='service-in-goods-category');
  assert.equal(rows.length,7);
  for(const {invoice,result} of rows){
    assert.equal(invoice.supplier_type,'service');
    assert.equal(invoice.lines.length,0);
    assert.equal(result.status,'ready',`${invoice.supplier} ${invoice.number}`);
  }
});

test('sintético · una factura de proveedor de mercancía sin líneas sigue pidiendo revisión',async()=>{
  const rows=(await checkAll()).filter(({invoice})=>invoice.scenario==='missing-goods');
  assert.equal(rows.length,1);
  assert.ok(rows[0].result.issues.some(issue=>issue.code==='MISSING_LINES'));
});

test('sintético · las cabeceras guardadas sin líneas por desbordamiento se detectan aunque no sean mercancía',async()=>{
  const rows=(await checkAll()).filter(({invoice})=>invoice.lineImportWarning);
  assert.equal(rows.length,7);
  for(const {result} of rows){
    assert.equal(result.status,'needs_review');
    assert.equal(result.issues[0].code,'LINES_NOT_SAVED');
  }
});

test('sintético · escenario de nueve líneas conciliadas',async()=>{
  const row=(await checkAll()).find(({invoice})=>invoice.scenario==='reconciled-nine-lines');
  assert.equal(row.invoice.lines.length,9);
  assert.equal(row.result.totals.linesNet,1057.11);
  assert.equal(row.result.totals.difference,0);
  assert.equal(row.invoice.vat,221.99);
  assert.equal(row.invoice.total,1279.10);
  assert.ok(!row.result.issues.some(issue=>issue.severity==='error'),row.result.reasons.join(' | '));
  assert.ok(!row.result.issues.some(issue=>issue.code==='POSSIBLE_DUPLICATE_LINES'));
});

test('sintético · las 28 incidencias mantienen todas las familias de fallo y las expectativas por caso',async()=>{
  const counts={};
  for(const {invoice,result} of await checkAll()){
    if(!invoice.incidentSeverity)continue;
    counts[invoice.scenario]=(counts[invoice.scenario]??0)+1;
    const codes=result.issues.map(issue=>issue.code);
    assert.equal(result.status,'needs_review',invoice.id8);
    if(invoice.scenario.startsWith('lost-'))assert.ok(codes.includes('LINES_NOT_SAVED'),invoice.id8);
    else assert.ok(codes.includes('LINES_NOT_MATCH_SUBTOTAL'),invoice.id8);
    if(invoice.scenario==='lost-goods')assert.ok(codes.includes('MISSING_LINES'),invoice.id8);
    if(invoice.scenario==='subtotal-and-price-mismatch')assert.ok(codes.includes('LINE_REVIEW'),invoice.id8);
    if(invoice.scenario==='duplicate-mismatch')assert.ok(codes.includes('POSSIBLE_DUPLICATE_LINES'),invoice.id8);
  }
  assert.deepEqual(counts,{'duplicate-mismatch':1,'subtotal-mismatch':16,'subtotal-and-price-mismatch':4,'lost-goods':5,'lost-service':2});
});

test('sintético · recargo de equivalencia, IVA cero y retención conservan la aritmética fiscal',async()=>{
  const rows=await checkAll();
  const surcharge=rows.filter(({invoice})=>invoice.equivalenceSurcharge>0);
  assert.equal(surcharge.length,8);
  assert.equal(rows.filter(({invoice})=>invoice.vat===0).length,30);
  const {checkStoredInvoice}=await loadTs('../src/services/invoiceCore.ts');
  for(const {invoice,result} of surcharge){
    assert.equal(result.status,'ready',invoice.id8);
    const broken={...invoice,total:Math.round((invoice.subtotal+invoice.vat)*100)/100};
    assert.ok(checkStoredInvoice(broken,{merchandise:true}).issues.some(issue=>issue.code==='HEADER_TOTAL_MISMATCH'));
  }
});

test('sintético · los importes de líneas se suman al céntimo en todas las facturas',async()=>{
  for(const {invoice,result} of await checkAll()){
    const expected=Math.round(invoice.lines.reduce((sum,line)=>sum+(Number.isFinite(line.lineNet)?line.lineNet:0),0)*100)/100;
    assert.equal(result.totals.linesNet,expected,`${invoice.supplier} ${invoice.number}`);
  }
});

test('sintético · la revisión es de solo lectura: no altera los datos de entrada',async()=>{
  const {checkStoredInvoice}=await loadTs('../src/services/invoiceCore.ts');
  const data=await fixture();
  const before=JSON.stringify(data);
  for(const invoice of data)checkStoredInvoice(invoice,{merchandise:true});
  assert.equal(JSON.stringify(data),before);
});

test('UI · el detalle de factura muestra el aviso de descuadre y el repositorio carga lo necesario',async()=>{
  const modal=await read('../src/components/InvoiceDetailModal.tsx');
  assert.match(modal,/checkStoredInvoice\(/);
  assert.match(modal,/data-testid="invoice-integrity-warning"/);
  assert.match(modal,/no cuadra y debe revisarse/);
  const repository=await read('../src/services/repository.ts');
  assert.match(repository,/line_net,tax_rate,line_total/);
  assert.match(repository,/line_import_warning:extraction->>lineImportWarning/);
});

test('Gmail · si las líneas fallan, se guardan en extraction.unsavedLines y la factura queda pendiente',async()=>{
  const gmail=await read('../src/services/gmailImport.ts');
  assert.match(gmail,/unsavedLines:prepared\.lines\.map/);
  const repository=await read('../src/services/repository.ts');
  assert.match(repository,/const forcedReview=Boolean\(input\.extraction&&/);
  assert.match(repository,/const integrityReady=integrity\.status==='ready'&&!forcedReview;/);
});

test('reparación de líneas · no descarta artículos reales con descripción numérica ni corta en 50 líneas',async()=>{
  const source=await read('../src/services/invoiceProductLine.ts');
  assert.match(source,/isLikelyProductDescription\(line\.description\)\|\|hasConsistentLineAmounts\(line\)/);
  assert.match(source,/MAX_INVOICE_PRODUCT_LINES=400/);
  assert.doesNotMatch(source,/slice\(0,50\)/);
});

test('motor · cantidad × precio exacto no se marca como precio con IVA (1000 × 0,02 = 20,00)',async()=>{
  const {checkInvoiceIntegrity}=await loadTs('../src/services/invoiceCore.ts');
  const result=checkInvoiceIntegrity({header:{subtotal:20,vat:4.2,total:24.2},sources:[{kind:'ai',lines:[{description:'Synthetic item decimal-price',quantity:1000,unit:'ud',unitPrice:0.02,lineNet:20,taxRate:21}]}]});
  assert.equal(result.status,'ready');
  assert.deepEqual(result.lines[0].priceReview,[]);
});

test('guardado · un proveedor clasificado como servicio no exige líneas de mercancía (tipo leído antes de ajustarlo)',async()=>{
  const repository=await read('../src/services/repository.ts');
  assert.match(repository,/observed\.knownType=\(match\.supplier_type as string\|null\)\?\?null;/);
  assert.match(repository,/requireLines:merchandiseSupplier&&observedSupplier\.knownType!=='service'/);
  const modal=await read('../src/components/InvoiceDetailModal.tsx');
  assert.match(modal,/storedInvoiceRequiresLines\(invoice\.category,suppliers\.find/);
});
