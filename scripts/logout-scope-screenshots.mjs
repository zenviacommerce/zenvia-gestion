import {build} from 'esbuild';import {mkdir,writeFile,mkdtemp,chmod} from 'node:fs/promises';
import {readReviewFile as readFile} from './review-file-loader.mjs';import {brotliDecompressSync} from 'node:zlib';import {execFileSync} from 'node:child_process';import {dirname,resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {tmpdir} from 'node:os';import {chromium} from 'playwright';
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {SessionSecurity} from './src/components/SessionSecurity';import {ActionDialogHost} from './src/components/ActionDialogHost';createRoot(document.getElementById('root')).render(<><header><h1>Configuración · Seguridad</h1></header><SessionSecurity/><ActionDialogHost/></>);`;
const bundled=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'offline-session',setup(b){b.onResolve({filter:/services\/supabase$/},()=>({path:'auth',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export const supabase={auth:{signOut:async options=>{globalThis.logoutRequests=(globalThis.logoutRequests||[]).concat(options);return {error:new Error('synthetic offline timeout')}}}};`,loader:'js'}));}}]});
const css=(await Promise.all(['src/styles.css','src/settings.css','src/shared-forms.css','src/action-dialog.css'].map(p=>readFile(p,'utf8')))).join('\n');
const output='docs/deploy/logout-scope-review-20261019';await mkdir(output,{recursive:true});
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



try{for(const device of [{name:'desktop',width:1440,height:950},{name:'mobile',width:390,height:844}]){
 const page=await browser.newPage({viewport:device});await page.route('**/*',r=>r.abort());await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'body{padding:24px}.settingsSectionCard{max-width:900px;margin:20px auto}header{max-width:900px;margin:auto}</style></head><body><div id="root"></div><script>'+bundled.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script></body></html>');
 await page.getByRole('button',{name:'Cerrar sesión en todos los dispositivos'}).waitFor();await page.screenshot({path:output+'/security-'+device.name+'.png',fullPage:true});
 await page.getByRole('button',{name:'Cerrar sesión en todos los dispositivos'}).click();await page.getByRole('dialog').waitFor();await page.screenshot({path:output+'/confirm-'+device.name+'.png',fullPage:true});await page.getByRole('button',{name:'Cancelar'}).click();if(await page.evaluate(()=>globalThis.logoutRequests?.length||0)!==0)throw Error('Cancel sent logout');
 await page.getByRole('button',{name:'Cerrar sesión en todos los dispositivos'}).click();await page.getByRole('button',{name:'Cerrar todas las sesiones',exact:true}).click();await page.getByRole('alert').waitFor();await page.screenshot({path:output+'/error-'+device.name+'.png',fullPage:true});if(JSON.stringify(await page.evaluate(()=>globalThis.logoutRequests))!==JSON.stringify([{scope:'global'}]))throw Error('Wrong logout scope');await page.close();
}}finally{await browser.close()}
