// Isolated visual regression fixture: real BillingSection + complete application
// CSS. All business calls are in-memory; outbound network is denied.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {build} from 'esbuild';
const {chromium}=await import((process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'playwright')+'/playwright/index.mjs');
const chrome=process.env.CATALOG_CHROMIUM_DIR||await readFile('../catalog-chromium-path.tmp','utf8');
const out='docs/deploy/20261021-commercial-catalog-visual';await mkdir(out,{recursive:true});
const root=process.cwd(),main=await readFile('src/main.tsx','utf8');
const cssImports=[...main.matchAll(/^import ['"]([^'"]+\.css)['"];?$/gm)].map(m=>`import ${JSON.stringify(m[1])};`).join('\n');
const services=await readFile('src/services/billing.ts','utf8'),availability=services.slice(services.indexOf('export function customerCheckoutAvailable'),services.indexOf('const PLATFORM_CONTROL_PLANE_URL'));
const access={workspaceId:'synthetic',planKey:'internal',planName:'Interno',subscriptionStatus:'active',entitlements:{}};
function fixture(phase,scenario){
 const rows=phase==='before'?[['pro','Pro',3999,39999],['business','Business',4999,49999]]:[['starter','Starter',3999,43989],['pro','Pro',4999,54989],['business','Business',5599,61589]];
 return {currentPlan:{planKey:'internal',name:'Interno',description:'Plan interno para ZENVIA y cuentas de plataforma.',monthlyPriceCents:null,yearlyPriceCents:null,entitlements:[]},subscription:{planKey:'internal',status:'active',billingProvider:'manual'},usage:{users:{value:5,limit:null},amazonAccounts:{value:1,limit:null},monthlyOrders:{value:171,limit:null}},paypalMode:phase==='after'?'sandbox':undefined,catalogError:scenario==='offline'?'No se han podido verificar los precios. Reintenta para consultar los planes vigentes.':undefined,availablePlans:scenario==='offline'?[]:rows.map(([planKey,name,monthlyPriceCents,yearlyPriceCents])=>({planKey,name,description:'Plan para centralizar la gestión de tu empresa.',monthlyPriceCents,yearlyPriceCents,isPublic:true,entitlements:[],commercialVersion:phase==='after'?1:undefined,paypalMode:'sandbox',checkout:phase==='after'?Object.fromEntries(['monthly','yearly'].map(c=>[c,{ok:!(scenario==='mismatch'&&planKey==='pro'),paypalPlanId:'P-SYNTHETIC-'+planKey+c,checkedAt:new Date().toISOString()}])):undefined}))};
}
const manifest=[];
const browser=await chromium.launch({headless:true,executablePath:chrome+'/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],env:{...process.env,LD_LIBRARY_PATH:chrome,FONTCONFIG_PATH:'/etc/fonts'}});
try{for(const phase of ['before','after']){
 const source=phase==='before'?execFileSync('git',['show',`${process.env.CATALOG_BASELINE_REF||'3eaa170d1d5175ac598cc7663a5cbfcb378427db'}:src/pages/Settings.tsx`],{encoding:'utf8'}):await readFile('src/pages/Settings.tsx','utf8');
 const entry=cssImports+`\nimport {createRoot} from 'react-dom/client';import {PageHeader} from '@zenvia/ui';import {BillingSection} from './pages/Settings';createRoot(document.getElementById('root')).render(<div className="page settingsPage finalDesignPage designSystemPage" style={{maxWidth:1200,margin:'0 auto',padding:24}}><PageHeader eyebrow="REVISIÓN SINTÉTICA" title="Configuración" description="Plan y facturación · Datos de prueba sin operaciones reales"/><BillingSection access={${JSON.stringify(access)}}/></div>);`;
 const bundled=await build({stdin:{contents:entry,resolveDir:resolve('src'),loader:'tsx'},outfile:'/tmp/billing-visual.js',bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'css'},define:{'import.meta.env':'{}'},plugins:[{name:'billing-fixture',setup(b){b.onResolve({filter:/\?url$/},args=>({path:args.path,namespace:'fixture-url'}));b.onLoad({filter:/.*/,namespace:'fixture-url'},()=>({contents:'export default "data:application/javascript,";',loader:'js'}));
 b.onLoad({filter:/\/src\/pages\/Settings\.tsx$/},()=>({contents:source+'\nexport {BillingSection};',loader:'tsx',resolveDir:resolve('src/pages')}));
 b.onLoad({filter:/\/src\/services\/billing\.ts$/},()=>({contents:`${availability}\nexport const BILLING_CHECKOUT_PAUSED=true;export const BILLING_CHECKOUT_PAUSE_MESSAGE='Estamos actualizando los precios; la contratación estará disponible en breve';export const loadCustomerBillingOverview=async()=>globalThis.billingVisual;export const loadCustomerSubscriptionInvoices=async()=>[];export const startCustomerPayPalCheckout=async()=>{throw Error('Checkout forbidden in fixture')};export const importCustomerSubscriptionInvoiceAsExpense=async()=>{throw Error('Document writes forbidden')};`,loader:'ts'}));
 b.onLoad({filter:/\/src\/services\/supabase\.ts$/},()=>({contents:'export const supabase={};export const INVOICE_BUCKET="invoices";export const getActiveSupabase=()=>supabase;export const hasActiveTenant=()=>false;export const getActiveTenant=()=>null;export const clearActiveTenant=()=>{};export const activateTenant=()=>{};export const resolveAndActivateTenant=()=>{};export const tenantFromUrl=()=>null;export const bootstrapTenantFromLocation=()=>{};export const resetLocalTenantSession=()=>{};',loader:'js'}));
 }}]});const js=bundled.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundled.outputFiles.find(f=>f.path.endsWith('.css')).text;
 for(const scenario of phase==='before'?['monthly','annual']:['monthly','annual','mismatch','offline'])for(const width of [390,1280,1440]){
 const page=await browser.newPage({viewport:{width,height:1000},locale:'es-ES',timezoneId:'Europe/Madrid'}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>{requests.push(r.request().url());return r.abort()});
 await page.setContent('<html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script>globalThis.billingVisual='+JSON.stringify(fixture(phase,scenario))+';</script><script>'+js.replaceAll('</script','<\\/script')+'</script></body></html>');
 await page.getByRole('heading',{name:'Planes disponibles',exact:true}).waitFor();if(scenario==='annual')await page.getByRole('button',{name:'Anual',exact:true}).click();
 if(phase==='after'&&scenario!=='offline'){await page.getByRole('heading',{name:'Starter',exact:true}).waitFor();if(await page.getByText('+ IVA',{exact:true}).count()!==3)throw Error('Missing tax base labels');}
 if(scenario==='mismatch'){const pro=page.locator('article').filter({has:page.getByRole('heading',{name:'Pro',exact:true})});if(await pro.getByRole('button',{name:'Contratar con PayPal'}).isEnabled())throw Error('Mismatching checkout enabled');}
 const geometry=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));if(geometry.scrollWidth>width||errors.length||requests.length)throw Error(JSON.stringify({geometry,errors,requests}));
 const path=resolve(out,`${phase}-${scenario}-${width}.png`);await page.screenshot({path,fullPage:true});manifest.push({phase,scenario,width,path,synthetic:true,networkRequests:requests.length,errors});await page.close();
 }
}}finally{await browser.close()}
await writeFile(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({captures:manifest.length,networkRequests:0}));
