// Actual Settings preview JSX and complete production CSS; synthetic edge-marked images only.
import {build} from 'esbuild';
import {readFile,mkdir,writeFile,mkdtemp,chmod} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {brotliDecompressSync} from 'node:zlib';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
const phase=process.argv[2]||'after',baseline='aa8677dd',out='docs/deploy/hotfix-preview-review-20261020';
const read=p=>phase==='before'?Promise.resolve(execFileSync('git',['show',baseline+':'+p],{encoding:'utf8'})):readFile(p,'utf8');
const main=await read('src/main.tsx');const files=[...new Set([...main.matchAll(/import ['"]([^'"]+\.css)['"]/g)].map(m=>'src/'+m[1].replace('./','')))];
const css=(await Promise.all([...new Set([...files,'src/sales.css'])].map(read))).join('\n');
const settings=await read('src/pages/Settings.tsx');const previews=[...settings.matchAll(/<div className="settingsLogoPreview">.*?<\/div>/g)].map(m=>m[0]);if(previews.length!==2)throw Error('Settings preview JSX changed; update fixture');
const svg=(w,h,label)=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="2" y="2" width="${w-4}" height="${h-4}" fill="white" stroke="#0f766e" stroke-width="4"/><path d="M4 4L${w-4} ${h-4}M${w-4} 4L4 ${h-4}" stroke="#cbd5e1"/><text x="${w/2}" y="${h/2}" text-anchor="middle" font-size="${Math.min(w,h)/13}">${label}</text><text x="${w/2}" y="${h-12}" text-anchor="middle" font-size="12">ÚLTIMA LÍNEA COMPLETA · BORDE DERECHO →</text></svg>`);
const images={logoDataUrl:svg(1000,180,'LOGOTIPO COMPLETO'),stampDataUrl:svg(600,900,'SELLO COMPLETO')};
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{ProductIdentity}from'./src/components/ProductIdentity';const branding=${JSON.stringify(images)};createRoot(document.getElementById('root')).render(<main style={{padding:24,maxWidth:900,margin:'auto'}}><h1>Vistas previas · imágenes sintéticas</h1>${previews.map((p,i)=>`<section className="settingsSubsection"><h2>${i?'Sello de empresa':'Logotipo'}</h2><div className="settingsLogoRow">${p}</div></section>`).join('')}<section><h2>Editor de logotipo</h2><div className="companyLogoEditor"><div className="companyLogoPreview hasLogo"><img src={branding.stampDataUrl} alt="Logotipo alto"/></div></div></section><section><h2>Producto alto</h2><ProductIdentity name="Producto de prueba" imageUrl={branding.stampDataUrl}/></section></main>);`;
const js=(await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic'})).outputFiles[0].text;
let options={headless:true,args:['--lang=es-ES']};
if(process.env.SHIPPING_CHROMIUM_PACKAGE==='1'){
 const {default:pack}=await import('@sparticuz/chromium');const root=await mkdtemp(resolve(tmpdir(),'preview-chromium-'));const bin=resolve(dirname(fileURLToPath(import.meta.resolve('@sparticuz/chromium'))),'../bin');
 for(const file of ['chromium.br','swiftshader.tar.br']){const data=brotliDecompressSync(await readFile(resolve(bin,file)));if(file.includes('.tar'))execFileSync('tar',['--no-same-owner','-x','-C',root],{input:data});else{await writeFile(resolve(root,'chromium'),data);await chmod(resolve(root,'chromium'),0o755);}}
 process.env.FONTCONFIG_PATH='/etc/fonts';process.env.LD_LIBRARY_PATH=[root,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');options={...options,args:pack.args.filter(a=>a!=='--single-process'),executablePath:resolve(root,'chromium')};
}
await mkdir(out,{recursive:true});const browser=await chromium.launch(options);const results=[];
try{for(const width of [390,1280,1440]){const page=await browser.newPage({viewport:{width,height:1000},locale:'es-ES'});await page.route('**/*',r=>r.abort());await page.setContent('<html lang="es-ES"><style>'+css+'</style><div id="root"></div><script>'+js.replaceAll('</script','<\\/script')+'</script></html>');await page.locator('img').first().waitFor();await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));await page.screenshot({path:`${out}/${phase}-${width}.png`,fullPage:true});
 const images=await page.locator('img').evaluateAll(els=>els.map(img=>{const r=img.getBoundingClientRect(),p=img.parentElement.getBoundingClientRect(),s=getComputedStyle(img);return {alt:img.alt,width:r.width,height:r.height,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,fit:s.objectFit,withinParent:r.left>=p.left-1&&r.right<=p.right+1&&r.top>=p.top-1&&r.bottom<=p.bottom+1,ratioPreserved:Math.abs(r.width/r.height-img.naturalWidth/img.naturalHeight)<0.02}}));
 const failures=images.filter(i=>!i.withinParent||i.fit!=='contain'||(i.alt&&!i.ratioPreserved));results.push({width,images,failures});await page.close();}
}finally{await browser.close();}await writeFile(`${out}/${phase}-metrics.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));if(phase==='after'&&results.some(r=>r.failures.length))process.exitCode=1;
