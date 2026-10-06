import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function source(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('transport tariff schema is versioned, workspace scoped and review-gated',async()=>{
  const migration=await source('supabase/migrations/20260917162000_transport_tariffs.sql');
  for(const table of ['transport_tariff_documents','transport_tariff_services','transport_tariff_bands']){
    assert.match(migration,new RegExp(`create table(?: if not exists)? public\\.${table}`,'i'),`missing ${table}`);
  }
  for(const field of ['effective_from','effective_to','fuel_surcharge_pct','prices_include_vat','source_file_name','source_file_path','parser_provider','parser_confidence']){
    assert.match(migration,new RegExp(field,'i'),`documents must persist ${field}`);
  }
  for(const field of ['service_name','external_provider','external_service_code','mapping_status']){
    assert.match(migration,new RegExp(field,'i'),`services must persist ${field}`);
  }
  for(const field of ['country_code','zone_code','zone_name','min_weight_kg','max_weight_kg','base_price','extra_kg_price']){
    assert.match(migration,new RegExp(field,'i'),`bands must persist ${field}`);
  }
  assert.match(migration,/draft[\s\S]{0,160}reviewed[\s\S]{0,160}active/i,'status flow must include draft, reviewed and active');
  assert.match(migration,/enable row level security/i,'tariff tables must use RLS');
  assert.match(migration,/transport_tariff_mark_reviewed/i,'review must be an explicit database operation');
  assert.match(migration,/transport_tariff_activate/i,'activation must be an explicit database operation');
});

test('transport tariff service keeps parsing, review and activation as separate steps',async()=>{
  const service=await source('src/services/transportTariffs.ts');
  assert.match(service,/parseTransportTariffDocument/,'document parsing must live behind one service boundary');
  assert.match(service,/createTransportTariffDraft/,'an import must create a draft');
  assert.match(service,/saveTransportTariffReview/,'review edits must be persisted before activation');
  assert.match(service,/markTransportTariffReviewed/,'review must be explicit');
  assert.match(service,/activateTransportTariff/,'activation must be explicit');
  assert.match(service,/pdfjs-dist|readTransportDocumentText/,'PDF extraction must be supported');
  assert.match(service,/JSZip|xlsx/i,'Excel/XLSX extraction must be supported');
});

test('transport tariff server parser is deterministic and never auto-activates',async()=>{
  const edge=await source('supabase/functions/transport-tariff-parser/index.ts');
  assert.match(edge,/ownParse\(text\)/);
  assert.match(edge,/zenvia-tariff-engine/);
  assert.doesNotMatch(edge,/OPENAI_API_KEY|api\.openai\.com|\/v1\/responses|input_file/);
  assert.doesNotMatch(edge,/transport_tariff_activate|status\s*:\s*['"]active['"]/i);
});

test('transport tariff UI always reviews an import before activation',async()=>{
  const panel=await source('src/components/TransportTariffsPanel.tsx');
  assert.match(panel,/Tarifas de transporte/i);
  assert.match(panel,/Subir tarifa/i);
  assert.match(panel,/Revisar importaci[oó]n/i);
  assert.match(panel,/Confirmar revisi[oó]n/i);
  assert.match(panel,/Activar tarifa/i);
  assert.match(panel,/\.pdf[^\n]*\.xlsx|\.xlsx[^\n]*\.pdf/i,'file picker must accept PDF and XLSX');
  assert.match(panel,/mapping_status|mappingStatus/i,'service mapping must be reviewable');
  assert.doesNotMatch(panel,/createTransportTariffDraft\([^;]+;\s*await\s+activateTransportTariff/is,'import must never auto-activate');
});

test('Orders exposes transport tariff configuration',async()=>{
  const bridge=await source('src/components/OrderLabelDefaults.tsx');
  assert.match(bridge,/TransportTariffsPanel/,'Orders enhancement must render the tariff manager');
  assert.match(bridge,/Tarifas de transporte/i,'Orders must expose a tariff configuration entry point');
  assert.match(bridge,/ordersPage \.pageHead \.actions/,'tariff button must be scoped to Orders');
});


test('active tariff keeps one visible document while any field can change by effective date',async()=>{
  const service=await source('src/services/transportTariffs.ts');
  const panel=await source('src/components/TransportTariffsPanel.tsx');
  const shipping=await source('src/services/orderShipping.ts');
  const migration=await source('supabase/migrations/20260918024000_general_transport_tariff_effective_revisions.sql');

  assert.match(service,/saveActiveTransportTariff/,'active tariff changes need a dedicated dated save');
  assert.match(service,/transport_tariff_save_active/,'active changes must persist through the effective-date RPC');
  assert.match(service,/transport_tariff_reprice_estimates/,'estimated shipping costs must be recalculated after an active change');
  assert.match(panel,/Aplicar cambios desde/i);
  assert.match(panel,/Todos los campos que cambies se aplicarán desde la fecha indicada/i);
  assert.doesNotMatch(panel,/Combustible por periodos|createTransportTariffVersion/,'effective dating must be generic, not fuel-specific or a visible clone');
  assert.match(shipping,/document\.revisions/,'shipping estimate must resolve the full tariff revision valid for the order date');
  assert.match(migration,/transport_tariff_revisions/);
  assert.match(migration,/snapshot jsonb/i);
  assert.match(migration,/drop table if exists public\.transport_tariff_fuel_periods/i);
});


test('tariff parser is generic and preserves document table structure',async()=>{
  const [service,edge]=await Promise.all([
    source('src/services/transportTariffs.ts'),
    source('supabase/functions/transport-tariff-parser/index.ts'),
  ]);
  assert.match(service,/\[\[PAGE \$\{p\}\]\]/);
  assert.match(service,/\[\[SHEET /);
  assert.match(service,/parseGenericMatrixServices/);
  assert.match(service,/genericWeightHeader/);
  assert.match(service,/validateParsedServices/);
  assert.match(service,/probableCurrency/);
  assert.match(edge,/headerWeights/);
  assert.match(edge,/ownParse/);
  assert.match(edge,/transport_service_mappings/);
  assert.match(edge,/requires?|requiere revisión/i);
});


test('PDF tariff extraction preserves visual columns and supports transposed weight rows',async()=>{
  const service=await source('src/services/transportTariffs.ts');
  assert.match(service,/gap>Math\.max\(12,charWidth\*3\)\?'\\t'/);
  assert.match(service,/Matrix transposed/);
  assert.match(service,/rowWeightMatch/);
});


test('generic tariff parser recognizes carriers commonly returned by Envia',async()=>{
  const service=await source('src/services/transportTariffs.ts');
  for(const carrier of ['inPost','transaher','zeleris','tdn','ontime','cainiao','cttExpress'])assert.match(service,new RegExp(carrier,'i'));
});


async function loadLocalTariffService(invoke){
  let code=await source('src/services/transportTariffs.ts');
  code=code.replace(/^import .*;\n/gm,'').replace(/pdfjsLib\.GlobalWorkerOptions\.workerSrc=pdfWorker;/,'');
  code+='\nexport {fallbackProposal};';
  const output=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  const key='__tariffTestInvoke'+Math.random().toString(36).slice(2);
  globalThis[key]=invoke;
  const prefix=`const supabase={functions:{invoke:globalThis[${JSON.stringify(key)}]}};\n`;
  try{return await import(`data:text/javascript;base64,${Buffer.from(prefix+output).toString('base64')}`)}finally{delete globalThis[key]}
}

test('tariff parser recovers validated local rows offline and rejects empty imports',async()=>{
  const api=await loadLocalTariffService(async()=>{throw new Error('offline')});
  const proposal=await api.parseTransportTariffDocument(new File(['MRW Standard 1 kg 4,50 €'], 'rates.csv',{type:'text/csv'}));
  assert.equal(proposal.services.length,1);
  assert.equal(proposal.services[0].bands[0].basePrice,4.5);
  assert.equal(proposal.parserProvider,'automatic-rules');
  assert.ok(proposal.parserConfidence<1);
  await assert.rejects(api.parseTransportTariffDocument(new File(['unreadable tariff'], 'rates.csv',{type:'text/csv'})),/No se pudo analizar/);
});

test('tariff parser keeps server analysis when available',async()=>{
  const api=await loadLocalTariffService(async()=>({data:{proposal:{carrierName:'Server analyzed',services:[]},parserProvider:'zenvia-tariff-engine'},error:null}));
  const proposal=await api.parseTransportTariffDocument(new File(['unknown'], 'rates.csv',{type:'text/csv'}));
  assert.equal(proposal.carrierName,'Server analyzed');
  assert.equal(proposal.parserProvider,'zenvia-tariff-engine');
});

test('fuel extraction distinguishes VAT from fuel on the same line',async()=>{
  const api=await loadLocalTariffService(async()=>{});
  for(const [text,expected] of [['IVA 21% y combustible 5%',5],['Combustible no incluido; IVA 21%',null],['5% de combustible; IVA 21%',5],['Combustible 5,5%',5.5]]){
    assert.equal(api.fallbackProposal(text,'rates.csv').fuelSurchargePct,expected,text);
  }
});

test('transport tariff delete is not restricted to draft or reviewed documents',async()=>{
  const service=await source('src/services/transportTariffs.ts');
  assert.match(service,/export async function deleteTransportTariff\(/);
  assert.doesNotMatch(service,/Una tarifa activa no se puede eliminar/);
});


test('server tariff parser distinguishes fuel percentages from VAT',async()=>{
  const sourceCode=await source('supabase/functions/transport-tariff-parser/index.ts');
  const code=sourceCode.replace(/^import .*;\n/gm,'').slice(0,sourceCode.replace(/^import .*;\n/gm,'').indexOf('Deno.serve('))+'\nexport {fuelInfo,ownParse};';
  const output=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  const {fuelInfo,ownParse}=await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
  for(const [text,expected] of [['IVA 21% y combustible 5%',5],['Combustible no incluido; IVA 21%',null],['5% de combustible; IVA 21%',5],['Combustible 5,5%',5.5]])assert.equal(fuelInfo(text).pct,expected,text);
  for(const currency of ['€','EUR']){
    const parsed=ownParse('MRW Standard 1 kg 4,50 '+currency);
    assert.equal(parsed.services[0].bands[0].basePrice,4.5);
  }
});
