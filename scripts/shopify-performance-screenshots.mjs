// Offline visual review: production Shopify components and CSS, synthetic data, no network.
import {build} from 'esbuild';import {readFile,mkdir,writeFile,mkdtemp,chmod} from 'node:fs/promises';import {brotliDecompressSync} from 'node:zlib';import {execFileSync} from 'node:child_process';import {dirname,resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {tmpdir} from 'node:os';import {chromium} from 'playwright';
const captured=JSON.parse(await readFile('tests/fixtures/shopify-period-production-20261019.json','utf8'));
const summaries=Object.fromEntries(captured.periods.map(p=>[p.id,p.data]));
const fixture=`export const loadShopifyStatus=async()=>({connected:true,stores:[{id:'shop',name:'Tienda de prueba',lastSyncedAt:'2026-10-19T16:00Z',availableFrom:'2026-06-01',inventoryAvailable:true,catalogAvailable:true}]});
export const loadShopifySummaryBatch=async periods=>{globalThis.batchCalls=(globalThis.batchCalls||0)+1;await new Promise(r=>setTimeout(r,800));const summaries=${JSON.stringify(summaries)};return [...periods].reverse().map(p=>({id:p.id,data:summaries[p.id]}));};
export const loadShopifyProducts=async()=>({items:[{id:'shop:SKU-PRUEBA',storeId:'shop',storeName:'Tienda de prueba',sku:'SKU-PRUEBA',name:'Producto de prueba',orders:1,units:2,grossSales:23.98,netSales:19.82,refunds:0,productCost:6.99,shippingCost:null,profitBeforeAds:null,profitComplete:false,currency:'EUR',inventoryQuantity:null,mappingProductId:null,mappingProductName:null,consumptionFactor:1}],total:1,page:1,pageSize:25});export const invalidateShopifyAnalytics=()=>{};export const syncShopifyAnalytics=async()=>({});export const loadShopifyMappings=async()=>[];export const loadShopifyProductOptions=async()=>[];export const addShopifyMapping=async()=>{};export const createShopifyProduct=async()=>{};export const deleteShopifyMapping=async()=>{};`;
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {ShopifyPage} from './src/pages/Shopify';createRoot(document.getElementById('root')).render(<ShopifyPage isAdmin={true}/>);`;
const bundled=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,loader:{'.css':'empty'},format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'offline-shopify',setup(b){b.onResolve({filter:/services\/shopifyAnalytics$/},()=>({path:'analytics',namespace:'fixture'}));b.onResolve({filter:/context\/SettingsContext$/},()=>({path:'settings',namespace:'fixture'}));b.onResolve({filter:/services\/toast$/},()=>({path:'toast',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({loader:'tsx',contents:path==='analytics'?fixture:path==='settings'?`export const useSettings=()=>({settings:{general:{timezone:'Europe/Madrid'}},preferences:{pageSize:25}});`:`export const errorMessage=(e,f)=>e.message||f;export const showSuccess=()=>{};export const showError=()=>{};`}));}}]});
const css=(await Promise.all(['src/styles.css','src/amazon.css','src/shopify.css','src/shared-forms.css'].map(p=>readFile(p,'utf8')))).join('\n');const output='artifacts/shopify-performance';await mkdir(output,{recursive:true});
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


try{for(const device of [{name:'desktop',width:1920,height:1100},{name:'mobile',width:390,height:844}]){const page=await browser.newPage({viewport:device});await page.clock.setFixedTime(new Date('2026-10-19T12:00:00Z'));await page.route('**/*',r=>r.abort());await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script>'+bundled.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script></body></html>');await page.getByText('Cargando periodo…').first().waitFor();await page.getByRole('region',{name:'Productos del periodo'}).getByText('Cargando productos…').waitFor({state:'hidden'});await page.screenshot({path:output+'/products-independent-'+device.name+'.png',fullPage:true});await page.locator('.amazonPeriodCard[aria-busy="true"]').first().waitFor({state:'hidden'});if(await page.evaluate(()=>globalThis.batchCalls)!==1)throw Error('Expected one batch request');await page.screenshot({path:output+'/ready-'+device.name+'.png',fullPage:true});await page.close();}}finally{await browser.close();}
