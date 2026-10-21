import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
import {readReviewFile as readFile} from './review-file-loader.mjs';
import {dirname,resolve} from 'node:path';
import {chromium} from 'playwright';
const stub=(code)=>({contents:code,loader:'tsx'});
const entry=`
import React from 'react';
import{createRoot}from'react-dom/client';
import{MfaDevices}from'./src/components/MfaDevices';
import{MfaScreen}from'./src/components/MfaScreen';
const mode=new URLSearchParams(location.search).get('view')||'devices';
function Security(){
 const [view,setView]=React.useState(mode);
 window.__openRename=()=>document.querySelector('button[aria-label="Renombrar autenticador"]')?.click();
 return view==='devices'?<div className="page settingsPage"><header className="pageHead settingsPageHead"><div><div className="eyebrow">SISTEMA</div><h1>Configuración</h1></div></header><div className="settingsLayout"><nav className="settingsNav" aria-label="Secciones de configuración"><button><span><strong>General</strong><small>Identidad de empresa</small></span></button><button className="active"><span><strong>Seguridad</strong><small>Autenticadores y verificación de acceso</small></span></button><button><span><strong>Pedidos</strong><small>Preferencias de pedidos</small></span></button></nav><div className="settingsContent"><MfaDevices/></div></div></div>:<MfaScreen/>;
}
createRoot(document.getElementById('root')).render(<Security/>);
`;
const mocks={
 context:`export const useMfaAccess=()=>({ready:true,state:new URLSearchParams(location.search).get('view')==='qr'?'enrollment_required':'challenge_required',factor_ids:['f1','f2'],recheck:()=>{},requireRecent:()=>{}})`,
 services:`export const getActiveTenant=()=>({workspace_id:'test'});export const supabase={rpc:async()=>({data:null,error:null}),auth:{refreshSession:async()=>({data:{},error:null}),signOut:async()=>({error:null}),mfa:{listFactors:async()=>({data:{totp:[{id:'f1',friendly_name:'Ipad de Sergio',created_at:'2026-10-18T22:20:00Z'},{id:'f2',friendly_name:'Iphone de Sergio',created_at:'2026-10-18T22:30:00Z'}]},error:null}),enroll:async()=>({data:{id:'f3',totp:{qr_code:'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" fill="white"/><path d="M12 12h50v50H12zM118 12h50v50h-50zM12 118h50v50H12z" fill="none" stroke="black" stroke-width="12"/></svg>',secret:'DEMO-NO-REAL'}},error:null})}}}`,
 cache:`export const ensureViewCacheScope=()=>{};`
};
const bundled=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'mock-supabase-fixture',setup(b){b.onResolve({filter:/MfaContext$/},()=>({path:'context',namespace:'screens'}));b.onResolve({filter:/supabase$/},()=>({path:'services',namespace:'screens'}));b.onResolve({filter:/viewCache$/},()=>({path:'cache',namespace:'screens'}));b.onLoad({filter:/.*/,namespace:'screens'},args=>stub(mocks[args.path]));b.onResolve({filter:/.css$/},args=>({path:args.path,namespace:'empty-css'}));b.onLoad({filter:/.*/,namespace:'empty-css'},()=>({contents:'',loader:'js'}));}}]});
const main=await readFile('src/main.tsx','utf8');
const imported=[...main.matchAll(/import ['"]([^'"]+\.css)['"]/g)].map(x=>'src/'+x[1].replace('./',''));
const cssFiles=[...new Set([...imported,'src/shared-forms.css','src/components/auth-gestion-brand.css'])];
const css=(await Promise.all(cssFiles.map(p=>readFile(p,'utf8')))).join('\n');
const logo=await readFile('public/zenvia-brand-symbol-20261012.svg','utf8');
const logoData='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(logo);
await mkdir('artifacts/mfa-visual',{recursive:true});
const browser=await chromium.launch({headless:true});
for(const device of [{name:'desktop',width:1440,height:900},{name:'mobile',width:390,height:844}]){
 const page=await browser.newPage({viewport:{width:device.width,height:device.height},deviceScaleFactor:1});
 for(const view of ['devices','rename','qr','challenge']){
  const actual=view==='rename'?'devices':view;
  await page.goto('about:blank?view='+actual);
  await page.setContent('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"/><style>'+css+'</style></head><body><div id="root"></div><script>'+bundled.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script></body></html>');
  if(view==='qr'||view==='challenge'){await page.locator('.authGestionLogo img').waitFor();await page.locator('.authGestionLogo img').evaluate((node,url)=>node.src=url,logoData);await page.locator('.authGestionLogo img').evaluate(node=>node.decode());}
  if(view==='rename'){await page.getByRole('button',{name:'Renombrar'}).first().click();}
  if(view==='qr'){await page.getByLabel('Nombre del dispositivo').fill('iPhone de prueba');await page.getByRole('button',{name:'Configurar autenticador'}).click();}
  await page.screenshot({path:'artifacts/mfa-visual/'+view+'-'+device.name+'.png',fullPage:true});
 }
 await page.close();
}
await browser.close();
