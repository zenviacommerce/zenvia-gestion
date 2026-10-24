import {mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.VF_PLAYWRIGHT_MODULE||'playwright');
const root=resolve('docs/deploy/20261024-verifactu-next/visual');
const output=resolve('docs/deploy/20261024-verifactu-next/screenshots');mkdirSync(output,{recursive:true});
const browser=await chromium.launch(process.env.VF_BROWSER_EXECUTABLE?{executablePath:process.env.VF_BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}:{});
const evidence=[];
try{
 for(const name of readdirSync(root).filter(f=>f.endsWith('.html'))){const file=resolve(root,name);if(!readFileSync(file,'utf8').includes('synthetic-offline'))throw new Error('Synthetic-only fixture required');
  for(const width of [1440,390])for(const theme of ['light','dark']){
   const page=await browser.newPage({viewport:{width,height:1000},deviceScaleFactor:1,colorScheme:theme});await page.route('**/*',r=>/^(file:|data:)/.test(r.request().url())?r.continue():r.abort());
   await page.goto(pathToFileURL(file).href);await page.evaluate(t=>{document.documentElement.dataset.theme=t;document.body.dataset.theme=t},theme);await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important}'});
   const image=`${name.slice(0,-5)}-${width}-${theme}.png`;await page.screenshot({path:resolve(output,image)});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
   evidence.push({image,width,theme,overflow});await page.close();if(overflow)throw new Error('Horizontal overflow: '+image);
  }
 }
 writeFileSync(resolve(output,'measurements.json'),JSON.stringify(evidence,null,2));console.log(`PASS: ${evidence.length} offline screenshots, no horizontal overflow`);
}finally{await browser.close()}
