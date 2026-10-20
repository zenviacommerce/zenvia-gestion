// Offline visual fixtures: real LabelModal + production CSS; no provider calls or labels.
// npm install --no-save --package-lock=false playwright@1.58.2
// npx playwright install chromium && node scripts/orders-visual-screenshots.mjs
// Restricted download fallback: npm install --no-save --package-lock=false playwright@1.58.2 @sparticuz/chromium@153.0.0
// SHIPPING_CHROMIUM_PACKAGE=1 node scripts/orders-visual-screenshots.mjs
import {build} from 'esbuild';
import {pickupLogoFixture} from './pickup-pdf-fixture.mjs';
import {readFile,mkdir,writeFile,mkdtemp,chmod} from 'node:fs/promises';
import {brotliDecompressSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
const source=await readFile('src/pages/Orders.tsx','utf8');
const mocks=new Map();
for(const match of source.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)){
 const [,clause,path]=match;
 if(!path.startsWith('../services/')&&!path.endsWith('SettingsContext'))continue;
 if(['orderStatus','filters','orderShipping','orderLabelFiles','shippingRuleCore','uiPreferences','formatting'].some(x=>path.endsWith('/'+x)))continue;
 const named=clause.match(/\{([\s\S]*?)\}/)?.[1]||'';
 const exports=named.split(',').map(x=>x.trim()).filter(x=>x&&!x.startsWith('type ')).map(x=>x.split(/\s+as\s+/).pop());
 mocks.set(path,(mocks.get(path)||'')+'\n'+exports.map(x=>`export const ${x}=(...args)=>globalThis.fixtureServices.${x}?.(...args);`).join('\n'));
}
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {Orders} from './src/pages/Orders';import {ActionDialogHost} from './src/components/ActionDialogHost';import {DEFAULT_APP_SETTINGS,DEFAULT_USER_PREFERENCES} from './src/services/settingsSchema';
if(!crypto.randomUUID)Object.defineProperty(crypto,'randomUUID',{value:()=> '00000000-0000-4000-8000-000000000042'});\nconst settings=structuredClone(DEFAULT_APP_SETTINGS);settings.orders.bulkScope='selected';settings.orders.refreshSeconds=600;settings.integrations.amazonEnabled=false;settings.integrations.shopifyEnabled=false;
const preferences={...DEFAULT_USER_PREFERENCES,pageSize:25,defaultPeriod:'all',rememberFilters:false};
const orders=Array.from({length:63},(_,i)=>({id:'demo-'+i,orderId:'DEMO-'+String(i+1).padStart(3,'0'),orderNumber:'DEMO-'+String(i+1).padStart(3,'0'),sourceChannel:i%2?'shopify':'amazon',sourceStatus:'unshipped',customerName:'Cliente demostración '+(i+1),integrationName:i%2?'Tienda demo':'Amazon demo',orderStatus:'pending',status:'pending',statusName:'pending',shippingAddress:{name:'Cliente demostración',address_line_1:'Calle Ejemplo',house_number:'10',postal_code:i%3?'28013':'75001',city:i%3?'Madrid':'París',country_code:i%3?'ES':'FR',phone:'+34600000000'},destinationCountryCode:i%3?'ES':'FR',carrierName:i%2?'MRW':'Correos Express',carrier:i%2?'MRW':'Correos Express',items:[{name:'Producto sintético '+(i+1),sku:'DEMO-'+i,quantity:1}],orderCreatedAt:'2026-10-19T09:00:00Z',orderUpdatedAt:'2026-10-19T09:00:00Z',weightKg:1,totalAmount:24.9,currency:'EUR',trackingNumber:'TRACK-'+String(i+1).padStart(10,'0'),shippingLabelUrl:'fixture-label-'+i,shippingProvider:i%2?'mrw':'envia',labelCreatedAt:'2026-10-20T07:00:00Z',raw:{}}));
const emptyTransport={total:0,mrw:0,correos:0,valued:0,shipments:0,missing:0,basis:'recorded_only'};
const matches=p=>orders.filter(o=>(p.channel==='all'||o.sourceChannel===p.channel)&&(p.country==='all'||o.destinationCountryCode===p.country)&&(p.carrier==='all'||o.carrierName.toLowerCase()===p.carrier)&&(!p.query||[o.orderNumber,o.customerName,o.items[0].name].join(' ').toLowerCase().includes(p.query.toLowerCase())));
globalThis.fixtureSelections=[];globalThis.fixtureRequests=[];globalThis.fixtureQuotes=[];globalThis.fixtureServices={confirmAction:async()=>true,useSettings:()=>({settings,preferences,patchPreferences:async()=>{},updateSection:async()=>{}}),watchFulfillmentOrders:()=>()=>{},loadShippingRules:async()=>[],defaultShippingRules:()=>[],listTransportTariffs:async()=>[],loadAmazonProductImages:async()=>({}),getSendcloudStatus:async()=>({configured:true,integrations:[]}),getEnviaStatus:async()=>({configured:false,accounts:[]}),fetchMatchingOrderIds:async p=>matches(p).map(o=>o.id),listSelectedOrdersForBulk:async(p,ids)=>{globalThis.fixtureSelections.push(ids);return orders.filter(o=>ids.includes(o.id));},fetchOrdersDashboardPage:async p=>{globalThis.fixtureRequests.push(p);let rows=matches(p);return {orders:rows.slice(p.page*p.pageSize,(p.page+1)*p.pageSize),total:rows.length,selectableTotal:rows.length,kpis:{pending:rows.length,amazon:rows.filter(o=>o.sourceChannel==='amazon').length,shopify:rows.filter(o=>o.sourceChannel==='shopify').length,manual:0,labelled:rows.length,shipped:0,cancelled:0,overduePending:0,preparablePending:rows.length,sales:{gross:rows.length*24.9,vat:rows.length*24.9*21/121,net:rows.length*24.9/1.21,count:rows.length,average:24.9},transport:emptyTransport},facets:{countries:['ES','FR'],carriers:['MRW','Correos Express']}}},getShippingOptions:async id=>{globalThis.fixtureQuotes.push(id);return {options:[{provider:'mrw',providerName:'MRW directo',carrierName:'MRW',carrierCode:'mrw',name:'Entrega 24 h',price:4.8,currency:'EUR',code:'0200'}]}},createOrderLabel:()=>{throw Error('Purchases disabled in offline fixture')}};

