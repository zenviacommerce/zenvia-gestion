// Actual OrderDrawer + recovery component, deterministic offline service boundaries.
// Never calls a database/carrier or creates a real shipment/document.
import {build} from 'esbuild';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright/index.mjs');
const baseline='c12d090',out='docs/deploy/20261023-shipping-reconciliation-review';
await mkdir(out,{recursive:true});
const manifest=[],actions=new Map();
const browser=await chromium.launch({headless:true,executablePath:'/tmp/zenvia-chromium/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],env:{...process.env,LD_LIBRARY_PATH:'/tmp/zenvia-chromium'}});
try{for(const phase of ['before','after']){
 const source=phase==='before'?execFileSync('git',['show',baseline+':src/pages/Orders.tsx'],{encoding:'utf8'}):await readFile('src/pages/Orders.tsx','utf8');
 const mocks=new Map();
 for(const match of (source+await readFile('src/components/TransportTariffsPanel.tsx','utf8')).matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)){
  const [,clause,path]=match;if(!path.startsWith('../services/')&&!path.endsWith('SettingsContext'))continue;
  if(['orderStatus','filters','orderShipping','orderLabelFiles','shippingRuleCore','uiPreferences','formatting','shipmentTracking','pluralization','ordersWorkbench','orderRelabel','pickupDocumentState','orderDispatch'].some(x=>path.endsWith('/'+x)))continue;
  const names=(clause.match(/\{([\s\S]*?)\}/)?.[1]||'').split(',').map(x=>x.trim()).filter(x=>x&&!x.startsWith('type ')).map(x=>x.split(/\s+as\s+/).pop());
  mocks.set(path,(mocks.get(path)||'')+'\n'+names.filter(x=>!(mocks.get(path)||'').includes('export const '+x+'=')).map(x=>`export const ${x}=(...args)=>globalThis.fixtureServices.${x}?.(...args);`).join('\n'));
 }
 mocks.set('../services/orderShipmentHistory','export const loadOrderShipmentHistory=async()=>[];');
 mocks.set('../services/pickupReports','export const listPickupReports=async()=>[];export const getPickupReport=async()=>null;export const previewPickupReport=async()=>null;export const createPickupReports=()=>{throw Error("blocked")};');
 mocks.set('./supabase','export const getActiveSupabase=()=>null;export const getActiveTenant=()=>null;export const supabase={};');
 const main=await readFile('src/main.tsx','utf8'),cssImports=[...main.matchAll(/import ['"]([^'"]+\.css)['"]/g)].map(x=>`import './src/${x[1].replace('./','')}';`).join('\n');
 const entry=`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{OrderDrawer}from'./src/pages/Orders';import{DEFAULT_APP_SETTINGS}from'./src/services/settingsSchema';${cssImports}
 const settings=structuredClone(DEFAULT_APP_SETTINGS);globalThis.fixtureServices={useSettings:()=>({settings}),getOrderTrackingLink:async()=>({url:null}),loadShipmentTrackingEvents:async()=>[]};globalThis.calls=[];
 const base={id:'synthetic-order',orderNumber:'DEMO-RECOVERY-001',orderId:'synthetic',sourceChannel:'shopify',sourceStatus:'unshipped',integrationName:'Tienda de demostración',orderCreatedAt:'2026-10-23T08:00:00Z',totalAmount:49.9,currency:'EUR',weightKg:.89,shippingAddress:{name:'Cliente de prueba',address_line_1:'Calle Ejemplo 10',postal_code:'28013',city:'Madrid',country_code:'ES'},customerName:'Cliente de prueba',items:[{name:'Producto de demostración',sku:'DEMO',quantity:1}],pickupReports:[]};
 function App(){const [order,setOrder]=useState({...base,trackingStatusCode:'MRW_CREATING'});globalThis.fixtureSet=kind=>{globalThis.fixtureResult='pending';setOrder({...base,...(kind==='labelled'?{logisticsState:'labelled',logisticsIdentity:'synthetic-label',trackingNumber:'SYNTHETIC-RECOVERED-000123',shippingRemoteId:'synthetic-reference',shippingProvider:'mrw',labelCreatedAt:'2026-10-23T08:01:00Z',trackingStatusCode:'READY_TO_SEND',carrierName:'MRW',carrierCode:'mrw'}:kind==='pending'?{}:{trackingStatusCode:kind.toUpperCase()+'_CREATING'})})};
 return <main className="main"><OrderDrawer order={order} shippingPrice={null} validationIssues={[]} productImages={{}} busy={false} onClose={()=>{}} onPrepare={()=>globalThis.calls.push('prepare')} onEdit={()=>globalThis.calls.push('edit')} onPrint={()=>globalThis.calls.push('print')} onDownload={()=>globalThis.calls.push('download')} onInvoice={()=>globalThis.calls.push('invoice')} onConfirmShipment={()=>globalThis.calls.push('confirm')} onRegisterExternal={()=>globalThis.calls.push('external')} onMarkSent={()=>globalThis.calls.push('mark')} onReconcile={async()=>{globalThis.calls.push('check');await new Promise(r=>setTimeout(r,40));const result=globalThis.fixtureResult;if(result==='error')throw Error('No se pudo completar la comprobación. El envío continúa protegido frente a duplicados.');if(result==='recovered')setOrder({...base,logisticsState:'labelled',logisticsIdentity:'synthetic-label',trackingNumber:'SYNTHETIC-RECOVERED-000123',shippingRemoteId:'synthetic-reference',shippingProvider:'mrw',labelCreatedAt:'2026-10-23T08:01:00Z',trackingStatusCode:'READY_TO_SEND',carrierName:'MRW',carrierCode:'mrw'});if(result==='released')setOrder({...base});return {status:result,provider:'mrw',orderId:base.id}}}/></main>};createRoot(document.getElementById('root')).render(<App/>);`;
 const bundled=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'/tmp/recon-review',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':'{}'},format:'iife',jsx:'automatic',plugins:[{name:'offline',setup(b){b.onResolve({filter:/^@zenvia\/ui$/},()=>({path:resolve('packages/ui/src/index.ts')}));b.onLoad({filter:/src\/pages\/Orders\.tsx$/},()=>({contents:source,loader:'tsx',resolveDir:resolve('src/pages')}));b.onResolve({filter:/.*/},a=>mocks.has(a.path)?{path:a.path,namespace:'fixture'}:null);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks.get(a.path),loader:'tsx'}));}}]});
 const js=bundled.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundled.outputFiles.find(f=>f.path.endsWith('.css'))?.text||'';
 for(const width of [390,1440])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height:1000},locale:'es-ES'});const errors=[],network=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>{network.push(r.request().url());if(r.request().url().startsWith('https://flagcdn.com/'))return r.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16"><path fill="#ad1519" d="M0 0h24v16H0z"/><path fill="#fabd00" d="M0 4h24v8H0z"/></svg>'});return r.abort()});
  await page.setContent(`<html lang="es" data-theme="${theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}*{animation:none!important;transition:none!important;caret-color:transparent!important}</style></head><body><div id="root"></div><script>${js.replaceAll('</script','<\\/script')}</script></body></html>`);
  await page.locator('.ordersDrawer').waitFor();
  const capture=async name=>{await page.screenshot({path:`${out}/${phase}-${name}-${theme}-${width}.png`});manifest.push({phase,name,theme,width,sourceSHA256:createHash('sha256').update(source).digest('hex'),actions:await page.locator('.ordersDrawer button').allTextContents()});};
  for(const kind of ['pending','labelled','mrw']){
   await page.evaluate(kind=>globalThis.fixtureSet(kind),kind);await page.waitForTimeout(50);
   const names=(await page.locator('.ordersDrawer button').allTextContents()).map(s=>s.trim());const key=width+theme+kind;
   if(phase==='before')actions.set(key,names);else if(kind!=='mrw')assert.deepEqual(names,actions.get(key));
   if(kind==='mrw'&&phase==='after'){
    const check=page.getByRole('button',{name:'Comprobar con MRW',exact:true});await check.waitFor();
    assert.equal(await page.getByRole('button',{name:'Preparar etiqueta',exact:true}).count(),0);
    const above=await page.evaluate(()=>document.querySelector('.shipmentCreationRecovery').compareDocumentPosition([...document.querySelectorAll('h3')].find(h=>h.textContent==='Entrega'))&Node.DOCUMENT_POSITION_FOLLOWING);assert.ok(above,'Recovery must precede delivery information');
   }
   if(kind==='mrw')await capture('pending-mrw');
  }
  if(phase==='after'){
   for(const result of ['pending','error','recovered','released']){
    await page.evaluate(result=>{globalThis.fixtureSet('mrw');globalThis.fixtureResult=result},result);await page.waitForTimeout(50);
    await page.getByRole('button',{name:'Comprobar con MRW',exact:true}).click();
    if(result==='error')await page.getByRole('alert').waitFor();else if(result==='pending')await page.getByRole('status').waitFor();else if(result==='recovered')await page.getByRole('button',{name:'Marcar como enviado',exact:true}).waitFor();else await page.getByRole('button',{name:'Preparar etiqueta',exact:true}).waitFor();
    await capture(result);if(result==='recovered'){await page.getByRole('button',{name:'Marcar como enviado',exact:true}).scrollIntoViewIfNeeded();await capture('recovered-actions');}
   }
   for(const provider of ['sendcloud','envia']){await page.evaluate(p=>globalThis.fixtureSet(p),provider);await page.waitForTimeout(50);await page.getByRole('button',{name:provider==='envia'?'Comprobar con Envia':'Comprobar con Sendcloud',exact:true}).waitFor();await capture(provider);}
   assert.deepEqual(await page.evaluate(()=>globalThis.calls),['check','check','check','check']);
  }
  assert.deepEqual(errors,[]);assert.equal(network.filter(u=>!u.startsWith('https://flagcdn.com/')).length,0);assert.equal(await page.locator('.ordersDrawer').evaluate(e=>e.scrollWidth>e.clientWidth+1),false);await page.close();
 }
 }
 await writeFile(out+'/manifest.json',JSON.stringify(manifest,null,2));console.log(`Verified ${manifest.length} screenshots, real components, offline actions and recovery flow.`);
}finally{await browser.close()}
