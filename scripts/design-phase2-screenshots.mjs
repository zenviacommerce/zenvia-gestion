// Real billing/expense/receipt components + production list adapters/CSS; offline synthetic data.
import {build} from 'esbuild';
import {readFile,writeFile,mkdir,mkdtemp,chmod} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {brotliDecompressSync} from 'node:zlib';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
const phase=process.argv[2]||'after',baseline='aa8677ddf09a4b64be74a80ff8df26fe762405bc',output='docs/deploy/design-phase2-review-20261020';
const read=async path=>phase==='before'?execFileSync('git',['show',baseline+':'+path],{encoding:'utf8'}):readFile(path,'utf8');
const keep=new Set(['filters','uiPreferences','formatting','settingsSchema','autoListPagination','paginationBars','truncatedTextTooltip','entityChanges']);
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {SalesInvoices} from './src/pages/SalesInvoices';import {ExpenseInvoicesHub} from './src/pages/ExpenseInvoicesHub';import {Sidebar} from './src/components/Sidebar';import {AutoPagination} from './src/components/AutoPagination';import {UnifiedListExperience} from './src/components/UnifiedListExperience';import {DEFAULT_APP_SETTINGS,DEFAULT_USER_PREFERENCES} from './src/services/settingsSchema';
const settings=structuredClone(DEFAULT_APP_SETTINGS),preferences={...DEFAULT_USER_PREFERENCES,defaultPeriod:'all',rememberFilters:false,pageSize:25};
const clients=[{id:'client1',name:'Cliente de prueba',countryCode:'ES',taxId:'DEMO'}];
const sales=Array.from({length:32},(_,i)=>({id:'sale'+i,invoiceNumber:'DEMO-F'+String(i+1).padStart(3,'0'),invoiceType:'standard',status:'issued',issueDate:'2026-10-20',dueDate:'2026-10-31',clientId:'client1',clientName:'Cliente de prueba',subtotal:100,taxAmount:21,totalAmount:121,paidAmount:20,lines:[],currency:'EUR'}));
const receipts=Array.from({length:32},(_,i)=>({id:'receipt'+i,receiptNumber:'DEMO-R'+String(i+1).padStart(3,'0'),clientId:'client1',clientName:'Cliente de prueba',issueDate:'2026-10-20',receiptDate:'2026-10-20',date:'2026-10-20',totalAmount:120,paidAmount:20,status:'open',lines:[]}));
const expenses=Array.from({length:32},(_,i)=>({id:'expense'+i,invoiceNumber:'DEMO-G'+String(i+1).padStart(3,'0'),invoiceDate:'2026-10-20',supplierId:'supplier1',supplierName:'Proveedor de prueba',categoryId:'cat1',category:'Materiales',status:'pending',paymentStatus:'unpaid',source:'manual',total:i%2?987654.32:1234567.89,vat:i%2?171411.08:214263.85,currency:i%2?'USD':'EUR',lines:[],filePath:null}));
const services={loadClients:async()=>clients,loadSalesInvoices:async()=>sales,loadSalesReceipts:async()=>receipts,ensureSalesSeries:async()=>[],loadBillableProducts:async()=>[],loadBusinessSettings:async()=>({legalName:'Empresa de prueba',countryCode:'ES'}),loadCompanyBranding:async()=>({ownerId:'demo',logoDataUrl:null}),startActivity:()=>({finish:()=>{}}),getActiveTenant:()=>null,getActiveSupabase:()=>null,errorMessage:(e,f)=>e?.message||f,showError:e=>{throw Error(e)},showSuccess:()=>{},confirmAction:async()=>false};
globalThis.fixtureServices=new Proxy(services,{get:(o,k)=>k in o?o[k]:(...a)=>{throw Error('Unmocked service:'+String(k))}});
globalThis.fixtureSettings=()=>({settings,preferences,patchPreferences:async()=>{},updateSection:async()=>{}});
globalThis.renderFixture=(screen)=>createRoot(document.getElementById('root')).render(<div className="app"><Sidebar allowedPages={['dashboard','orders','invoices','sales','settings']} page={screen==='expenses'?'invoices':'sales'} isAdmin onChange={()=>{}} onLogout={()=>{}} theme="light" onThemeChange={()=>{}} user={{fullName:'Revision',email:'demo@example.test',role:'admin'}}/><main>{screen==='expenses'?<ExpenseInvoicesHub invoices={expenses} suppliers={[{id:'supplier1',name:'Proveedor de prueba'}]} categories={[{id:'cat1',name:'Materiales'}]} onUpload={()=>{globalThis.upload=true}} onBulkUpload={()=>{globalThis.bulkUpload=true}} onStatusChange={async()=>{}} onPaymentStatusChange={async()=>{}} onBulkPaymentStatusChange={async()=>{}} onOpenFile={async()=>{}} onDelete={async()=>{}} onSupplierChange={async()=>{}} onCategoryChange={async()=>{}} onImported={()=>{}} onManageAccounts={()=>{}} canManageAccounts/>:<SalesInvoices/>}<AutoPagination/><UnifiedListExperience/></main></div>);`;
const bundled=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,loader:{'.css':'empty'},define:{'import.meta.env':'{}'},format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'offline-finance',setup(b){
 b.onLoad({filter:/[/]src[/](pages|components)[/].*[.](tsx|ts)$/},async args=>{const path=args.path.slice(process.cwd().length+1);if(path==='src/context/SettingsContext.tsx')return;return {contents:await read(path),loader:path.endsWith('tsx')?'tsx':'ts',resolveDir:dirname(args.path)};});
 b.onLoad({filter:/[/]src[/]context[/]SettingsContext[.]tsx$/},()=>({contents:'export const useSettings=()=>globalThis.fixtureSettings();',loader:'tsx'}));
 b.onLoad({filter:/[/]src[/]services[/].*[.]ts$/},async args=>{const name=args.path.split('/').pop().replace('.ts','');if(keep.has(name))return;const source=await readFile(args.path,'utf8');const names=[...(name==='sales'?['defaultSalesDueDate','resolveSalesDueDays']:[]),...[...source.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)].map(m=>m[1])];return {contents:[...new Set(names)].map(n=>'export const '+n+'=(...a)=>globalThis.fixtureServices.'+n+'(...a);').join('\n'),loader:'ts'};});
 }}]});
const main=await read('src/main.tsx'),cssPaths=[...new Set([...main.matchAll(/import ['"]([^'"]+\.css)['"]/g)].map(m=>'src/'+m[1].replace('./','')))];
const css=(await Promise.all([...new Set([...cssPaths,'src/sales.css','src/sales-transfer.css','src/shared-forms.css','src/bulk-selection.css'])].map(read))).join('\n');
let options={headless:true,args:['--lang=es-ES','--accept-lang=es-ES,es'],env:{...process.env,LANG:'es_ES.UTF-8',LC_ALL:'es_ES.UTF-8'}};
if(process.env.SHIPPING_CHROMIUM_PACKAGE==='1'){const {default:pack}=await import('@sparticuz/chromium');const dir=await mkdtemp(resolve(tmpdir(),'finance-chromium-'));const bin=resolve(dirname(fileURLToPath(import.meta.resolve('@sparticuz/chromium'))),'../bin');for(const f of ['chromium.br','swiftshader.tar.br']){const data=brotliDecompressSync(await readFile(resolve(bin,f)));if(f.includes('.tar'))execFileSync('tar',['--no-same-owner','-x','-C',dir],{input:data});else{await writeFile(resolve(dir,'chromium'),data);await chmod(resolve(dir,'chromium'),0o755);}}options={...options,executablePath:resolve(dir,'chromium'),args:[...pack.args.filter(a=>a!=='--single-process'),...options.args],env:{...options.env,LD_LIBRARY_PATH:[dir,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')}};}
await mkdir(output,{recursive:true});const browser=await chromium.launch(options),checks=[];
try{for(const screen of ['billing','expenses','receipts'])for(const width of [390,1280,1440]){
 const page=await browser.newPage({locale:'es-ES',viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());
 await page.setContent('<html lang="es-ES"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script>'+bundled.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script></body></html>');await page.evaluate(s=>globalThis.renderFixture(s),screen);
 if(screen==='receipts')await page.getByRole(phase==='before'?'button':'tab',{name:/^Recibos/}).click();
 await page.locator('.stat').first().waitFor();await page.locator('tbody tr').first().waitFor({state:'attached'});await page.waitForTimeout(300);
 await page.screenshot({path:output+'/'+phase+'-'+screen+'-'+width+'.png'});if(width===390){await page.evaluate(()=>scrollTo(0,1000));await page.screenshot({path:output+'/'+phase+'-'+screen+'-390-second.png'});await page.evaluate(()=>scrollTo(0,0));}
 const proof=await page.evaluate(()=>{
  const visible=el=>el.getClientRects().length&&getComputedStyle(el).display!=='none',rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:r.height}};
  const rows=[...document.querySelectorAll('.salesInvoiceMobileCard,.zenviaUnifiedMobileList>*,tbody tr')].filter(visible);const cards=[...document.querySelectorAll('.stat')];
  return {tabOverflow:[...document.querySelectorAll('.expenseHubNav')].some(el=>el.scrollWidth>el.clientWidth+1),tabs:[...document.querySelectorAll('.expenseHubNav button')].map(el=>el.textContent),tabRoles:document.querySelectorAll('.expenseHubNav [role="tab"]').length,firstList:rows[0]?rect(rows[0]):null,firstListScreens:rows[0]?(rows[0].getBoundingClientRect().top+scrollY)/innerHeight:null,cards:cards.map(el=>({text:el.textContent,...rect(el),overflow:el.scrollWidth>el.clientWidth+1})),columns:[...document.querySelectorAll('.kpiGrid,.stats')].map(el=>getComputedStyle(el).gridTemplateColumns),documentOverflow:document.documentElement.scrollWidth>innerWidth,controls:[...document.querySelectorAll('.pageHead button,.pageHead label,.sharedPeriodPanel input,.sharedPeriodPanel button,.businessFilterBar button,.businessFilterBar input,.invoiceFilterPanel button')].map(el=>({text:el.textContent,label:el.getAttribute('aria-label'),type:el.getAttribute('type'),disabled:el.disabled??false})),headerActions:[...document.querySelectorAll('.pageHead button')].map(b=>b.textContent)};
 });
 const failures=[...errors];if(phase==='after'){
  if(width===390&&(!proof.firstList||proof.firstList.y>=1800))failures.push('First data item must start before1800px');
  if(width===390&&proof.columns.some(c=>c.split(' ').length!==2))failures.push('Every mobile KPI family must have2 columns');
  if(proof.tabOverflow)failures.push('Shared tabs overflow their mobile container');
  if(proof.cards.some(c=>c.overflow))failures.push('KPI content overflow');if(proof.documentOverflow)failures.push('Document overflow');
  const before=JSON.parse(await readFile(output+'/before-manifest.json','utf8')).checks.find(c=>c.screen===screen&&c.width===width);
  const clean=s=>s.replace(/\s+/g,' ').trim();if(JSON.stringify(before.cards.map(c=>clean(c.text)))!==JSON.stringify(proof.cards.map(c=>clean(c.text))))failures.push('KPI information changed');
  if(JSON.stringify(before.tabs)!==JSON.stringify(proof.tabs)||proof.tabRoles!==2)failures.push('Sibling tabs lost labels, descriptions or accessible roles');
  if(JSON.stringify(before.headerActions)!==JSON.stringify(proof.headerActions))failures.push('Header actions changed or portal missing');
  if(JSON.stringify(before.controls)!==JSON.stringify(proof.controls))failures.push('Filter/header controls or disabled state changed');
 }
 if(width===390){
  if(phase==='after'&&screen==='billing'){
   await page.getByRole('button',{name:'Importar facturas',exact:true}).click();await page.getByRole('heading',{name:'Importar facturas de venta',exact:true}).waitFor();await page.getByRole('button',{name:'Cerrar',exact:true}).click();
   await page.getByRole('button',{name:/^Exportar \(32\)/}).click();await page.getByRole('heading',{name:'Exportar facturas de venta',exact:true}).waitFor();await page.getByRole('button',{name:'Cerrar',exact:true}).click();
  }
  const checkbox=page.locator(screen==='billing'?'.salesInvoiceMobileCard input[type="checkbox"]':'.bulkMobileSelectableRow input[type="checkbox"]').filter({visible:true}).first();
  await checkbox.check();const checkedLabel=await checkbox.getAttribute('aria-label');
  const search=page.locator('.page .search input');await search.fill('NO-MATCH-FIXTURE');await page.getByText(screen==='expenses'?'No hay facturas para los filtros seleccionados.':screen==='receipts'?'No hay recibos para los filtros seleccionados.':'No hay facturas de venta para los filtros seleccionados.',{exact:true}).waitFor({state:'attached'});await search.fill('');await page.locator('tbody tr').first().waitFor({state:'attached'});await page.waitForTimeout(250);
  proof.selectionAfterFilter={label:checkedLabel,checked:await page.getByRole('checkbox',{name:checkedLabel,exact:true}).filter({visible:true}).first().isChecked()};
  if(await search.inputValue()!=='')failures.push('Search state did not restore');
  if(phase==='after'){
   const before=JSON.parse(await readFile(output+'/before-manifest.json','utf8')).checks.find(c=>c.screen===screen&&c.width===width);
   if(JSON.stringify(before.selectionAfterFilter)!==JSON.stringify(proof.selectionAfterFilter))failures.push('Selection behavior changed from baseline');
   await page.evaluate(()=>{document.documentElement.dataset.theme='dark';scrollTo(0,0)});await page.screenshot({path:output+'/after-'+screen+'-390-dark.png'});
   if(await page.locator('.stat').evaluateAll(els=>els.some(el=>el.scrollWidth>el.clientWidth+1)))failures.push('Dark KPI overflow');
  }
 }
 checks.push({screen,width,...proof,failures});await page.close();
}}finally{await browser.close();}
await writeFile(output+'/'+phase+'-manifest.json',JSON.stringify({baseline,synthetic:true,networkBlocked:true,locale:'es-ES',checks},null,2));console.log(JSON.stringify(checks.map(({cards,controls,...c})=>c),null,2));if(checks.some(c=>c.failures.length))process.exitCode=1;
