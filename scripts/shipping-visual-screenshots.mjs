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
 if(!path.startsWith('.')||path.endsWith('ShippingProviderStatus')||path.endsWith('orderShipping'))continue;
 const named=clause.match(/\{([\s\S]*?)\}/)?.[1]||'';
 const exports=named.split(',').map(x=>x.trim()).filter(x=>x&&!x.startsWith('type ')).map(x=>x.split(/\s+as\s+/).pop());
 mocks.set(path,(mocks.get(path)||'')+'\n'+(path.endsWith('SettingsContext')?`export const useSettings=()=>({settings:{orders:{shippingSelectionMode:'cheapest'},shipping:{weightUnit:'kg',topOptionsCount:3}}});`:exports.map(x=>`export const ${x}=()=>{};`).join('\n')+(clause.trim().startsWith('{')?'':'\nexport default {};')));
}
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {LabelModal} from './src/pages/Orders';
const state=new URLSearchParams(location.search).get('state');
const option=(provider,carrierName,price,code)=>({provider,providerName:provider==='envia'?'Envia.com':provider==='mrw'?'MRW directo':'Sendcloud',carrierName,carrierCode:carrierName.toLowerCase(),name:'Entrega 24/48 h',price,currency:'EUR',code,billedWeightKg:2,etaDays:2});
const all=[option('sendcloud','Correos Express',5.9,'SC-24'),option('envia','GLS',5.2,'ENV-24'),option('mrw','MRW',4.8,'0200')];
const ready=(options,message='')=>({state:'ready',options,message});
function Fixture(){const [retried,setRetried]=React.useState(false);let options=all;let states={sendcloud:ready([all[0]]),envia:ready([all[1]]),mrw:ready([all[2]])};let message='';
if(state==='loading'){options=[all[0],all[2]];states.envia={state:'loading',options:[],message:''};}
if(state==='envia-error'&&!retried){options=[all[0],all[2]];states.envia={state:'error',options:[],message:'Tiempo de espera agotado. Reintenta este proveedor.'};}
if(state==='mrw-not-applicable'){options=all.slice(0,2);states.mrw={state:'not_applicable',options:[],message:'El destino no está cubierto por el contrato MRW directo.'};}
if(state==='mrw-direct-contract'){message='Fixture sintética · Contrato MRW directo activo: MRW se omite de Sendcloud y Envia.com; se conserva MRW directo.';states.sendcloud=ready([all[0]],'MRW excluido: contrato directo activo.');states.envia=ready([all[1]],'MRW excluido: contrato directo activo.');}
return <LabelModal order={{id:'fixture',orderNumber:'DEMO-0240',weightKg:2,shippingAddress:{postal_code:'28013',city:'Madrid',country_code:'ES'},items:[]}} options={options} tariffs={[]} message={message} loading={state==='loading'} providerStates={states} onRetry={()=>setRetried(true)} preferredOption={null} onClose={()=>{}} onCreate={()=>{throw Error('Label creation is disabled in offline fixtures')}}/>;}
createRoot(document.getElementById('root')).render(<Fixture/>);`;
const bundled=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'offline-orders-fixture',setup(b){b.onLoad({filter:/\/src\/pages\/Orders\.tsx$/},()=>({contents:source.replace('function LabelModal({','export function LabelModal({'),loader:'tsx'}));b.onResolve({filter:/.*/},args=>args.importer.endsWith('/src/pages/Orders.tsx')&&mocks.has(args.path)?{path:args.path,namespace:'fixture'}:null);b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks.get(args.path),loader:'tsx'}));}}]});
const main=await readFile('src/main.tsx','utf8');
const cssFiles=[...new Set([...main.matchAll(/import ['"]([^'"]+\.css)['"]/g)].map(x=>'src/'+x[1].replace('./','')))];
const css=(await Promise.all(cssFiles.map(p=>readFile(p,'utf8')))).join('\n');
const output='artifacts/shipping-visual';await mkdir(output,{recursive:true});
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
 const page=await browser.newPage({viewport:{width:device.width,height:device.height},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>route.abort());
 for(const state of ['all-ready','loading','envia-error','mrw-not-applicable','mrw-direct-contract']){
  await page.goto('about:blank?state='+state);
  await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script>'+bundled.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script></body></html>');
  await page.locator('.ordersLabelModal').waitFor();await page.evaluate(()=>document.fonts.ready);
  // Capture the complete real scrollable modal, including its sticky footer.
  const height=await page.locator('.ordersLabelModal').evaluate(el=>el.scrollHeight+el.querySelector('.ordersLabelBody').scrollHeight+100);
  await page.setViewportSize({width:device.width,height:Math.max(device.height,height)});
  await page.locator('.ordersLabelModal').screenshot({path:output+'/'+state+'-'+device.name+'.png',animations:'disabled'});
  if(state==='envia-error'){await page.getByRole('button',{name:'Reintentar Envia.com'}).click();await page.getByText('Envia.com',{exact:true}).first().waitFor();if(await page.getByRole('button',{name:'Reintentar Envia.com'}).count())throw Error('Retry did not recover fixture');}
  if(errors.length)throw Error(errors.join('\n'));
  manifest.push({state,device:device.name,width:device.width,path:output+'/'+state+'-'+device.name+'.png'});
  await page.setViewportSize({width:device.width,height:device.height});
 }
 await page.close();
}}finally{await browser.close();}
await writeFile(output+'/manifest.json',JSON.stringify({note:'Actual LabelModal and production CSS. Synthetic props; no network or label operations. Direct-contract suppression is an explicit post-filter fixture, not backend execution.',screenshots:manifest},null,2));
console.log('Generated '+manifest.length+' offline screenshots in '+output);
