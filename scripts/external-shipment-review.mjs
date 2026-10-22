// Actual OrderDrawer and @zenvia/ui form. Offline synthetic data only.
import {build} from 'esbuild';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {assertHeaderActionsPreserved} from './header-actions-contract.mjs';
const {chromium}=await import(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright/index.mjs');
const baseline=process.env.EXTERNAL_BASELINE||'0ae9622b1da1bf6f0901b6c27a4bb2982ac67750';
const output='docs/deploy/20261022-external-shipment-review';await mkdir(output,{recursive:true});
const baselineSource=execFileSync('git',['show',baseline+':src/pages/Orders.tsx'],{encoding:'utf8'});
const afterSource=await readFile('src/pages/Orders.tsx','utf8');
const manifest=[];const beforeActions=new Map();
const browser=await chromium.launch({headless:true,executablePath:process.env.EXTERNAL_CHROMIUM||'/tmp/bank-account-chromium-6A9MPq/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],env:{...process.env,LD_LIBRARY_PATH:'/tmp/bank-account-chromium-6A9MPq'}});
try{for(const phase of ['before','after']){
 const source=phase==='before'?baselineSource:afterSource,mocks=new Map();
 for(const match of (source+await readFile('src/components/TransportTariffsPanel.tsx','utf8')).matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)){
  const [,clause,path]=match;if(!path.startsWith('../services/')&&!path.endsWith('SettingsContext'))continue;
  if(['orderStatus','filters','orderShipping','orderLabelFiles','shippingRuleCore','uiPreferences','formatting','shipmentTracking','pluralization','ordersWorkbench'].some(x=>path.endsWith('/'+x)))continue;
  const exports=(clause.match(/\{([\s\S]*?)\}/)?.[1]||'').split(',').map(x=>x.trim()).filter(x=>x&&!x.startsWith('type ')).map(x=>x.split(/\s+as\s+/).pop());
  mocks.set(path,(mocks.get(path)||'')+'\n'+exports.filter(x=>!(mocks.get(path)||'').includes('export const '+x+'=')).map(x=>`export const ${x}=(...args)=>globalThis.fixtureServices.${x}?.(...args);`).join('\n'));
 }
 mocks.set('../services/pickupReports',`export const listPickupReports=async()=>[];export const getPickupReport=async()=>null;export const previewPickupReport=async()=>null;export const createPickupReport=()=>{throw Error('blocked')};`);
 mocks.set('./supabase',`export const supabase={};export const getActiveSupabase=()=>null;export const getActiveTenant=()=>null;`);
 const main=await readFile('src/main.tsx','utf8');const cssImports=[...main.matchAll(/import ['"]([^'"]+\.css)['"]/g)].map(x=>`import './src/${x[1].replace('./','')}';`).join('\n');
 const entry=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{OrderDrawer}from'./src/pages/Orders';import{ExternalShipmentModal}from'./src/components/ExternalShipmentModal';import{DEFAULT_APP_SETTINGS}from'./src/services/settingsSchema';${cssImports}
 if(!crypto.randomUUID)Object.defineProperty(crypto,'randomUUID',{value:()=> '00000000-0000-4000-8000-000000000042'});const settings=structuredClone(DEFAULT_APP_SETTINGS);globalThis.fixtureServices={useSettings:()=>({settings}),getOrderTrackingLink:async()=>({url:null}),loadShipmentTrackingEvents:async()=>[]};
 const order={id:'synthetic-order',orderNumber:'DEMO-2026-001',orderId:'synthetic',sourceChannel:'shopify',sourceStatus:'unshipped',integrationName:'Tienda de demostración',orderCreatedAt:'2026-10-22T08:00:00Z',totalAmount:49.9,currency:'EUR',weightKg:0.89,shippingAddress:{name:'Cliente de prueba',address_line_1:'Calle Ejemplo 10',postal_code:'28013',city:'Madrid',country_code:'ES'},customerName:'Cliente de prueba',items:[{name:'Producto de demostración',sku:'DEMO',quantity:1}],pickupReports:[]};
 globalThis.calls=[];function App(){const [modal,setModal]=useState(false),[kind,setKind]=useState('pending');globalThis.setScenario=setKind;
 const current=kind==='labelled'?{...order,labelCreatedAt:'2026-10-22T09:00:00Z',shippingRemoteId:'demo-remote',trackingNumber:'SYNTHETIC',carrierName:'MRW',shippingProvider:'mrw'}:kind==='external'?{...order,sourceStatus:'shipped',fulfilledAt:'2026-10-22T09:00:00Z',trackingNumber:'SYNTHETIC',carrierName:'MRW',shippingProvider:'mrw',shippingCostSource:'external_manual'}:order;
 return <main className="main"><OrderDrawer order={current} shippingPrice={null} validationIssues={[]} productImages={{}} busy={false} onClose={()=>{}} onPrepare={()=>globalThis.calls.push('prepare')} onEdit={()=>globalThis.calls.push('edit')} onPrint={()=>globalThis.calls.push('print')} onDownload={()=>globalThis.calls.push('download')} onInvoice={()=>globalThis.calls.push('invoice')} onConfirmShipment={()=>globalThis.calls.push('confirm')} onRegisterExternal={()=>setModal(true)}/>{modal&&<ExternalShipmentModal order={order} accounts={[{id:'demo-account',provider:'mrw',displayName:'MRW · Contrato propio',enabled:true,status:'connected'}]} onClose={()=>setModal(false)} onSave={async input=>{globalThis.calls.push(input);setModal(false);setKind('external')}}/>}</main>};createRoot(document.getElementById('root')).render(<App/>);`;
 const bundled=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},outdir:'out',bundle:true,write:false,define:{'import.meta.env':'{}'},format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'offline-review',setup(b){b.onLoad({filter:/[/]src[/]pages[/]Orders[.]tsx$/},()=>({contents:source,loader:'tsx',resolveDir:resolve('src/pages')}));b.onResolve({filter:/.*/},args=>mocks.has(args.path)?{path:args.path,namespace:'fixture'}:null);b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks.get(args.path),loader:'tsx'}));}}]});
 const js=bundled.outputFiles.find(x=>x.path.endsWith('.js')).text,css=bundled.outputFiles.find(x=>x.path.endsWith('.css')).text;
 for(const width of [390,1280,1440])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height:1000},timezoneId:'Europe/Madrid'}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith('https://flagcdn.com/')?r.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16"><path fill="#ad1519" d="M0 0h24v16H0z"/><path fill="#fabd00" d="M0 4h24v8H0z"/></svg>'}):r.abort());await page.clock.setFixedTime(new Date('2026-10-22T10:00:00Z'));
  await page.setContent(`<html lang="es" data-theme="${theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${js.replaceAll('</script','<\\/script')}</script></body></html>`);
  await page.locator('.ordersDrawer').waitFor();
  for(const kind of ['pending','labelled']){
   await page.evaluate(kind=>globalThis.setScenario(kind),kind);await page.waitForTimeout(30);
   const actions=await page.locator('.ordersDrawer button').evaluateAll(es=>es.map(e=>({name:(e.getAttribute('aria-label')||e.textContent).trim(),disabled:e.disabled})));
   const key=width+theme+kind;if(phase==='before')beforeActions.set(key,actions);else{assertHeaderActionsPreserved(beforeActions.get(key).map(a=>a.name),actions.map(a=>a.name),key);for(const before of beforeActions.get(key)){if(!actions.some(a=>a.name===before.name&&a.disabled===before.disabled))throw Error('Disabled action changed '+key)}}
   manifest.push({phase,width,theme,kind,actions,errors});
   if(kind==='pending')await page.screenshot({path:`${output}/${phase}-detail-${theme}-${width}.png`});
  }
  if(phase==='after'){
   await page.evaluate(()=>globalThis.setScenario('pending'));await page.getByRole('button',{name:'Registrar envío externo',exact:true}).click();
   await page.getByLabel('Transportista *').fill('MRW');await page.getByLabel('Tracking *').fill('SYNTHETIC-000123');
   await page.getByRole('combobox',{name:'Cuenta o integración (opcional)'}).click();await page.getByRole('option',{name:'MRW · Contrato propio · MRW',exact:true}).click();await page.getByLabel('Coste (EUR, opcional)').fill('4.50');
   await page.locator('.formModalBody').evaluate(el=>el.scrollTop=0);await page.screenshot({path:`${output}/after-modal-${theme}-${width}.png`});
   if(width===390){await page.getByRole('checkbox').scrollIntoViewIfNeeded();await page.screenshot({path:`${output}/after-modal-confirmation-${theme}-${width}.png`});}
   const dialog=page.getByRole('dialog',{name:'Registrar envío externo'});const overflow=await dialog.evaluate(el=>el.scrollWidth>el.clientWidth+1);if(overflow)throw Error('Modal horizontal overflow');
   const checkbox=page.getByRole('checkbox');if(await checkbox.isChecked())throw Error('Notification enabled by default');
   await page.getByRole('button',{name:'Registrar envío',exact:true}).click();await page.getByText('Envío externo',{exact:true}).waitFor();await page.getByRole('heading',{name:'Expedición',exact:true}).waitFor();if(await page.getByRole('button',{name:'Preparar etiqueta',exact:true}).count())throw Error('External shipment is still preparable');
   if(await page.getByRole('button',{name:'Imprimir',exact:true}).count()||await page.getByRole('button',{name:'Descargar',exact:true}).count())throw Error('External shipment offers a nonexistent label');
   const calls=await page.evaluate(()=>globalThis.calls);if(calls.length!==1||calls[0].notifySource!==false||calls[0].accountId!=='demo-account')throw Error('Unexpected side effect');
   await page.screenshot({path:`${output}/after-registered-${theme}-${width}.png`});if(width===390){await page.getByText('SYNTHETIC',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:`${output}/after-tracking-${theme}-${width}.png`});}
  }
  if(errors.length)throw Error(errors.join('\n'));await page.close();
 }
 }
 await writeFile(output+'/manifest.json',JSON.stringify(manifest,null,2));console.log('Before/after: 390/1280/1440, light/dark; existing action inventory preserved; source notification off; no real network.');
}finally{await browser.close()}
