// PR 242 offline visual fixture: real LabelModal, classifier and production CSS.
// npm install --no-save --package-lock=false playwright@1.58.2
// npx playwright install chromium && node scripts/shipping-pr242-screenshots.mjs
// Restricted download fallback: npm install --no-save --package-lock=false playwright@1.58.2 @sparticuz/chromium@153.0.0
// SHIPPING_CHROMIUM_PACKAGE=1 node scripts/shipping-pr242-screenshots.mjs
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
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {LabelModal} from './src/pages/Orders';import {collectProviderQuotes} from './src/services/providerQuotes';
const option={provider:'sendcloud',providerName:'Sendcloud',carrierName:'Correos Express',carrierCode:'correos',name:'Entrega 24/48 h',price:5.9,currency:'EUR',code:'SC-24',billedWeightKg:2,etaDays:2};
function Fixture(){const [states,setStates]=React.useState({});React.useEffect(()=>{collectProviderQuotes({sendcloud:async()=>({options:[option]}),envia:async()=>({options:[],diagnostics:[{carrier:'DHL',message:'Origen Madrid no tiene cobertura para esta ruta.'},{carrier:'Cainiao',message:'Solo admite envíos a partir de origen China.'}]}),mrw:()=>new Promise(()=>{})},update=>setStates(old=>({...old,...update})),100);},[]);
const options=Object.values(states).flatMap(s=>s.options);const retry=async(provider)=>{await collectProviderQuotes({[provider]:async()=>({options:[],message:'No hay servicios para este envío.'})},update=>setStates(old=>({...old,...update})),100);};
return <LabelModal order={{id:'fixture',orderNumber:'DEMO-0242',weightKg:2,shippingAddress:{postal_code:'28013',city:'Madrid',country_code:'ES'},items:[]}} options={options} tariffs={[]} message={''} loading={false} providerStates={states} onRetry={retry} preferredOption={null} onClose={()=>{}} onCreate={()=>{throw Error('Label creation is disabled in offline fixtures')}}/>;}
createRoot(document.getElementById('root')).render(<Fixture/>);`;
const bundled=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'offline-orders-fixture',setup(b){b.onLoad({filter:/\/src\/pages\/Orders\.tsx$/},()=>({contents:source.replace('function LabelModal({','export function LabelModal({'),loader:'tsx'}));b.onResolve({filter:/.*/},args=>args.importer.endsWith('/src/pages/Orders.tsx')&&mocks.has(args.path)?{path:args.path,namespace:'fixture'}:null);b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks.get(args.path),loader:'tsx'}));}}]});
const main=await readFile('src/main.tsx','utf8');
const cssFiles=[...new Set([...main.matchAll(/import ['"]([^'"]+\.css)['"]/g)].map(x=>'src/'+x[1].replace('./','')))];
const css=(await Promise.all(cssFiles.map(p=>readFile(p,'utf8')))).join('\n');
const output='docs/review/shipping-pr242';await mkdir(output,{recursive:true});
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
 for(const state of ['route-exclusions-and-timeout']){
  await page.goto('about:blank?state='+state);
  await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script>'+bundled.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script></body></html>');
  await page.locator('.ordersLabelModal').waitFor();await page.getByRole('button',{name:'Reintentar MRW directo'}).waitFor();if(await page.getByRole('button',{name:'Reintentar Envia.com'}).count())throw Error('Route exclusions incorrectly show Retry');if(await page.getByRole('button',{name:/Reintentar/}).count()!==1)throw Error('Expected only timeout Retry');await page.getByText('Correos Express',{exact:true}).first().waitFor();await page.getByText('1 opción con precio',{exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);
  // Capture the complete real scrollable modal, including its sticky footer.
  const height=await page.locator('.ordersLabelModal').evaluate(el=>el.scrollHeight+el.querySelector('.ordersLabelBody').scrollHeight+100);
  await page.setViewportSize({width:device.width,height:Math.max(device.height,height)});
  await page.locator('.ordersLabelModal').screenshot({path:output+'/'+state+'-'+device.name+'.png',animations:'disabled'});
  if(errors.length)throw Error(errors.join('\n'));
  manifest.push({state,device:device.name,width:device.width,path:output+'/'+state+'-'+device.name+'.png'});
  await page.setViewportSize({width:device.width,height:device.height});
 }
 await page.close();
}}finally{await browser.close();}
await writeFile(output+'/manifest.json',JSON.stringify({note:'Actual LabelModal, collectProviderQuotes classifier and production CSS. Offline synthetic provider replies: DHL/Cainiao route exclusions, real collector timeout for MRW, successful Sendcloud rate retained. All browser network aborted; no label operations.',screenshots:manifest},null,2));
console.log('Generated '+manifest.length+' offline screenshots in '+output);
