// Offline review: real Orders, tracking history and global tariff action; no business writes.
// npm install --no-save --package-lock=false playwright@1.58.2
// npx playwright install chromium && node scripts/orders-visual-screenshots.mjs
// Restricted download fallback: npm install --no-save --package-lock=false playwright@1.58.2 @sparticuz/chromium@153.0.0
// SHIPPING_CHROMIUM_PACKAGE=1 node scripts/orders-visual-screenshots.mjs
import {build} from 'esbuild';
import {pickupLogoFixture} from './pickup-pdf-fixture.mjs';
import {mkdir,writeFile,mkdtemp,chmod} from 'node:fs/promises';
import {readReviewFile as readFile} from './review-file-loader.mjs';
import {brotliDecompressSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
const {chromium}=await import(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright/index.mjs');
const phase=process.argv[2]||'after';const baselineRevision='4a268924213ac29f9d1f74d5ca1b269d032aa5b9';
const source=phase==='before'?execFileSync('git',['show',baselineRevision+':src/pages/Orders.tsx'],{encoding:'utf8'}):await readFile('src/pages/Orders.tsx','utf8');
const tariffsPanel=await readFile('src/components/TransportTariffsPanel.tsx','utf8');
const mocks=new Map();
for(const match of (source+tariffsPanel).matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)){
 const [,clause,path]=match;
 if(!path.startsWith('../services/')&&!path.endsWith('SettingsContext'))continue;
 if(['orderStatus','filters','orderShipping','orderLabelFiles','shippingRuleCore','uiPreferences','formatting','shipmentTracking'].some(x=>path.endsWith('/'+x)))continue;
 const named=clause.match(/\{([\s\S]*?)\}/)?.[1]||'';
 const exports=named.split(',').map(x=>x.trim()).filter(x=>x&&!x.startsWith('type ')).map(x=>x.split(/\s+as\s+/).pop());
 mocks.set(path,(mocks.get(path)||'')+'\n'+exports.filter(x=>!(mocks.get(path)||'').includes('export const '+x+'=')).map(x=>`export const ${x}=(...args)=>globalThis.fixtureServices.${x}?.(...args);`).join('\n'));
}
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {Orders} from './src/pages/Orders';import {OrderLabelDefaults} from './src/components/OrderLabelDefaults';import {ActionDialogHost} from './src/components/ActionDialogHost';import {DEFAULT_APP_SETTINGS,DEFAULT_USER_PREFERENCES} from './src/services/settingsSchema';
if(!crypto.randomUUID)Object.defineProperty(crypto,'randomUUID',{value:()=> '00000000-0000-4000-8000-000000000042'});\nconst settings=structuredClone(DEFAULT_APP_SETTINGS);settings.orders.bulkScope='selected';settings.orders.refreshSeconds=600;settings.integrations.amazonEnabled=false;settings.integrations.shopifyEnabled=false;
const preferences={...DEFAULT_USER_PREFERENCES,pageSize:25,defaultPeriod:'all',rememberFilters:false};
const orders=Array.from({length:9},(_,i)=>({id:'demo-'+i,orderId:'DEMO-'+String(i+1).padStart(3,'0'),orderNumber:'DEMO-'+String(i+1).padStart(3,'0'),sourceChannel:i%2?'shopify':'amazon',sourceStatus:'shipped',customerName:'Cliente demostración '+(i+1),integrationName:i%2?'Tienda demo':'Amazon demo',orderStatus:'pending',status:'pending',statusName:'pending',shippingAddress:{name:'Cliente demostración',address_line_1:'Calle Ejemplo',house_number:'10',postal_code:i%3?'28013':'75001',city:i%3?'Madrid':'París',country_code:'ES',phone:'+34600000000'},destinationCountryCode:'ES',carrierName:i%2?'MRW':'Correos Express',carrier:i%2?'MRW':'Correos Express',items:[{name:'Producto sintético '+(i+1),sku:'DEMO-'+i,quantity:1}],orderCreatedAt:'2026-10-19T09:00:00Z',orderUpdatedAt:'2026-10-19T09:00:00Z',weightKg:1,totalAmount:24.9,currency:'EUR',trackingNumber:'TRACK-'+String(i+1).padStart(10,'0'),shippingLabelUrl:'fixture-label-'+i,shippingProvider:i%2?'mrw':'envia',labelCreatedAt:'2026-10-20T07:00:00Z',raw:{}}));
const states=['exception','in_transit','out_for_delivery','delivered','returned','pre_transit','cancelled','exception','in_transit'];const codes=['DELIVERY_FAILED','SHIPPED','DRIVER_ON_ROUTE','DELIVERED','Delivered at Origin','READY_TO_SEND','CANCELLED','ADDRESS_INVALID','SHIPPED'];
orders.forEach((o,i)=>Object.assign(o,{shippingProvider:i===4?'envia':i===5?'mrw':'sendcloud',trackingNormalizedState:states[i],trackingStatusCode:codes[i],trackingStatusMessage:i===4?'Delivered at Origin':i===0?'Destinatario ausente':'Estado comunicado por el transportista',trackingEventAt:i===8?null:'2026-10-18T08:15:00Z',trackingEventTimeRaw:i===8?'2026-10-21 20:16:11':null,trackingObservedAt:'2026-10-18T09:00:00Z',trackingMovementAt:'2026-10-18T08:15:00Z',trackingCheckedAt:'2026-10-22T07:00:00Z',trackingError:i===5?'MRW_TRACKING_PASSWORD_REQUIRED':null}));
${process.env.TRACKING_MRW_UNAVAILABLE==='1'?"Object.assign(orders[8],{shippingProvider:'mrw',carrierName:'MRW',trackingNormalizedState:null,trackingStatusCode:'SHIPPED',trackingStatusMessage:null,trackingEventAt:null,trackingEventTimeRaw:null,trackingObservedAt:null,trackingMovementAt:null,trackingError:'MRW_TRACKING_ACCESS_DENIED'});":''}
const emptyTransport={total:0,mrw:0,correos:0,valued:0,shipments:0,missing:0,basis:'recorded_only'};
const matches=p=>orders.filter(o=>(p.tracking==='all'||({exception:'issue',in_transit:'transit',out_for_delivery:'route',delivered:'delivered',returned:'returned',pre_transit:'ready',cancelled:'cancelled'}[o.trackingNormalizedState]||'none')===p.tracking)&&(p.channel==='all'||o.sourceChannel===p.channel)&&(p.country==='all'||o.destinationCountryCode===p.country)&&(p.carrier==='all'||o.carrierName.toLowerCase()===p.carrier)&&(!p.query||[o.orderNumber,o.customerName,o.items[0].name].join(' ').toLowerCase().includes(p.query.toLowerCase())));
globalThis.fixtureSelections=[];globalThis.fixtureRequests=[];globalThis.fixtureQuotes=[];globalThis.fixtureServices={confirmAction:async()=>true,useSettings:()=>({settings,preferences,patchPreferences:async()=>{},updateSection:async()=>{}}),watchFulfillmentOrders:()=>()=>{},loadShippingRules:async()=>[],defaultShippingRules:()=>[],listTransportTariffs:async()=>[],loadAmazonProductImages:async()=>({}),getSendcloudStatus:async()=>({configured:true,integrations:[]}),getEnviaStatus:async()=>({configured:false,accounts:[]}),fetchMatchingOrderIds:async p=>matches(p).map(o=>o.id),listSelectedOrdersForBulk:async(p,ids)=>{globalThis.fixtureSelections.push(ids);return orders.filter(o=>ids.includes(o.id));},fetchOrdersDashboardPage:async p=>{globalThis.fixtureRequests.push(p);let rows=matches(p);return {orders:rows.slice(p.page*p.pageSize,(p.page+1)*p.pageSize),total:rows.length,selectableTotal:rows.length,kpis:{pending:rows.length,amazon:rows.filter(o=>o.sourceChannel==='amazon').length,shopify:rows.filter(o=>o.sourceChannel==='shopify').length,manual:0,labelled:rows.length,shipped:0,cancelled:0,overduePending:0,preparablePending:rows.length,sales:{gross:rows.length*24.9,vat:rows.length*24.9*21/121,net:rows.length*24.9/1.21,count:rows.length,average:24.9},transport:emptyTransport},facets:{countries:['ES','FR'],carriers:['MRW','Correos Express']}}},getShippingOptions:async id=>{globalThis.fixtureQuotes.push(id);return {options:[{provider:'mrw',providerName:'MRW directo',carrierName:'MRW',carrierCode:'mrw',name:'Entrega 24 h',price:4.8,currency:'EUR',code:'0200'}]}},createOrderLabel:()=>{throw Error('Purchases disabled in offline fixture')}};

let saved=null;globalThis.pickupFixture={
 preview:async ids=>({items:orders.filter(o=>ids.includes(o.id)).map(o=>({orderId:o.id,orderNumber:o.orderNumber,channel:o.sourceChannel,carrier:o.carrierName,trackingNumber:globalThis.pickupInvalid&&o.id===ids[0]?'':o.trackingNumber,packages:1,packageCountEstimated:true,eligible:!(globalThis.pickupInvalid&&o.id===ids[0]),issue:globalThis.pickupInvalid&&o.id===ids[0]?'missing_tracking':null,previousReports:globalThis.pickupRepeated?['REC-2026-0001']:[]})),totalPackages:ids.length,canCreate:!globalThis.pickupInvalid}),
 create:async(ids,request,allow,counts)=>{saved={id:'report-42',number:'REC-2026-0042',createdAt:'2026-10-20T07:30:00Z',createdBy:'fixture-user',sender:{legalName:'ZENVIA COMMERCE SL',taxId:'B12345678',address:'Calle del Comercio 28, 28022 Madrid',email:'logistica@example.test',phone:'+34910000042'},items:orders.filter(o=>ids.includes(o.id)).map(o=>({orderId:o.id,orderNumber:o.orderNumber,channel:o.sourceChannel,carrier:o.carrierName,trackingNumber:o.trackingNumber,packages:counts[o.id]||1})),totalPackages:Object.values(counts).reduce((a,b)=>a+b,0)};return saved;},
 list:async(orderId)=>saved?[{id:saved.id,number:saved.number,createdAt:saved.createdAt,totalPackages:saved.totalPackages,totalOrders:saved.items.length,carriers:['MRW','Correos Express']}]:[],
 get:async()=>saved};
globalThis.fixtureServices.selectPickupOrderIds=async p=>matches(p).map(o=>o.id);
globalThis.fixtureServices.getOrderTrackingLink=async()=>({url:null});
globalThis.fixtureServices.loadShipmentTrackingEvents=async(id)=>${process.env.TRACKING_MRW_UNAVAILABLE==='1'?"id==='demo-8'?[]:":''}[
 {state:'exception',code:'DELIVERY_FAILED',message:'Destinatario ausente. Nuevo intento de entrega pendiente.',eventAt:'2026-10-18T08:15:00Z',eventTimeRaw:null,observedAt:'2026-10-18T09:00:00Z'},
 {state:'out_for_delivery',code:'DRIVER_ON_ROUTE',message:'El envío está en reparto.',eventAt:'2026-10-18T06:00:00Z',eventTimeRaw:null,observedAt:'2026-10-18T06:10:00Z'},
 {state:'in_transit',code:'SHIPPED',message:'Recogido por el transportista.',eventAt:'2026-10-17T15:30:00Z',eventTimeRaw:null,observedAt:'2026-10-17T15:40:00Z'}];

createRoot(document.getElementById('root')).render(<main className="main"><div style={{padding:24}}><p>Vista de revisión · datos sintéticos · sin conexión a proveedores</p><Orders/><ActionDialogHost/><OrderLabelDefaults/></div></main>);`;

mocks.set('../services/pickupReports',(mocks.get('../services/pickupReports')||'')+
 'export const previewPickupReport=(...a)=>globalThis.pickupFixture.preview(...a);export const createPickupReport=(...a)=>globalThis.pickupFixture.create(...a);export const listPickupReports=(...a)=>globalThis.pickupFixture.list(...a);export const getPickupReport=(...a)=>globalThis.pickupFixture.get(...a);');
mocks.set('./companyBranding', 'export const loadCompanyBranding=async()=>({logoDataUrl:'+JSON.stringify(pickupLogoFixture)+'});');
mocks.set('./supabase', 'export const supabase={};export const getActiveSupabase=()=>null;export const getActiveTenant=()=>null;');
mocks.delete('../services/actionDialog');
const bundled=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,loader:{'.css':'empty'},define:{'import.meta.env':'{}'},format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'offline-orders-fixture',setup(b){if(phase==='before')b.onLoad({filter:/[/]src[/]pages[/]Orders[.]tsx$/},()=>({contents:source,loader:'tsx',resolveDir:resolve('src/pages')}));b.onResolve({filter:/.*/},args=>mocks.has(args.path)?{path:args.path,namespace:'fixture'}:null);b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks.get(args.path),loader:'tsx'}));}}]});
const main=await readFile('src/main.tsx','utf8');
const cssFiles=[...new Set([...main.matchAll(/import ['"]([^'"]+\.css)['"]/g)].map(x=>'src/'+x[1].replace('./','')))];
const css=(await Promise.all([...new Set([...cssFiles,'src/shared-forms.css','src/bulk-selection.css','src/pickup-reports.css','src/action-dialog.css','src/components/transport-tariffs.css'])].map(p=>readFile(p,'utf8')))).join('\n');

const output=process.env.TRACKING_REVIEW_OUTPUT||(process.env.TRACKING_MRW_UNAVAILABLE==='1'?'docs/deploy/20261022-mrw-unavailable-review':'docs/deploy/20261022-tracking-review-v2');await mkdir(output,{recursive:true});const chrome=(await readFile('/workspace/scratch/c85f3e06d585/catalog-chromium-path.tmp','utf8')).trim();
const browser=await chromium.launch({headless:true,executablePath:chrome+'/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--lang=es-ES','--accept-lang=es-ES,es'],env:{...process.env,LD_LIBRARY_PATH:chrome,FONTCONFIG_PATH:'/etc/fonts',LANG:'es_ES.UTF-8',LC_ALL:'es_ES.UTF-8'}});const manifest=[];
try{for(const width of [390,1280,1440])for(const theme of ['light','dark']){
 const page=await browser.newPage({viewport:{width,height:1050},locale:'es-ES',timezoneId:'Europe/Madrid'}),errors=[],network=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack)});await page.route('**/*',r=>{if(r.request().url().startsWith('https://flagcdn.com/'))return r.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="18"><rect width="24" height="18" fill="#cbd5e1"/></svg>'});network.push(r.request().url());return r.abort()});
 await page.clock.setFixedTime(new Date('2026-10-22T10:00:00Z'));
 await page.setContent('<html lang="es-ES" data-theme="'+theme+'"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script>'+bundled.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script></body></html>');
 await page.getByRole('button',{name:'Todos',exact:true}).click();await page.locator(width===390?'.ordersMobileRow':'.ordersTable tbody tr').first().waitFor();
 const tariffButton=page.getByRole('button',{name:'Abrir tarifas de transporte'});await tariffButton.waitFor({state:'visible'});
 const header=page.locator('.pageHead');await header.screenshot({path:output+'/header-'+theme+'-'+width+'.png'});
 if(width>600){
  await page.locator('.ordersTable').evaluate(el=>{const th=[...el.querySelectorAll('th')].find(n=>n.textContent.includes('Seguimiento'));const card=el.closest('.ordersTableCard');card.scrollLeft=th.getBoundingClientRect().left-card.getBoundingClientRect().left+card.scrollLeft-160;});
  const cell=page.locator('.ordersTable .shipmentTrackingSummary').first();await cell.waitFor();
  const proof=await cell.evaluate(el=>{const r=el.getBoundingClientRect(),p=el.closest('.ordersTableCard').getBoundingClientRect();return {left:r.left,right:r.right,clipLeft:p.left,clipRight:p.right};});
  if(proof.left<proof.clipLeft||proof.right>proof.clipRight)throw Error('Tracking is clipped: '+JSON.stringify(proof));
  for(const label of ['Preparado','En tránsito','En reparto','Entregado','Incidencias','Devuelto','Cancelado'])if(!await page.locator('.ordersTable .ordersTracking').getByText(label,{exact:true}).count())throw Error('Missing normalized label '+label);
  await page.locator('.ordersTableCard').screenshot({path:output+'/tracking-seven-states-'+theme+'-'+width+'.png'});
 }
 await page.screenshot({path:output+'/'+phase+'-'+theme+'-'+width+'.png',fullPage:true});
 if(phase==='after'){
  if(!await page.getByText('Último movimiento: 18/10/2026, 10:15').count())throw Error('Missing provider event time');
  const row=page.locator(width===390?'.ordersMobileRow':'.ordersTable tbody tr').first();await row.click();
  await page.getByRole('heading',{name:'Historial de seguimiento',exact:true}).waitFor();await page.getByText('Destinatario ausente. Nuevo intento de entrega pendiente.',{exact:true}).waitFor();
  await page.locator('.ordersDrawer').screenshot({path:output+'/detail-history-'+theme+'-'+width+'.png'});
  await page.locator('.ordersDrawer').evaluate(el=>{el.scrollTop=el.scrollHeight});await page.locator('.ordersDrawer').screenshot({path:output+'/detail-events-'+theme+'-'+width+'.png'});
  await page.locator('.shipmentTrackingHistory').screenshot({path:output+'/history-events-'+theme+'-'+width+'.png'});
  await page.locator('.ordersDrawerHead .iconBtn').click();
  if(process.env.TRACKING_MRW_UNAVAILABLE==='1'){
   await page.locator(width===390?'.ordersMobileRow':'.ordersTable tbody tr').nth(8).click();
   await page.locator('.ordersDrawer').getByText('Sin seguimiento disponible',{exact:true}).waitFor();
   const manual=page.getByRole('link',{name:'Consultar manualmente en MRW'});await manual.waitFor();
   if(await manual.getAttribute('href')!=='https://www.mrw.es/seguimiento/')throw Error('Missing manual MRW form');
   await page.locator('.ordersDrawer').screenshot({path:output+'/mrw-unavailable-'+theme+'-'+width+'.png'});
   await page.locator('.ordersDrawerHead .iconBtn').click();
  }
  await page.getByRole('combobox',{name:'Filtrar por seguimiento'}).click();await page.getByRole('option',{name:'Incidencias',exact:true}).click();await page.getByText('2 pedidos · Página 1 de 1',{exact:true}).first().waitFor();
  await page.screenshot({path:output+'/after-incidents-'+theme+'-'+width+'.png',fullPage:true});
 }
 const geometry=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));if(geometry.scrollWidth>width||errors.length||network.length)throw Error(JSON.stringify({geometry,errors,network}));manifest.push({phase,width,theme,errors,network:network.length,synthetic:true});await page.close();
}}finally{await browser.close()}await writeFile(output+'/'+phase+'-manifest.json',JSON.stringify(manifest,null,2));console.log(JSON.stringify({phase,captures:manifest.length*(phase==='after'?6+(process.env.TRACKING_MRW_UNAVAILABLE==='1'?1:0):2)+4,errors:0,network:0}));