let saved=null;globalThis.pickupFixture={
 preview:async ids=>({items:orders.filter(o=>ids.includes(o.id)).map(o=>({orderId:o.id,orderNumber:o.orderNumber,channel:o.sourceChannel,carrier:o.carrierName,trackingNumber:globalThis.pickupInvalid&&o.id===ids[0]?'':o.trackingNumber,packages:1,packageCountEstimated:true,eligible:!(globalThis.pickupInvalid&&o.id===ids[0]),issue:globalThis.pickupInvalid&&o.id===ids[0]?'missing_tracking':null,previousReports:globalThis.pickupRepeated?['REC-2026-0001']:[]})),totalPackages:ids.length,canCreate:!globalThis.pickupInvalid}),
 create:async(ids,request,allow,counts)=>{saved={id:'report-42',number:'REC-2026-0042',createdAt:'2026-10-20T07:30:00Z',createdBy:'fixture-user',sender:{legalName:'ZENVIA COMMERCE SL',taxId:'B12345678',address:'Calle del Comercio 28, 28022 Madrid',email:'logistica@example.test',phone:'+34910000042'},items:orders.filter(o=>ids.includes(o.id)).map(o=>({orderId:o.id,orderNumber:o.orderNumber,channel:o.sourceChannel,carrier:o.carrierName,trackingNumber:o.trackingNumber,packages:counts[o.id]||1})),totalPackages:Object.values(counts).reduce((a,b)=>a+b,0)};return saved;},
 list:async(orderId)=>saved?[{id:saved.id,number:saved.number,createdAt:saved.createdAt,totalPackages:saved.totalPackages,totalOrders:saved.items.length,carriers:['MRW','Correos Express']}]:[],
 get:async()=>saved};
globalThis.fixtureServices.selectPickupOrderIds=async p=>matches(p).map(o=>o.id);

