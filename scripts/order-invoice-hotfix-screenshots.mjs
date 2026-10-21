// Real modal and fiscal calculator, sanitized #1023 fiscal shape; no live writes or buyer data.
import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {dirname} from 'node:path';
import {chromium} from 'playwright';
const output='docs/deploy/order-invoice-hotfix-20261021';
await mkdir(output,{recursive:true});
const main=await readFile('src/main.tsx','utf8');
const paths=[...new Set([...main.matchAll(/import ['"]([^'"]+\.css)['"]/g)].map(m=>'src/'+m[1].replace('./','')).concat(['src/sales.css','src/shared-forms.css']))];
const css=(await Promise.all(paths.map(p=>readFile(p,'utf8')))).join('\n');
const browser=await chromium.launch({executablePath:process.env.INVOICE_CHROMIUM,args:['--no-sandbox','--disable-dev-shm-usage']});
const checks=[];
try{for(const phase of ['before','after']){
 const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {OrderInvoiceModal} from './src/components/OrderInvoiceModal';import {shopifyInvoiceLines} from './src/services/shopifyInvoiceCore';
 const money=amount=>({shopMoney:{amount:String(amount),currencyCode:'EUR'}});
 const raw={taxesIncluded:true,totalPriceSet:money(40.98),lineItems:{nodes:[{name:'Producto A',quantity:1,originalUnitPriceSet:money(27.99),discountAllocations:[],taxLines:[{rate:.21,priceSet:money(4.86)}]},{name:'Producto B',quantity:1,originalUnitPriceSet:money(12.99),discountAllocations:[],taxLines:[{rate:.21,priceSet:money(2.25)}]}]},shippingLines:{nodes:[{title:'Transporte gratuito',discountedPriceSet:money(0),taxLines:[{rate:.21,priceSet:money(0)}]}]}};
 globalThis.fixtureServices={prepareOrderInvoice:async()=>({invoice:null,lines:shopifyInvoiceLines(raw)}),ensureSalesSeries:async()=>[{id:'series',name:'Serie F',prefix:'F',kind:'standard'}],loadBusinessSettings:async()=>({legalName:'Emisor de prueba'}),loadCompanyBranding:async()=>null,loadClients:async()=>[],loadTaxRegistrations:async()=>[{id:'tax',label:'Registro ES',vatNumber:'ES-PRUEBA',active:true,isDefault:true}],errorMessage:(e,f)=>e?.message||f};
 globalThis.renderFixture=()=>createRoot(document.getElementById('root')).render(<OrderInvoiceModal order={{id:'order-1023',orderNumber:'#1023',currency:'EUR',shippingAddress:{},billingAddress:{},customerName:'Cliente de prueba',customerEmail:''}} onClose={()=>{}} onSaved={()=>{}}/>);`;
 const bundled=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,loader:{'.css':'empty'},jsx:'automatic',format:'iife',define:{'import.meta.env':'{}'},plugins:[{name:'invoice-read-only-fixture',setup(b){
 b.onLoad({filter:/src\/components\/OrderInvoiceModal\.tsx$/},async a=>({contents:phase==='before'?execFileSync('git',['show','3decf71a:'+a.path.slice(process.cwd().length+1)],{encoding:'utf8'}):await readFile(a.path,'utf8'),loader:'tsx',resolveDir:dirname(a.path)}));
 b.onLoad({filter:/src\/components\/SendInvoiceModal\.tsx$/},()=>({contents:'export const SendInvoiceModal=()=>null;',loader:'tsx'}));
 b.onLoad({filter:/src\/context\/SettingsContext\.tsx$/},()=>({contents:"export const useSettings=()=>({settings:{sales:{defaultSeriesId:'series',defaultTaxRegistrationId:'tax'},general:{}}});",loader:'tsx'}));
 b.onLoad({filter:/src\/services\/.*\.ts$/},async a=>{
 const name=a.path.split('/').pop();if(['orderProvince.ts','shopifyInvoiceCore.ts'].includes(name))return phase==='before'&&name==='shopifyInvoiceCore.ts'?{contents:execFileSync('git',['show','3decf71a:src/services/shopifyInvoiceCore.ts'],{encoding:'utf8'}),loader:'ts'}:undefined;
 const s=await readFile(a.path,'utf8');return {contents:[...s.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)].map(m=>'export const '+m[1]+'=(...a)=>globalThis.fixtureServices.'+m[1]+'(...a);').join('\n'),loader:'ts'};
 });
 }}]});
 for(const width of [390,1280,1440]){
 const page=await browser.newPage({viewport:{width,height:1000},locale:'es-ES'});
 await page.route('**/*',r=>r.abort());await page.clock.setFixedTime(new Date('2026-10-21T12:00:00Z'));
 await page.setContent('<html lang="es-ES"><style>'+css+'</style><body><div id="root"></div><script>'+bundled.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script></body></html>');
 await page.evaluate(()=>globalThis.renderFixture());await page.getByRole('button',{name:'Generar factura',exact:true}).waitFor();
 await page.screenshot({path:output+'/'+phase+'-1023-'+width+'.png',fullPage:true});
 const proof=await page.evaluate(()=>({total:[...document.querySelectorAll('strong')].find(x=>x.textContent.startsWith('Total:'))?.textContent,lines:document.querySelectorAll('.ordersItems>div').length,issuer:[...document.querySelectorAll('p')].find(x=>x.textContent.startsWith('Emisor:'))?.textContent,error:document.querySelector('.errorBox')?.textContent}));
 if(phase==='after'&&(proof.total!=='Total: 40.98 EUR'||proof.lines!==3||proof.error))throw Error(JSON.stringify(proof));
 checks.push({phase,width,...proof});await page.close();
 }
}}finally{await browser.close()}
await writeFile(output+'/screenshots.json',JSON.stringify(checks,null,2)+'\n');
console.log(JSON.stringify(checks));
