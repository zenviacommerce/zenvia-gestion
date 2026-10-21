import {build} from 'esbuild';import {mkdir,writeFile,mkdtemp,chmod} from 'node:fs/promises';
import {readReviewFile as readFile} from './review-file-loader.mjs';import {brotliDecompressSync} from 'node:zlib';import {execFileSync} from 'node:child_process';import {dirname,resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {tmpdir} from 'node:os';import {chromium} from 'playwright';
const entry="import React from 'react';import{createRoot}from'react-dom/client';import{MfaProvider,useMfaAccess}from'./src/context/MfaContext';import{MfaScreen}from'./src/components/MfaScreen';function Probe(){const a=useMfaAccess();return a.ready?<p>Sesi\u00f3n verificada</p>:<MfaScreen/>}createRoot(document.getElementById('root')).render(<MfaProvider><Probe/></MfaProvider>);";
const service="export const hasActiveTenant=()=>true;export const getActiveTenant=()=>({workspace_id:'fixture-workspace'});export const supabase={auth:{getSession:async()=>({data:{session:{user:{id:'fixture-user'},access_token:'synthetic'}},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>{globalThis.signOutCalls=(globalThis.signOutCalls||0)+1;return{error:null}},mfa:{listFactors:async()=>({data:{totp:[{id:'first',friendly_name:'iPad de prueba'},{id:'second',friendly_name:'iPhone de prueba'}]},error:null})}},rpc:()=>{globalThis.statusCalls=(globalThis.statusCalls||0)+1;return Promise.resolve(globalThis.statusCalls<=3?{data:null,error:{message:'503'}}:{data:{state:'challenge_required',factor_ids:['first','second']},error:null})}};export const getActiveSupabase=()=>supabase;";
const bundled=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'import.meta.env.VITE_MFA_ENFORCEMENT_ENABLED':'"true"'},loader:{'.css':'empty'},plugins:[{name:'offline-mfa',setup(b){b.onResolve({filter:/services\/supabase$/},()=>({path:'auth',namespace:'fixture'}));b.onResolve({filter:/services\/viewCache$/},()=>({path:'cache',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='auth'?service:'export const ensureViewCacheScope=()=>{};',loader:'js'}));}}]});
const main=await readFile('src/main.tsx','utf8');const imported=[...main.matchAll(/import ['"]([^'"]+\.css)['"]/g)].map(x=>'src/'+x[1].replace('./',''));const css=(await Promise.all([...new Set([...imported,'src/shared-forms.css','src/components/auth-gestion-brand.css'])].map(p=>readFile(p,'utf8')))).join('\n');
const logoData='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(await readFile('public/zenvia-brand-symbol-20261012.svg','utf8'));
const output='docs/deploy/mfa-reactivation-review-20261019';await mkdir(output,{recursive:true});
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




try{for(const device of [{name:'desktop',width:1440,height:950},{name:'mobile',width:390,height:844}]){const page=await browser.newPage({viewport:device});await page.route('**/*',r=>r.abort());await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script>'+bundled.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script></body></html>');await page.waitForFunction(()=>globalThis.statusCalls===3);await page.getByText('Seguridad temporalmente no disponible',{exact:true}).waitFor();await page.locator('.authGestionLogo img').evaluate((node,url)=>node.src=url,logoData);await page.locator('.authGestionLogo img').evaluate(node=>node.decode());await page.screenshot({path:output+'/unavailable-'+device.name+'.png',fullPage:true});if(await page.evaluate(()=>globalThis.signOutCalls||0)!==0)throw Error('Unexpected logout');await page.getByRole('button',{name:'Reintentar',exact:true}).click();await page.getByLabel('Código de seis dígitos').waitFor();await page.locator('.authGestionLogo img').evaluate((node,url)=>node.src=url,logoData);await page.locator('.authGestionLogo img').evaluate(node=>node.decode());await page.screenshot({path:output+'/retry-challenge-'+device.name+'.png',fullPage:true});if(await page.evaluate(()=>globalThis.statusCalls)!==4)throw Error('Unexpected RPC count');await page.close();}}finally{await browser.close()}
