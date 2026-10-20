// Actual Resumen/Pedidos/Sidebar + full CSS cascade; deterministic synthetic data, network blocked.
// before uses immutable production revision58687e42; after uses the working tree.
// npm install --no-save --package-lock=false playwright@1.58.2
// npx playwright install chromium && node scripts/orders-product-lines-screenshots.mjs after
// Restricted download fallback: npm install --no-save --package-lock=false playwright@1.58.2 @sparticuz/chromium@153.0.0
// SHIPPING_CHROMIUM_PACKAGE=1 node scripts/orders-product-lines-screenshots.mjs after
import {build} from 'esbuild';
import {pickupLogoFixture} from './pickup-pdf-fixture.mjs';
import {readFile,mkdir,writeFile,mkdtemp,chmod} from 'node:fs/promises';
import {brotliDecompressSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
const phase=process.argv[2]||'after';
const baselineRevision=process.env.DESIGN_BASELINE||'58687e42';
const source=phase==='before'?execFileSync('git',['show',baselineRevision+':src/pages/Orders.tsx'],{encoding:'utf8'}):await readFile('src/pages/Orders.tsx','utf8');
const dashboard=phase==='before'?execFileSync('git',['show',baselineRevision+':src/pages/Dashboard.tsx'],{encoding:'utf8'}):await readFile('src/pages/Dashboard.tsx','utf8');
const mocks=new Map();
for(const match of (source+dashboard).matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)){
 const [,clause,path]=match;
 if(!path.startsWith('../services/')&&!path.endsWith('SettingsContext'))continue;
 if(['orderStatus','filters','orderShipping','orderLabelFiles','shippingRuleCore','uiPreferences','formatting'].some(x=>path.endsWith('/'+x)))continue;
 const named=clause.match(/\{([\s\S]*?)\}/)?.[1]||'';
 const exports=named.split(',').map(x=>x.trim()).filter(x=>x&&!x.startsWith('type ')).map(x=>x.split(/\s+as\s+/).pop());
 mocks.set(path,(mocks.get(path)||'')+'\n'+exports.filter(x=>!(mocks.get(path)||'').includes('export const '+x+'=')).map(x=>`export const ${x}=(...args)=>globalThis.fixtureServices.${x}?.(...args);`).join('\n'));
}
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {Orders} from './src/pages/Orders';import {KpiGrid} from './src/components/KpiGrid';import {StatCard} from './src/components/StatCard';import {Dashboard} from './src/pages/Dashboard';import {Sidebar} from './src/components/Sidebar';import {ActionDialogHost} from './src/components/ActionDialogHost';import {DEFAULT_APP_SETTINGS,DEFAULT_USER_PREFERENCES} from './src/services/settingsSchema';
if(!crypto.randomUUID)Object.defineProperty(crypto,'randomUUID',{value:()=> '00000000-0000-4000-8000-000000000042'});\nconst settings=structuredClone(DEFAULT_APP_SETTINGS);settings.orders.bulkScope='selected';settings.orders.refreshSeconds=600;settings.integrations.amazonEnabled=false;settings.integrations.shopifyEnabled=false;
const preferences={...DEFAULT_USER_PREFERENCES,pageSize:25,defaultPeriod:'all',rememberFilters:false};
const orders=Array.from({length:63},(_,i)=>({id:'demo-'+i,orderId:'DEMO-'+String(i+1).padStart(3,'0'),orderNumber:'DEMO-'+String(i+1).padStart(3,'0'),sourceChannel:i%2?'shopify':'amazon',sourceStatus:'unshipped',pickupReports:i%3===0?[{id:'report-42',number:'REC-2026-0042'}]:[],customerName:'Cliente demostración '+(i+1),integrationName:i%2?'Tienda demo':'Amazon demo',orderStatus:'pending',status:'pending',statusName:'pending',shippingAddress:{name:'Cliente demostración',address_line_1:'Calle Ejemplo',house_number:'10',postal_code:i%3?'28013':'75001',city:i%3?'Madrid':'París',country_code:i%3?'ES':'FR',phone:'+34600000000'},destinationCountryCode:i%3?'ES':'FR',carrierName:i%2?'MRW':'Correos Express',carrier:i%2?'MRW':'Correos Express',items:[{name:'Aceite esencial de lavanda',sku:'DEMO-A',quantity:3},{name:'Jabón de manos cítrico',sku:'DEMO-B',quantity:4},{name:'Crema facial hidratante',sku:'DEMO-C',quantity:1},{name:'Champú nutritivo',sku:'DEMO-D',quantity:2},{name:'Bálsamo labial',sku:'DEMO-E',quantity:5}],orderCreatedAt:'2026-10-19T09:00:00Z',orderUpdatedAt:'2026-10-19T09:00:00Z',weightKg:1,totalAmount:24.9,currency:'EUR',trackingNumber:'TRACK-'+String(i+1).padStart(10,'0'),shippingLabelUrl:'fixture-label-'+i,shippingProvider:i%2?'mrw':'envia',labelCreatedAt:'2026-10-20T07:00:00Z',raw:{}}));
const emptyTransport={total:0,mrw:0,correos:0,valued:0,shipments:0,missing:0,basis:'recorded_only'};
const matches=p=>orders.filter(o=>(!p.pickupReport||p.pickupReport==='all'||(p.pickupReport==='in'?o.pickupReports.length>0:o.pickupReports.length===0))&&(p.channel==='all'||o.sourceChannel===p.channel)&&(p.country==='all'||o.destinationCountryCode===p.country)&&(p.carrier==='all'||o.carrierName.toLowerCase()===p.carrier)&&(!p.query||[o.orderNumber,o.customerName,o.items[0].name].join(' ').toLowerCase().includes(p.query.toLowerCase())));
globalThis.fixtureSelections=[];globalThis.fixtureRequests=[];globalThis.fixtureQuotes=[];globalThis.fixtureServices={confirmAction:async()=>true,useSettings:()=>({settings,preferences,patchPreferences:async()=>{},updateSection:async()=>{}}),watchFulfillmentOrders:()=>()=>{},loadShippingRules:async()=>[],defaultShippingRules:()=>[],listTransportTariffs:async()=>[],loadAmazonProductImages:async()=>({}),getSendcloudStatus:async()=>({configured:true,integrations:[]}),getEnviaStatus:async()=>({configured:false,accounts:[]}),fetchMatchingOrderIds:async p=>matches(p).map(o=>o.id),listSelectedOrdersForBulk:async(p,ids)=>{globalThis.fixtureSelections.push(ids);return orders.filter(o=>ids.includes(o.id));},fetchOrdersDashboardPage:async p=>{globalThis.fixtureRequests.push(p);let rows=matches(p);return {orders:rows.slice(p.page*p.pageSize,(p.page+1)*p.pageSize),total:rows.length,selectableTotal:rows.length,kpis:{pending:rows.length,amazon:rows.filter(o=>o.sourceChannel==='amazon').length,shopify:rows.filter(o=>o.sourceChannel==='shopify').length,manual:0,labelled:rows.length,shipped:0,cancelled:0,overduePending:0,preparablePending:rows.length,sales:{gross:rows.length*24.9,vat:rows.length*24.9*21/121,net:rows.length*24.9/1.21,count:rows.length,average:24.9},transport:emptyTransport},facets:{countries:['ES','FR'],carriers:['MRW','Correos Express']}}},getShippingOptions:async id=>{globalThis.fixtureQuotes.push(id);return {options:[{provider:'mrw',providerName:'MRW directo',carrierName:'MRW',carrierCode:'mrw',name:'Entrega 24 h',price:4.8,currency:'EUR',code:'0200'}]}},createOrderLabel:()=>{throw Error('Purchases disabled in offline fixture')}};

