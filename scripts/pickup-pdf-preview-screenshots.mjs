import {build} from 'esbuild';
import {readFile,mkdir,writeFile,mkdtemp,chmod} from 'node:fs/promises';
import {brotliDecompressSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
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



const output='docs/deploy/pickup-review-20261020';
// MuPDF is independent of the host's Base14 font substitution used by Poppler.
const {flowPages:signaturePage}=JSON.parse(execFileSync('python',['scripts/pickup-pdf-render.py'],{encoding:'utf8'}));
try{for(const device of [{name:'desktop',width:1440,height:1050},{name:'mobile',width:390,height:844}]){
 const page=await browser.newPage({viewport:{width:device.width,height:device.height}});await page.route('**/*',r=>r.abort());
 for(const part of ['first','signatures']){
 const img=(await readFile(output+'/pdf-flow-'+part+'.png')).toString('base64');
 await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#e7e9ed;font:14px system-ui;color:#223}header{padding:12px 16px;background:#243346;color:white}img{display:block;width:min(794px,100%);height:auto;margin:16px auto;background:white;box-shadow:0 2px 12px #0002}@media(max-width:600px){img{margin:0;width:100%}header{font-size:12px}}</style></head><body><header>REC-2026-0042.pdf · PDF real del flujo de prueba · '+(part==='first'?'Página 1':'Página '+signaturePage+' · firmas')+'</header><img src="data:image/png;base64,'+img+'"></body></html>');
 await page.locator('img').evaluate(img=>img.decode());await page.screenshot({path:output+'/pdf-preview-'+part+'-'+device.name+'.png',fullPage:true});
 }await page.close();
}}finally{await browser.close()}
