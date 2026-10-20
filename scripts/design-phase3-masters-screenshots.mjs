// Real billing/expense/receipt components + production list adapters/CSS; offline synthetic data.
import {build} from 'esbuild';
import {assertHeaderActionsPreserved} from './header-actions-contract.mjs';
import {readFile,writeFile,mkdir,mkdtemp,chmod} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {brotliDecompressSync} from 'node:zlib';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
const phase=process.argv[2]||'after',baseline='ed63ce7aecff7c7a296b5fface372f89ee4b8bf7',output=process.env.MASTER_OUTPUT||'docs/deploy/design-phase3-masters-20261020';
const read=async path=>phase==='before'?execFileSync('git',['show',baseline+':'+path],{encoding:'utf8'}):readFile(path,'utf8');
const keep=new Set(['filters','uiPreferences','formatting','settingsSchema','autoListPagination','paginationBars','truncatedTextTooltip','entityChanges','productMetrics']);
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {Products} from './src/pages/Products';import {Clients} from './src/pages/Clients';import {Suppliers} from './src/pages/Suppliers';import {Sidebar} from './src/components/Sidebar';import {AutoPagination} from './src/components/AutoPagination';import {UnifiedListExperience} from './src/components/UnifiedListExperience';import {DEFAULT_APP_SETTINGS,DEFAULT_USER_PREFERENCES} from './src/services/settingsSchema';
const settings=structuredClone(DEFAULT_APP_SETTINGS),preferences={...DEFAULT_USER_PREFERENCES,defaultPeriod:'all',rememberFilters:false,pageSize:25};
const clients=Array.from({length:32},(_,i)=>({id:'client'+i,name:'Cliente '+String(i+1).padStart(2,'0'),taxId:'DEMO-'+i,countryCode:i%2?'ES':'FR',email:'demo@example.test',city:'Ciudad de prueba'}));
const suppliers=Array.from({length:32},(_,i)=>({id:'supplier'+i,name:'Proveedor '+String(i+1).padStart(2,'0'),taxId:'DEMO-'+i,supplierType:'goods',countryCode:'ES',email:'demo@example.test'}));
const products=Array.from({length:32},(_,i)=>({id:'product'+i,name:'Producto '+String(i+1).padStart(2,'0'),sku:'DEMO-'+i,category:'Materiales',supplier:'Proveedor de prueba',lastPrice:10,previousPrice:9,lastPurchaseDate:'2026-10-20',unit:'ud'}));
const sales=clients.map((c,i)=>({id:'sale'+i,invoiceNumber:'DEMO-F'+i,invoiceType:'standard',status:'issued',issueDate:'2026-10-20',clientId:c.id,clientName:c.name,totalAmount:121,paidAmount:20,lines:[],currency:'EUR'}));
const invoices=suppliers.map((s,i)=>({id:'expense'+i,invoiceNumber:'DEMO-G'+i,invoiceDate:'2026-10-20',supplierId:s.id,supplierName:s.name,status:'pending',paymentStatus:'unpaid',total:121,vat:21,currency:'EUR',lines:[]}));
const services={loadClients:async()=>clients,loadSalesInvoices:async()=>sales,loadAppData:async()=>({invoices,categories:[{id:'cat',name:'Materiales'}]}),loadProductSalesMap:async()=>new Map(products.map(p=>[p.id,{salePrice:20,salesTaxRate:21,ean:'DEMO'}])),getActiveTenant:()=>null,getActiveSupabase:()=>null,errorMessage:(e,f)=>e?.message||f,showError:e=>{throw Error(e)},showSuccess:()=>{},confirmAction:async options=>{globalThis.lastConfirmation=options;return false}};
globalThis.fixtureServices=new Proxy(services,{get:(o,k)=>k in o?o[k]:(...a)=>{throw Error('Unmocked service:'+String(k))}});
globalThis.fixtureSettings=()=>({settings,preferences,patchPreferences:async()=>{},updateSection:async()=>{}});
globalThis.renderFixture=(screen)=>createRoot(document.getElementById('root')).render(<div className="app"><Sidebar allowedPages={['dashboard','orders','products','clients','suppliers','settings']} page={screen} isAdmin onChange={()=>{}} onLogout={()=>{}} theme="light" onThemeChange={()=>{}} user={{fullName:'Revision',email:'demo@example.test',role:'admin'}}/><main>{screen==='products'?<Products products={products} onAdd={()=>{globalThis.newAction=true}} onEdit={entity=>{globalThis.editTarget=entity.name}} onDelete={async()=>{throw Error('No writes')}}/>:screen==='clients'?<Clients/>:<Suppliers suppliers={suppliers} onAdd={()=>{globalThis.newAction=true}} onEdit={entity=>{globalThis.editTarget=entity.name}} onDelete={async()=>{throw Error('No writes')}}/>}<AutoPagination/><UnifiedListExperience/></main></div>);`;
const bundled=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,loader:{'.css':'empty'},define:{'import.meta.env':'{}'},format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'offline-finance',setup(b){
 b.onLoad({filter:/[/]src[/](pages|components)[/].*[.](tsx|ts)$/},async args=>{const path=args.path.slice(process.cwd().length+1);if(path==='src/context/SettingsContext.tsx')return;return {contents:await read(path),loader:path.endsWith('tsx')?'tsx':'ts',resolveDir:dirname(args.path)};});
 b.onLoad({filter:/[/]src[/]context[/]SettingsContext[.]tsx$/},()=>({contents:'export const useSettings=()=>globalThis.fixtureSettings();',loader:'tsx'}));
 b.onLoad({filter:/[/]src[/]services[/].*[.]ts$/},async args=>{const name=args.path.split('/').pop().replace('.ts','');if(keep.has(name))return;const source=await readFile(args.path,'utf8');const names=[...(name==='sales'?['defaultSalesDueDate','resolveSalesDueDays']:[]),...[...source.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)].map(m=>m[1])];return {contents:[...new Set(names)].map(n=>'export const '+n+'=(...a)=>globalThis.fixtureServices.'+n+'(...a);').join('\n'),loader:'ts'};});
 }}]});
const main=await read('src/main.tsx'),cssPaths=[...new Set([...main.matchAll(/import ['"]([^'"]+\.css)['"]/g)].map(m=>'src/'+m[1].replace('./','')))];
const css=(await Promise.all([...new Set([...cssPaths,'src/sales.css','src/shared-forms.css','src/bulk-selection.css','src/supplier-actions.css'])].map(read))).join('\n');
let options={headless:true,args:['--lang=es-ES','--accept-lang=es-ES,es'],env:{...process.env,LANG:'es_ES.UTF-8',LC_ALL:'es_ES.UTF-8'}};
if(process.env.SHIPPING_CHROMIUM_PACKAGE==='1'){const {default:pack}=await import('@sparticuz/chromium');const dir=await mkdtemp(resolve(tmpdir(),'finance-chromium-'));const bin=resolve(dirname(fileURLToPath(import.meta.resolve('@sparticuz/chromium'))),'../bin');for(const f of ['chromium.br','swiftshader.tar.br']){const data=brotliDecompressSync(await readFile(resolve(bin,f)));if(f.includes('.tar'))execFileSync('tar',['--no-same-owner','-x','-C',dir],{input:data});else{await writeFile(resolve(dir,'chromium'),data);await chmod(resolve(dir,'chromium'),0o755);}}options={...options,executablePath:resolve(dir,'chromium'),args:[...pack.args.filter(a=>a!=='--single-process'),...options.args],env:{...options.env,LD_LIBRARY_PATH:[dir,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')}};}
await mkdir(output,{recursive:true});const browser=await chromium.launch(options),checks=[];
try{for(const screen of ['products','clients','suppliers'])for(const width of (process.env.MASTER_WIDTHS?process.env.MASTER_WIDTHS.split(',').map(Number):[390,1280,1440])){
 const page=await browser.newPage({locale:'es-ES',viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());
 await page.setContent('<html lang="es-ES"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script>'+bundled.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script></body></html>');await page.evaluate(s=>globalThis.renderFixture(s),screen);
 try{await page.locator('tbody tr').first().waitFor({state:'attached',timeout:10000})}catch(e){console.log({screen,width,errors,body:(await page.locator('body').innerText()).slice(-1000)});throw e;}await page.waitForTimeout(300);
 await page.screenshot({path:output+'/'+phase+'-'+screen+'-'+width+'.png'});
 if(width===390){await page.evaluate(()=>scrollTo(0,1000));await page.screenshot({path:output+'/'+phase+'-'+screen+'-390-second.png'});await page.evaluate(()=>scrollTo(0,0));if(phase==='after'){await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:output+'/after-'+screen+'-390-dark.png'});await page.evaluate(()=>delete document.documentElement.dataset.theme);}}

 const filterOptions=[];
 for(const combo of await page.locator('.businessFilterFields [role="combobox"]').all()){
  const label=await combo.getAttribute('aria-label');await combo.click();
  const labels=await page.getByRole('option').allTextContents();filterOptions.push({label,options:labels.map(text=>text.replace(/\s+/g,' ').trim())});await page.keyboard.press('Escape');
 }
 await page.evaluate(()=>scrollTo(0,0));
 const proof=await page.evaluate(()=>{
 const visible=el=>el.getClientRects().length&&getComputedStyle(el).display!=='none',rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:r.height}};
 const rows=[...document.querySelectorAll('.masterMobileList>.bulkMobileSelectableRow,tbody tr')].filter(visible),fields=[...document.querySelectorAll('.businessFilterFields>label')];
 return {firstList:rows[0]?rect(rows[0]):null,documentOverflow:document.documentElement.scrollWidth>innerWidth,columns:[...document.querySelectorAll('.kpiGrid,.stats')].map(el=>getComputedStyle(el).gridTemplateColumns),cards:[...document.querySelectorAll('.stat')].map(el=>({text:el.textContent,warning:el.classList.contains('dashboardPendingOrders'),overflow:el.scrollWidth>el.clientWidth+1})),headerActions:[...document.querySelectorAll('.pageHead button')].map(el=>el.textContent),filters:fields.map(el=>({text:el.textContent,...rect(el),trigger:rect(el.querySelector('.searchableSelectTrigger')),lines:[...el.querySelectorAll('.searchableSelectTrigger>span')].some(span=>{const range=document.createRange();range.selectNodeContents(span);return new Set([...range.getClientRects()].map(r=>Math.round(r.y))).size>1})})),rowActions:document.querySelector('tbody tr')?.querySelectorAll('button[aria-label="Editar"],button[aria-label="Eliminar"]').length??0};
 });
 proof.filterOptions=filterOptions;
 const failures=[...errors];if(phase==='after'){
 if(width===390){const bad=await page.locator('.dsMobileList .dsRowActions button').evaluateAll(els=>els.some(el=>el.scrollHeight>el.clientHeight+1||el.scrollWidth>el.clientWidth+1||el.getBoundingClientRect().height<44));if(bad)failures.push('Mobile row action clipped or undersized');}

 const before=JSON.parse(await readFile(output+'/before-manifest.json','utf8')).checks.find(c=>c.screen===screen&&c.width===width),clean=s=>s.replace(/\s+/g,' ').trim();
 try{assertHeaderActionsPreserved(before.headerActions,proof.headerActions,screen+' '+width);}catch(e){failures.push(e.message)}
 if(JSON.stringify(before.cards.map(c=>clean(c.text)))!==JSON.stringify(proof.cards.map(c=>clean(c.text))))failures.push('KPI content changed');
 if(JSON.stringify(before.cards.map(c=>c.warning))!==JSON.stringify(proof.cards.map(c=>c.warning)))failures.push('Semantic variants changed');
 if(JSON.stringify(before.filterOptions)!==JSON.stringify(proof.filterOptions))failures.push('Full filter option labels changed');
 if(JSON.stringify(before.filters.map(c=>clean(c.text)))!==JSON.stringify(proof.filters.map(c=>clean(c.text))))failures.push('Filter options changed');
 if(width===390&&(proof.firstList?.y>=1800||proof.columns.some(c=>c.split(' ').length!==2)))failures.push('Mobile list height/two-column KPIs');
 if(proof.documentOverflow||proof.cards.some(c=>c.overflow))failures.push('Document/KPI overflow');
 if(width>=1280&&(proof.filters.some(c=>c.lines)||new Set(proof.filters.map(f=>Math.round(f.y))).size>1||Math.max(...proof.filters.map(f=>f.width))-Math.min(...proof.filters.map(f=>f.width))>1))failures.push('Filter row/width/text');
 if(proof.rowActions!==2)failures.push('Native row actions lost');
 }
 // No mutations: select across pages/search/sort, open details, cancel delete confirmations.
 const search=page.locator('.page .search input');const cb=page.locator(width<768?'.masterMobileList input[type="checkbox"]':'tbody input[type="checkbox"]').first();await cb.check();const selectedLabel=await cb.getAttribute('aria-label');
 await search.fill('NO-MATCH');await page.waitForTimeout(100);
 if(phase==='after'){
  await page.getByText('Revisar selección (1)',{exact:true}).click();
  const notice=await page.getByRole('region',{name:'Selección conservada'}).innerText();if(!notice.includes('1 fuera de los filtros'))failures.push('Hidden scope not explained');
  await page.getByRole('button',{name:'Eliminar seleccionados (1)',exact:true}).click();
  const confirmation=await page.evaluate(()=>globalThis.lastConfirmation);if(!confirmation?.details?.some(text=>selectedLabel===('Seleccionar '+text)))failures.push('Confirmation omitted hidden selection identity');
 }
 await search.fill('');await page.locator('tbody tr').first().waitFor({state:'attached'});await page.waitForTimeout(100);
 proof.selectionRetained=await page.getByRole('checkbox',{name:selectedLabel,exact:true}).filter({visible:true}).first().isChecked();
 if(phase==='after'&&!proof.selectionRetained)failures.push('Search lost retained selection');
 if(phase==='after'){
 const next=page.locator('.listPagination:not(.paginationMirror) button').filter({hasText:'Siguiente'}).first();await next.click();await page.waitForTimeout(100);await page.locator('.listPagination:not(.paginationMirror) button').filter({hasText:'Anterior'}).first().click();await page.waitForTimeout(100);
 if(!await page.getByRole('checkbox',{name:selectedLabel,exact:true}).filter({visible:true}).first().isChecked())failures.push('Pagination lost selection');
 if(width>=1280){const sort=page.locator('.masterTable thead button').first();await sort.click();await sort.click();if(!await page.getByRole('region',{name:'Selección conservada'}).isVisible())failures.push('Sorting lost retained selection');}
 if(width>=1280){const sticky=await page.locator('.dsDataTable').evaluate(el=>{const cells=[el.querySelector('tbody tr td:first-child'),el.querySelector('tbody tr .dsIdentityCell')],before=cells.map(c=>c.getBoundingClientRect().x);el.scrollLeft=180;const after=cells.map(c=>c.getBoundingClientRect().x);el.scrollLeft=0;return before.every((x,i)=>Math.abs(x-after[i])<1)});if(!sticky)failures.push('Selection/identity columns not fixed');}
 if(width>=1280){await page.locator('.dsDataTable').focus();if(!await page.locator('.dsDataTable').evaluate(el=>document.activeElement===el))failures.push('Table keyboard focus unavailable');await page.setViewportSize({width:390,height:1000});if(!await page.getByRole('checkbox',{name:selectedLabel,exact:true}).filter({visible:true}).first().isChecked())failures.push('Responsive switch lost selection');await page.setViewportSize({width,height:1000});}
 const row=page.locator(width<768?'.masterMobileList .masterMobileRow':'tbody tr.clickableRow').first();await row.click();await page.locator('.masterDrawer').waitFor();await page.locator('.masterDrawerHead .iconBtn').click();
 const ownerRow=page.locator(width<768?'.masterMobileList .bulkMobileSelectableRow':'.masterTable tbody tr.clickableRow').first();
 const entityName=await ownerRow.locator('.masterEntityCell strong').first().textContent();
 await ownerRow.getByRole('button',{name:'Eliminar',exact:true}).click();
 const single=await page.evaluate(()=>globalThis.lastConfirmation);if(!single?.message?.includes(entityName))failures.push('Native delete targeted a different record');
 if(screen!=='clients'){await ownerRow.getByRole('button',{name:'Editar',exact:true}).click();if(await page.evaluate(()=>globalThis.editTarget)!==entityName)failures.push('Native edit targeted a different record');}
 proof.nativeActionTarget=entityName;

 }
 failures.push(...errors.filter(error=>!failures.includes(error)));
 checks.push({screen,width,...proof,failures});await page.close();
}}finally{await browser.close();}
await writeFile(output+'/'+phase+'-manifest.json',JSON.stringify({baseline,synthetic:true,networkBlocked:true,locale:'es-ES',checks},null,2));console.log(JSON.stringify(checks.map(({cards,...c})=>c),null,2));if(checks.some(c=>c.failures.length))process.exitCode=1;