createRoot(document.getElementById('root')).render(<main className="main"><div style={{padding:24}}><p>Vista de revisión · datos sintéticos · sin conexión a proveedores</p><Orders/><ActionDialogHost/></div></main>);`;

mocks.set('../services/pickupReports',(mocks.get('../services/pickupReports')||'')+
 'export const previewPickupReport=(...a)=>globalThis.pickupFixture.preview(...a);export const createPickupReport=(...a)=>globalThis.pickupFixture.create(...a);export const listPickupReports=(...a)=>globalThis.pickupFixture.list(...a);export const getPickupReport=(...a)=>globalThis.pickupFixture.get(...a);');
mocks.set('./companyBranding', 'export const loadCompanyBranding=async()=>({logoDataUrl:'+JSON.stringify(pickupLogoFixture)+'});');
mocks.set('./supabase', 'export const supabase={};export const getActiveSupabase=()=>null;export const getActiveTenant=()=>null;');
mocks.delete('../services/actionDialog');
const bundled=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,loader:{'.css':'empty'},define:{'import.meta.env':'{}'},format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'offline-orders-fixture',setup(b){b.onResolve({filter:/.*/},args=>mocks.has(args.path)?{path:args.path,namespace:'fixture'}:null);b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks.get(args.path),loader:'tsx'}));}}]});
const main=await readFile('src/main.tsx','utf8');
const cssFiles=[...new Set([...main.matchAll(/import ['"]([^'"]+\.css)['"]/g)].map(x=>'src/'+x[1].replace('./','')))];
const css=(await Promise.all([...new Set([...cssFiles,'src/shared-forms.css','src/bulk-selection.css','src/pickup-reports.css','src/action-dialog.css'])].map(p=>readFile(p,'utf8')))).join('\n');
const output='docs/deploy/orders-selection-review-20261020';await mkdir(output,{recursive:true});
let launchOptions={headless:true};
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
 launchOptions={...launchOptions,args:packaged.args.filter(arg=>arg!=='--single-process'),executablePath:resolve(root,'chromium')};
}
const browser=await chromium.launch(launchOptions);


const checks=[];
try{for(const device of [{name:'desktop',width:1440,height:1050},{name:'mobile',width:390,height:844}]){
 const page=await browser.newPage({viewport:{width:device.width,height:device.height}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());
 await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script>'+bundled.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script></body></html>');
 await page.getByRole('button',{name:'Etiquetados',exact:true}).click();await page.getByText('63 pedidos · Página 1 de 3',{exact:true}).first().waitFor();
 const rowChecks=()=>page.locator(device.name==='mobile'?'.ordersMobileList input[type=checkbox]':'.ordersTable tbody input[type=checkbox]');
 for(let i=0;i<3;i++)await rowChecks().nth(i).check();
 await page.getByRole('button',{name:'Generar informe de recogida (3)',exact:true}).waitFor();
 await page.getByPlaceholder('Buscar pedido, cliente, producto, tracking o transportista…').fill('DEMO-004');await page.getByText('1 pedidos · Página 1 de 1',{exact:true}).first().waitFor();await rowChecks().first().check();
 await page.getByRole('button',{name:'Generar informe de recogida (4)',exact:true}).waitFor();await page.locator('.bulkSelectionToolbar').scrollIntoViewIfNeeded();await page.screenshot({path:output+'/search-add-fourth-'+device.name+'.png'});
 await page.getByRole('button',{name:'Ver selección',exact:true}).click();await page.getByRole('dialog',{name:'Pedidos seleccionados'}).waitFor();await page.getByText('DEMO-001 · Amazon',{exact:true}).waitFor();await page.screenshot({path:output+'/view-selection-'+device.name+'.png'});await page.getByRole('button',{name:'Cerrar selección',exact:true}).click();
 await page.getByRole('button',{name:'Generar informe de recogida (4)',exact:true}).click();await page.getByRole('heading',{name:'Incluir pedidos fuera de esta vista'}).waitFor();await page.screenshot({path:output+'/confirm-hidden-'+device.name+'.png'});
 await page.getByRole('button',{name:'Continuar con los 4',exact:true}).click();await page.getByRole('dialog',{name:'Informe de recogida',exact:true}).waitFor();await page.getByText('TRACK-0000000001',{exact:true}).waitFor();await page.screenshot({path:output+'/preview-four-'+device.name+'.png'});await page.getByRole('button',{name:'Cerrar informe de recogida',exact:true}).click();
 await page.getByPlaceholder('Buscar pedido, cliente, producto, tracking o transportista…').fill('');await page.getByText('63 pedidos · Página 1 de 3',{exact:true}).first().waitFor();await page.locator('.bulkSelectionToolbar').scrollIntoViewIfNeeded();await page.screenshot({path:output+'/indeterminate-'+device.name+'.png'});
 await page.getByRole('button',{name:'Siguiente',exact:true}).first().click();await page.getByText('63 pedidos · Página 2 de 3',{exact:true}).first().waitFor();await page.getByRole('button',{name:'Generar informe de recogida (4)',exact:true}).waitFor();await page.locator('.bulkSelectionToolbar').scrollIntoViewIfNeeded();await page.screenshot({path:output+'/page-two-preserved-'+device.name+'.png'});
 await page.getByRole('button',{name:'Quitar selección',exact:true}).click();if(!await page.getByRole('button',{name:'Generar informe de recogida (0)',exact:true}).isDisabled())throw Error('Zero selection must be disabled');await page.screenshot({path:output+'/zero-disabled-'+device.name+'.png'});
 const calls=await page.evaluate(()=>({purchases:globalThis.fixtureQuotes.length,selected:globalThis.fixtureSelections}));if(calls.purchases)throw Error('Unexpected provider quote');if(errors.length)throw Error(errors.join(' / '));checks.push({device:device.name,selectedBeforeSearch:3,selectedAfterSearch:4,completePreview:true,pagePersistence:true,purchases:0,errors});await page.close();
}}finally{await browser.close()}
await writeFile(output+'/manifest.json',JSON.stringify({synthetic:true,networkBlocked:true,checks},null,2));console.log(JSON.stringify(checks));