globalThis.fixtureServices.loadSalesInvoices=async()=>[{id:'sale-1',invoiceNumber:'DEMO-F001',issueDate:'2026-10-19',clientName:'Cliente sintético',status:'issued',totalAmount:12345.67,taxAmount:2142.64,paidAmount:10000}];const dashboardOrders=orders.map(o=>({...o,shippingLabelUrl:null,labelCreatedAt:null,trackingNumber:null}));globalThis.fixtureServices.listFulfillmentOrders=async()=>dashboardOrders;globalThis.fixtureServices.readOrdersSnapshot=()=>dashboardOrders;globalThis.fixtureServices.readViewCache=()=>null;globalThis.fixtureServices.writeViewCache=()=>{};
let saved=null;globalThis.pickupFixture={
 preview:async ids=>({items:orders.filter(o=>ids.includes(o.id)).map(o=>({orderId:o.id,orderNumber:o.orderNumber,channel:o.sourceChannel,carrier:o.carrierName,trackingNumber:globalThis.pickupInvalid&&o.id===ids[0]?'':o.trackingNumber,packages:1,packageCountEstimated:true,eligible:!(globalThis.pickupInvalid&&o.id===ids[0]),issue:globalThis.pickupInvalid&&o.id===ids[0]?'missing_tracking':null,previousReports:globalThis.pickupRepeated?['REC-2026-0001']:[]})),totalPackages:ids.length,canCreate:!globalThis.pickupInvalid}),
 create:async(ids,request,allow,counts)=>{saved={id:'report-42',number:'REC-2026-0042',createdAt:'2026-10-20T07:30:00Z',createdBy:'fixture-user',sender:{legalName:'ZENVIA COMMERCE SL',taxId:'B12345678',address:'Calle del Comercio 28, 28022 Madrid',email:'logistica@example.test',phone:'+34910000042'},items:orders.filter(o=>ids.includes(o.id)).map(o=>({orderId:o.id,orderNumber:o.orderNumber,channel:o.sourceChannel,carrier:o.carrierName,trackingNumber:o.trackingNumber,packages:counts[o.id]||1})),totalPackages:Object.values(counts).reduce((a,b)=>a+b,0)};return saved;},
 list:async(orderId)=>[{id:'report-42',number:'REC-2026-0042',createdAt:'2026-10-20T07:30:00Z',totalOrders:21,totalPackages:21,carriers:['MRW','Correos Express']}], unused:()=>saved?[{id:saved.id,number:saved.number,createdAt:saved.createdAt,totalPackages:saved.totalPackages,totalOrders:saved.items.length,carriers:['MRW','Correos Express']}]:[],
 get:async()=>saved};
