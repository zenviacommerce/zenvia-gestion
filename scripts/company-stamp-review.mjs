// Reproducible offline review of the REAL SettingsPage, image processor and PDF renderer.
// Synthetic stamp only; no real company mark, credentials, remote reads or mutations.
// SHIPPING_CHROMIUM_PACKAGE=1 node scripts/company-stamp-review.mjs
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile,mkdir,writeFile,mkdtemp,chmod} from 'node:fs/promises';
import {brotliDecompressSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
const output='docs/deploy/pickup-enhancements-review-20261020';await mkdir(output,{recursive:true});
const mocks=new Map([
 ['../context/SettingsContext',`export const useSettings=()=>globalThis.stampReview.settings;`],
 ['../services/sales',`export const loadBusinessSettings=async()=>({legalName:'ZENVIA COMMERCE SL',taxId:'B12345678',countryCode:'ES',addressLine1:'Calle Ejemplo 28',city:'Madrid',postalCode:'28022',email:'prueba@example.test'});export const saveBusinessSettings=async()=>{};`],
 ['../services/companyBranding',`export const loadCompanyBranding=async()=>globalThis.stampReview.branding;export const removeCompanyStamp=async()=>{globalThis.stampReview.branding={...globalThis.stampReview.branding,stampPath:null,stampDataUrl:null};return globalThis.stampReview.branding};export const uploadCompanyStamp=async()=>globalThis.stampReview.branding;export const removeCompanyLogo=async()=>globalThis.stampReview.branding;export const uploadCompanyLogo=async()=>globalThis.stampReview.branding;`],
]);
const source=await readFile('src/pages/Settings.tsx','utf8');
for(const match of source.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)){
 const [,clause,path]=match;if(!path.startsWith('../services/')||['settingsSchema','mrwCatalog','uiPreferences','formatting','automationRules','amazon'].some(x=>path.endsWith('/'+x))||mocks.has(path))continue;
 const named=clause.match(/\{([\s\S]*?)\}/)?.[1]||'';
 const names=named.split(',').map(x=>x.trim()).filter(x=>x&&!x.startsWith('type ')).map(x=>x.split(/\s+as\s+/)[0]);
 mocks.set(path,names.map(x=>`export const ${x}=async()=>[];`).join('\n'));
}
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {SettingsPage} from './src/pages/Settings';import {DEFAULT_APP_SETTINGS,DEFAULT_USER_PREFERENCES} from './src/services/settingsSchema';import {prepareCompanyStamp} from './src/services/companyStampImage';import {createPickupReportPdfBlob} from './src/services/pickupReportPdf';
(async()=>{
const toData=blob=>new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob)});
const c=document.createElement('canvas');c.width=1100;c.height=440;const d=c.getContext('2d');d.fillStyle='#fff';d.fillRect(0,0,c.width,c.height);d.strokeStyle='#aaa';d.lineWidth=18;d.strokeRect(12,12,1076,416);
// Rectangular blue synthetic mark + yin-yang, surrounded by grey scan border and white margins.
d.strokeStyle='#1d4a9d';d.lineWidth=5;d.strokeRect(85,75,930,290);d.save();d.translate(235,220);d.fillStyle='#1d4a9d';d.beginPath();d.arc(0,0,93,0,Math.PI*2);d.fill();d.fillStyle='white';d.beginPath();d.arc(0,0,86,-Math.PI/2,Math.PI/2);d.closePath();d.fill();d.beginPath();d.arc(0,-43,43,0,Math.PI*2);d.fill();d.fillStyle='#1d4a9d';d.beginPath();d.arc(0,43,43,0,Math.PI*2);d.fill();d.beginPath();d.arc(0,-43,12,0,Math.PI*2);d.fill();d.fillStyle='white';d.beginPath();d.arc(0,43,12,0,Math.PI*2);d.fill();d.restore();d.fillStyle='#1d4a9d';d.font='bold 45px sans-serif';d.fillText('ZENVIA COMMERCE SL',370,175);d.font='32px sans-serif';d.fillText('CIF: B12345678',370,225);d.fillText('Calle Ejemplo 28 · 28022 Madrid',370,272);d.font='24px sans-serif';d.fillText('SELLO SINTÉTICO · SOLO PRUEBAS',370,320);
const raw=await new Promise(r=>c.toBlob(r,'image/png')),processed=await prepareCompanyStamp(raw),stamp=await toData(processed);
globalThis.stampReview={raw:await toData(raw),processed:stamp,branding:{ownerId:'synthetic-owner',logoPath:null,logoDataUrl:null,stampPath:'synthetic-owner/branding/stamp-demo.png',stampDataUrl:stamp},settings:{settings:structuredClone(DEFAULT_APP_SETTINGS),preferences:DEFAULT_USER_PREFERENCES,warnings:[],loading:false,error:null,updateSection:async()=>{},updatePreferences:async()=>{},patchPreferences:async()=>{}}};
const report={id:'synthetic',number:'REC-2026-DEMO',createdAt:'2026-10-20T07:30:00Z',createdBy:'fixture',sender:{legalName:'ZENVIA COMMERCE SL',taxId:'B12345678',address:'Calle Ejemplo 28, 28022 Madrid',email:'prueba@example.test',phone:''},items:[{orderId:'synthetic',orderNumber:'PEDIDO-DEMO',channel:'shopify',carrier:'MRW',trackingNumber:'PRUEBA-12345',packages:2}],totalPackages:2};globalThis.stampReview.pdf=await toData(createPickupReportPdfBlob(report,{stampDataUrl:stamp,generatedAt:new Date('2026-10-20T08:00:00Z')}));
createRoot(document.getElementById('root')).render(<main className="main"><p style={{padding:'12px 24px'}}>Revisión local · sello y datos sintéticos · sin conexión</p><SettingsPage isAdmin={true} access={{}}/></main>);})();`;
const bundled=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,loader:{'.css':'empty'},format:'iife',target:'es2022',platform:'browser',jsx:'automatic',define:{'import.meta.env':'{}'},plugins:[{name:'isolated-settings-review',setup(b){b.onResolve({filter:/.*/},args=>args.importer.endsWith('/Settings.tsx')&&mocks.has(args.path)?{path:args.path,namespace:'fixture'}:null);b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks.get(args.path),loader:'tsx'}));}}]});
const main=await readFile('src/main.tsx','utf8'),cssFiles=[...new Set([...main.matchAll(/import ['"]([^'"]+\.css)['"]/g)].map(x=>'src/'+x[1].replace('./','')))];
const css=(await Promise.all([...new Set([...cssFiles,'src/shared-forms.css'])].map(p=>readFile(p,'utf8')))).join('\n');
let launchOptions={headless:true};
if(process.env.SHIPPING_CHROMIUM_PACKAGE==='1'){
 const {default:packaged}=await import('@sparticuz/chromium'),root=await mkdtemp(resolve(tmpdir(),'stamp-chromium-')),bin=resolve(dirname(fileURLToPath(import.meta.resolve('@sparticuz/chromium'))),'../bin');
 for(const file of ['chromium.br','swiftshader.tar.br']){const data=brotliDecompressSync(await readFile(resolve(bin,file)));if(file.includes('.tar'))execFileSync('tar',['--no-same-owner','-x','-C',root],{input:data});else{await writeFile(resolve(root,'chromium'),data);await chmod(resolve(root,'chromium'),0o755)}}
 process.env.FONTCONFIG_PATH='/etc/fonts';process.env.LD_LIBRARY_PATH=[root,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');launchOptions={...launchOptions,args:packaged.args.filter(arg=>arg!=='--single-process'),executablePath:resolve(root,'chromium')};
}
const browser=await chromium.launch(launchOptions);
try{for(const device of [{name:'desktop',width:1440,height:1050},{name:'mobile',width:390,height:844}]){
 const page=await browser.newPage({viewport:{width:device.width,height:device.height}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());
 await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script>'+bundled.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script></body></html>');
 await page.getByRole('heading',{name:'Sello de empresa',exact:true}).waitFor();await page.getByAltText('Sello de empresa').evaluate(img=>img.decode());
 assert.equal(await page.getByRole('heading',{name:'Logotipo',exact:true}).count(),1);assert.equal(await page.getByLabel('Sello de empresa',{exact:true}).getAttribute('accept'),'image/png,image/jpeg');
 await page.screenshot({path:output+'/settings-general-'+device.name+'.png',fullPage:true});await page.getByRole('heading',{name:'Sello de empresa',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:output+'/settings-stamp-'+device.name+'.png'});
 if(device.name==='desktop'){const assets=await page.evaluate(()=>globalThis.stampReview);for(const [key,file] of [['raw','stamp-synthetic-scanned.png'],['processed','stamp-synthetic-processed.png'],['pdf','pickup-synthetic-stamp.pdf']])await writeFile(output+'/'+file,Buffer.from(assets[key].split(',')[1],'base64'));}
 await page.getByRole('button',{name:'Eliminar sello',exact:true}).click();await page.getByText('Sin sello',{exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Logotipo',exact:true}).count(),1);await page.screenshot({path:output+'/settings-stamp-removed-'+device.name+'.png'});
 assert.deepEqual(errors,[]);await page.close();
}}finally{await browser.close()}
execFileSync('python',['-c',`import fitz\np=fitz.open('${output}/pickup-synthetic-stamp.pdf')\np[0].get_pixmap(matrix=fitz.Matrix(1.6,1.6)).save('${output}/pickup-synthetic-stamp.png')`]);
console.log('Offline stamp review saved: '+output);
