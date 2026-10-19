// Offline visual fixtures: real LabelModal + production CSS; no provider calls or labels.
// npm install --no-save --package-lock=false playwright@1.58.2
// npx playwright install chromium && node scripts/shipping-visual-screenshots.mjs
// Restricted download fallback: npm install --no-save --package-lock=false playwright@1.58.2 @sparticuz/chromium@153.0.0
// SHIPPING_CHROMIUM_PACKAGE=1 node scripts/shipping-visual-screenshots.mjs
import {build} from 'esbuild';
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
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {Orders} from './src/pages/Orders';import {DEFAULT_APP_SETTINGS,DEFAULT_USER_PREFERENCES} from './src/services/settingsSchema';
const settings=structuredClone(DEFAULT_APP_SETTINGS);settings.orders.bulkScope='selected';settings.orders.refreshSeconds=600;settings.integrations.amazonEnabled=false;settings.integrations.shopifyEnabled=false;
const preferences={...DEFAULT_USER_PREFERENCES,pageSize:25,defaultPeriod:'all',rememberFilters:false};
const orders=Array.from({length:63},(_,i)=>({id:'demo-'+i,orderId:'DEMO-'+String(i+1).padStart(3,'0'),orderNumber:'DEMO-'+String(i+1).padStart(3,'0'),sourceChannel:i%2?'shopify':'amazon',customerName:'Cliente demostración '+(i+1),integrationName:i%2?'Tienda demo':'Amazon demo',orderStatus:'pending',status:'pending',statusName:'pending',shippingAddress:{name:'Cliente demostración',address_line_1:'Calle Ejemplo',house_number:'10',postal_code:i%3?'28013':'75001',city:i%3?'Madrid':'París',country_code:i%3?'ES':'FR',phone:'+34600000000'},destinationCountryCode:i%3?'ES':'FR',carrierName:i%2?'MRW':'Correos Express',carrier:i%2?'MRW':'Correos Express',items:[{name:'Producto sintético '+(i+1),sku:'DEMO-'+i,quantity:1}],orderCreatedAt:'2026-10-19T09:00:00Z',orderUpdatedAt:'2026-10-19T09:00:00Z',weightKg:1,totalAmount:24.9,currency:'EUR',trackingNumber:null,labelUrl:null,raw:{}}));
const emptyTransport={total:0,mrw:0,correos:0,valued:0,shipments:0,missing:0,basis:'recorded_only'};
globalThis.fixtureRequests=[];globalThis.fixtureQuotes=[];globalThis.fixtureServices={useSettings:()=>({settings,preferences,patchPreferences:async()=>{},updateSection:async()=>{}}),watchFulfillmentOrders:()=>()=>{},loadShippingRules:async()=>[],defaultShippingRules:()=>[],listTransportTariffs:async()=>[],loadAmazonProductImages:async()=>({}),getSendcloudStatus:async()=>({configured:true,integrations:[]}),getEnviaStatus:async()=>({configured:false,accounts:[]}),fetchOrdersDashboardPage:async p=>{globalThis.fixtureRequests.push(p);let rows=orders.filter(o=>(p.channel==='all'||o.sourceChannel===p.channel)&&(p.country==='all'||o.destinationCountryCode===p.country)&&(p.carrier==='all'||o.carrierName.toLowerCase()===p.carrier)&&(!p.query||[o.orderNumber,o.customerName,o.items[0].name].join(' ').toLowerCase().includes(p.query.toLowerCase())));return {orders:rows.slice(p.page*p.pageSize,(p.page+1)*p.pageSize),total:rows.length,kpis:{pending:rows.length,amazon:rows.filter(o=>o.sourceChannel==='amazon').length,shopify:rows.filter(o=>o.sourceChannel==='shopify').length,manual:0,labelled:0,shipped:0,cancelled:0,overduePending:0,preparablePending:rows.length,sales:{gross:rows.length*24.9,vat:rows.length*24.9*21/121,net:rows.length*24.9/1.21,count:rows.length,average:24.9},transport:emptyTransport},facets:{countries:['ES','FR'],carriers:['MRW','Correos Express']}}},getShippingOptions:async id=>{globalThis.fixtureQuotes.push(id);return {options:[{provider:'mrw',providerName:'MRW directo',carrierName:'MRW',carrierCode:'mrw',name:'Entrega 24 h',price:4.8,currency:'EUR',code:'0200'}]}},createOrderLabel:()=>{throw Error('Purchases disabled in offline fixture')}};
createRoot(document.getElementById('root')).render(<main className="main"><div style={{padding:24}}><p>Vista de revisión · datos sintéticos · sin conexión a proveedores</p><Orders/></div></main>);`;
const bundled=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,loader:{'.css':'empty'},define:{'import.meta.env':'{}'},format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'offline-orders-fixture',setup(b){b.onResolve({filter:/.*/},args=>args.importer.endsWith('/src/pages/Orders.tsx')&&mocks.has(args.path)?{path:args.path,namespace:'fixture'}:null);b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks.get(args.path),loader:'tsx'}));}}]});
const main=await readFile('src/main.tsx','utf8');
const cssFiles=[...new Set([...main.matchAll(/import ['"]([^'"]+\.css)['"]/g)].map(x=>'src/'+x[1].replace('./','')))];
const css=(await Promise.all([...new Set([...cssFiles,'src/shared-forms.css','src/bulk-selection.css'])].map(p=>readFile(p,'utf8')))).join('\n');
const output='artifacts/orders-visual';await mkdir(output,{recursive:true});
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

const manifest=[];
try{for(const device of [{name:'desktop',width:1440,height:1100},{name:'mobile',width:390,height:844}]){
 const page=await browser.newPage({viewport:{width:device.width,height:device.height},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>console.error(e.message)||errors.push(e.message));await page.route('**/*',route=>route.abort());
 await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script>'+bundled.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script></body></html>');
 await page.getByText('63 pedidos · Página 1 de 3',{exact:true}).first().waitFor();
 const rows=device.name==='desktop'?page.locator('.ordersTable tbody tr'):page.locator('.ordersMobileList .bulkMobileSelectableRow');
 if(await rows.count()!==25)throw Error('Expected 25 rows');
 await page.screenshot({path:output+'/orders-'+device.name+'.png',fullPage:true});
 await page.getByRole('button',{name:'Siguiente',exact:true}).first().click();await page.getByText('63 pedidos · Página 2 de 3',{exact:true}).first().waitFor();
 await page.screenshot({path:output+'/page-2-'+device.name+'.png',fullPage:true});
 await page.getByRole('button',{name:'Anterior',exact:true}).first().click();await page.getByText('63 pedidos · Página 1 de 3',{exact:true}).first().waitFor();
 const choose=async(label,option)=>{await page.getByRole('combobox',{name:label}).click();await page.getByRole('option',{name:option,exact:true}).click();};
 const total=async n=>page.getByText(n+' pedidos · Página 1 de '+Math.max(1,Math.ceil(n/25)),{exact:true}).first().waitFor();
 await page.getByPlaceholder('Buscar pedido, cliente, producto, tracking o transportista…').fill('DEMO-063');await total(1);await page.getByPlaceholder('Buscar pedido, cliente, producto, tracking o transportista…').fill('');await total(63);
 await choose('Filtrar por canal','Shopify');await total(31);await choose('Filtrar por canal','Todos los canales');await total(63);
 await choose('Filtrar por país de destino','Francia · FR');await total(21);await choose('Filtrar por país de destino','Todos los países');await total(63);
 await choose('Filtrar por transportista','MRW');await total(31);await choose('Filtrar por transportista','Todos los transportistas');await total(63);
 await page.getByRole('button',{name:'Seleccionar todos de esta página',exact:true}).click();
 await page.getByText('25 de 25 pedidos con etiqueta pendiente de esta página',{exact:true}).waitFor();
 await page.screenshot({path:output+'/selected-'+device.name+'.png',fullPage:true});
 await page.locator('.bulkSelectionToolbar').scrollIntoViewIfNeeded();await page.screenshot({path:output+'/selection-detail-'+device.name+'.png'});
 await page.locator('.bulkSelectionActions').getByRole('button',{name:'Generar etiquetas seleccionadas (25)',exact:true}).click();await page.getByRole('heading',{name:'Generar etiquetas en bloque'}).waitFor();await page.getByText('Compara los transportistas disponibles para los 25 pedidos y elige con cuál generar todas las etiquetas.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Generar todas',exact:true}).waitFor({state:'visible'});await page.waitForFunction(()=>globalThis.fixtureQuotes.length===25);
 await page.locator('.modalBackdrop').last().screenshot({path:output+'/generate-selected-'+device.name+'.png'});
 await page.getByRole('button',{name:'Cancelar',exact:true}).click();await page.getByRole('button',{name:'Siguiente',exact:true}).first().click();await page.getByText('63 pedidos · Página 2 de 3',{exact:true}).first().waitFor();await page.getByText('0 de 25 pedidos con etiqueta pendiente de esta página',{exact:true}).waitFor();
 if(errors.length)throw Error(errors.join('\n'));manifest.push({device:device.name,rows:25,total:63,filters:['search:1','shopify:31','FR:21','MRW:31'],quotes:25,selectionClearedOnPage:true,errors});await page.close();
}}finally{await browser.close();}
await writeFile(output+'/manifest.json',JSON.stringify({note:'Actual Orders component and production CSS. Synthetic service responses. All network blocked. Generate selected opens quote preview only; no purchase confirmation.',checks:manifest},null,2));console.log(JSON.stringify(manifest));