globalThis.fixtureServices.selectPickupOrderIds=async p=>matches(p).map(o=>o.id);

globalThis.renderStress=()=>createRoot(document.getElementById('root')).render(<div className="page designSystemPage"><KpiGrid label="Divisas de prueba"><StatCard label="Ventas multimoneda" value={<><span>1.234,56 EUR</span><span>123.456,78 USD</span></>} sub="Importes sin sumar divisas" icon={<span/>}/><StatCard label="Otro indicador" value="7" icon={<span/>}/></KpiGrid></div>);
globalThis.renderFixture=(screen)=>createRoot(document.getElementById('root')).render(<div className="app"><Sidebar allowedPages={["dashboard","orders","invoices","products","sales","clients","suppliers","amazon","shopify","settings","support","admin"]} isAdmin={true} page={screen} onChange={()=>{}} onLogout={()=>{}} theme="light" onThemeChange={()=>{}} user={{fullName:"Usuario de revisión",email:"demo@example.test",role:"admin"}}/><main>{screen==='orders'?<Orders/>:<Dashboard invoices={[{id:'expense-1',supplierName:'Proveedor sintético',invoiceDate:'2026-10-19',invoiceNumber:'DEMO-G001',category:'Suministros',total:2345.67,vat:407.93,status:'pending'}]} products={[]} suppliers={[]} onUpload={()=>globalThis.fixtureUpload=true} onOrders={()=>globalThis.fixtureOrders=true}/>}<ActionDialogHost/></main></div>);;`;

mocks.set('../services/pickupReports',(mocks.get('../services/pickupReports')||'')+
 'export const previewPickupReport=(...a)=>globalThis.pickupFixture.preview(...a);export const createPickupReport=(...a)=>globalThis.pickupFixture.create(...a);export const listPickupReports=(...a)=>globalThis.pickupFixture.list(...a);export const getPickupReport=(...a)=>globalThis.pickupFixture.get(...a);');
mocks.set('./companyBranding', 'export const loadCompanyBranding=async()=>({logoDataUrl:'+JSON.stringify(pickupLogoFixture)+'});');
mocks.set('./supabase', 'export const supabase={};export const getActiveSupabase=()=>null;export const getActiveTenant=()=>null;');
mocks.delete('../services/actionDialog');
mocks.set('../services/sales',mocks.get('../services/sales')+'\nexport const ensureSalesSeries=async()=>[];export const loadBusinessSettings=async()=>({});export const loadClients=async()=>[];export const markSalesInvoiceSent=async()=>{};');
const bundled=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,loader:{'.css':'empty'},define:{'import.meta.env':'{}'},format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'offline-orders-fixture',setup(b){if(phase==='before')b.onLoad({filter:/[/]src[/](pages[/](Orders|Dashboard)|components[/]StatCard)[.]tsx$/},args=>({contents:execFileSync('git',['show',baselineRevision+':'+args.path.slice(process.cwd().length+1)],{encoding:'utf8'}),loader:'tsx',resolveDir:dirname(args.path)}));b.onResolve({filter:/.*/},args=>mocks.has(args.path)?{path:args.path,namespace:'fixture'}:null);b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks.get(args.path),loader:'tsx'}));}}]});
const main=phase==='before'?execFileSync('git',['show',baselineRevision+':src/main.tsx'],{encoding:'utf8'}):await readFile('src/main.tsx','utf8');
const cssFiles=[...new Set([...main.matchAll(/import ['"]([^'"]+\.css)['"]/g)].map(x=>'src/'+x[1].replace('./','')))];
const css=(await Promise.all([...new Set([...cssFiles,'src/shared-forms.css','src/bulk-selection.css','src/pickup-reports.css','src/action-dialog.css'])].map(p=>phase==='before'?execFileSync('git',['show',baselineRevision+':'+p],{encoding:'utf8'}):readFile(p,'utf8')))).join('\n');
const output=process.env.DESIGN_REVIEW_OUTPUT||'docs/deploy/design-phase1-review-20261020';await mkdir(output,{recursive:true});
let launchOptions={headless:true,args:['--lang=es-ES','--accept-lang=es-ES,es'],env:{...process.env,LANG:'es_ES.UTF-8',LC_ALL:'es_ES.UTF-8'}};
if(process.env.SHIPPING_CHROMIUM_PACKAGE==='1'){
 // tar --no-same-owner also works in containers that reject archive ownership.
 const {default:packaged}=await import('@sparticuz/chromium');
 const root=await mkdtemp(resolve(tmpdir(),'shipping-chromium-'));
 const bin=resolve(dirname(fileURLToPath(import.meta.resolve('@sparticuz/chromium'))),'../bin');
 for(const file of ['chromium.br','swiftshader.tar.br']){
  const data=brotliDecompressSync(await readFile(resolve(bin,file)));
  if(file.includes('.tar'))execFileSync('tar',['--no-same-owner','-x','-C',root],{input:data});
  else{await writeFile(resolve(root,'chromium'),data);await chmod(resolve(root,'chromium'),0o755);}
 }
 process.env.FONTCONFIG_PATH='/etc/fonts';
 process.env.LD_LIBRARY_PATH=[root,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
 launchOptions={...launchOptions,args:[...packaged.args.filter(arg=>arg!=='--single-process'&&!arg.startsWith('--lang=')&&!arg.startsWith('--accept-lang=')),'--lang=es-ES','--accept-lang=es-ES,es'],executablePath:resolve(root,'chromium')};
}
const browser=await chromium.launch(launchOptions);


const checks=[];
try {for(const screen of ['dashboard','orders'])for(const width of [390,1280,1440]){
 const page=await browser.newPage({locale:'es-ES',viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE',screen,width,e.message)});await page.route('**/*',r=>r.abort());
 await page.setContent('<html lang="es-ES"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script>'+bundled.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script></body></html>');
 await page.evaluate(s=>globalThis.renderFixture(s),screen);
 await page.locator('.stat').first().waitFor();
 if(screen==='dashboard')await page.getByText('12.345,67 €',{exact:true}).waitFor();
 if(screen==='orders'){await page.getByRole('button',{name:'Etiquetados',exact:true}).click();await page.getByText('63 pedidos · Página 1 de 3',{exact:true}).first().waitFor();}
 await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:output+'/'+phase+'-'+screen+'-'+width+'.png'});
 if(width===390){await page.evaluate(()=>scrollTo(0,1000));await page.screenshot({path:output+'/'+phase+'-'+screen+'-'+width+'-second.png'});await page.evaluate(()=>scrollTo(0,0));}
 const proof=await page.evaluate(({screen,width})=>{
 const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:r.height}};
 const cards=[...document.querySelectorAll('.stat')];const first=screen==='orders'?document.querySelector(width===390?'.ordersMobileList .bulkMobileSelectableRow':'.ordersTable tbody tr'):document.querySelector('.grid2 .card');
 const pending=cards.find(el=>el.querySelector('.statContent>span,div:last-child>span')?.textContent==='Pendientes');
 const pendingProof=pending?{value:Number(pending.querySelector('strong').textContent),warning:pending.classList.contains('dashboardPendingOrders'),background:getComputedStyle(pending).backgroundImage}:null;
 const actions=document.querySelector('.dsPageHeaderActions,.pageHead .actions');
 return {pending:pendingProof,firstKpi:rect(cards[0]),firstList:first?rect(first):null,firstListScreens:first?(first.getBoundingClientRect().top+scrollY)/innerHeight:null,cards:cards.map(el=>({text:el.innerText,...rect(el)})),actions:actions?{...rect(actions),overflow:actions.scrollWidth>actions.clientWidth,children:[...actions.children].map(el=>({text:el.textContent,...rect(el)}))}:null,controls:[...document.querySelectorAll('.pageHead button,.pageHead label,.sharedPeriodPanel button,.sharedPeriodPanel input,.ordersToolbar input,.ordersToolbar button')].map(el=>({text:el.textContent,label:el.getAttribute('aria-label'),type:el.getAttribute('type'),disabled:el.disabled??false})),cardOverflow:cards.some(el=>el.scrollWidth>el.clientWidth+1),overflow:document.documentElement.scrollWidth>innerWidth,kpiColumns:[...document.querySelectorAll('.kpiGrid,.stats')].map(el=>getComputedStyle(el).gridTemplateColumns)};
 },{screen,width});
 const failures=[...errors];
 if(width===390&&screen==='orders'&&(!proof.firstList||proof.firstList.y>=1800))failures.push('First list element must start before1800px');
 if(width===390&&proof.kpiColumns.some(c=>c.split(' ').length!==2))failures.push('Each mobile KPI family must have two columns');
 if(phase==='after'&&(!proof.pending||proof.pending.value!==63))failures.push('Fixture must exercise 63 pending orders');
 if(phase==='after'&&proof.pending?.value>0&&(!proof.pending.warning||!proof.pending.background.includes('linear-gradient')))failures.push('Pending orders must preserve the semantic warning even when overduePending is zero');
 if(proof.overflow)failures.push('Document horizontal overflow');
 if(proof.cardOverflow)failures.push('KPI card content overflows');
 if(phase==='after'&&width===390&&proof.actions&&Math.max(...proof.actions.children.map(c=>c.y))>=Math.min(...proof.actions.children.map(c=>c.y+c.height)))failures.push('Header actions must stay in one row');
 if(phase==='after'){
 const before=JSON.parse(await readFile(output+'/before-manifest.json','utf8')).checks.find(x=>x.screen===screen&&x.width===width);
 if(JSON.stringify(before.controls)!==JSON.stringify(proof.controls))failures.push('Filter/header controls or disabled states changed');
 if(JSON.stringify(before.cards.map(c=>c.text))!==JSON.stringify(proof.cards.map(c=>c.text)))failures.push('KPI information changed');
 }
 if(phase==='after'&&screen==='orders'&&width===390){
  const hint=page.locator('.dsActionsScrollHint');await hint.waitFor({state:'visible'});
  await page.locator('.dsPageHeaderActions').evaluate(el=>el.scrollTo({left:el.scrollWidth}));
  await hint.waitFor({state:'hidden'});
  await page.locator('.dsPageHeaderActions').evaluate(el=>el.scrollTo({left:0}));
  await hint.waitFor({state:'visible'});
 }
 if(phase==='after'&&screen==='orders'){
  const action=page.getByRole('button',{name:'Nuevo pedido',exact:true});await action.focus();
  const reachable=await action.evaluate(el=>{const r=el.getBoundingClientRect(),p=el.closest('.dsPageHeaderActions').getBoundingClientRect();return r.left>=p.left-1&&r.right<=p.right+1;});
  if(!reachable)failures.push('Offscreen header action cannot receive visible keyboard focus');
  await action.click();await page.getByRole('heading',{name:'Nuevo pedido manual',exact:true}).waitFor();
  await page.getByRole('button',{name:'Cancelar',exact:true}).last().click();
  const checkbox=page.locator(width===390?'.ordersMobileList .bulkSelectCheckbox input':'.ordersTable tbody .bulkSelectCheckbox input').first();await checkbox.check();
  await page.getByRole('button',{name:'Ver selección',exact:true}).click();await page.getByRole('dialog',{name:'Pedidos seleccionados'}).waitFor();
  if(!(await page.getByRole('dialog',{name:'Pedidos seleccionados'}).innerText()).includes('DEMO-001'))failures.push('Selection lost');
  await page.getByRole('button',{name:'Volver a pedidos',exact:true}).click();
 }
 if(phase==='after'&&width===390){
  await page.evaluate(()=>{document.documentElement.dataset.theme='dark';scrollTo(0,0)});
  await page.screenshot({path:output+'/after-'+screen+'-390-dark.png'});
  if(await page.locator('.stat').evaluateAll(cards=>cards.some(el=>el.scrollWidth>el.clientWidth+1)))failures.push('Dark KPI overflow');
 }
 checks.push({screen,width,...proof,failures});await page.close();
}
 if(phase==='after'){
  const page=await browser.newPage({locale:'es-ES',viewport:{width:390,height:1000}});await page.route('**/*',r=>r.abort());
  await page.setContent('<html lang="es-ES"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script>'+bundled.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script></body></html>');
  await page.evaluate(()=>globalThis.renderStress());await page.getByText('123.456,78 USD').waitFor();
  const overflow=await page.locator('.stat').evaluateAll(cards=>cards.some(el=>el.scrollWidth>el.clientWidth+1));
  await page.screenshot({path:output+'/after-multicurrency-390.png'});
  checks.push({screen:'multicurrency',width:390,failures:overflow?['Multi-currency card overflow']:[]});await page.close();
 }
}finally{await browser.close()}
await writeFile(output+'/'+phase+'-manifest.json',JSON.stringify({synthetic:true,networkBlocked:true,locale:'es-ES',baselineRevision,checks},null,2));console.log(JSON.stringify(checks.map(({cards,...x})=>x),null,2));if(phase==='after'&&checks.some(x=>x.failures.length))process.exitCode=1;
