// Offline renderer: all fixtures originate in actual React components with synthetic mocks.
import {mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.VF_PLAYWRIGHT_MODULE||'playwright');
const root=resolve('docs/deploy/20261024-verifactu-correction');
const output=resolve(process.env.VF_CORRECTION_SCREENSHOTS||'artifacts/verifactu-correction');mkdirSync(output,{recursive:true});
const browser=await chromium.launch(process.env.VF_BROWSER_EXECUTABLE?{executablePath:process.env.VF_BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}:{});const evidence=[];
try{
 const files=[...readdirSync(root).filter(f=>/^\d\d-.+\.html$/.test(f)).map(f=>resolve(root,f)),resolve(root,'../20261024-verifactu-phase1/visual-after-invoice-detail.html')];
 for(const file of files){if(!readFileSync(file,'utf8').includes('synthetic-offline'))throw new Error('Synthetic-only fixture required');
  for(const width of [1440,390])for(const theme of ['light','dark']){
   const page=await browser.newPage({viewport:{width,height:1000},deviceScaleFactor:1,colorScheme:theme});
   await page.route('**/*',route=>/^(file:|data:)/.test(route.request().url())?route.continue():route.abort());
   await page.goto(pathToFileURL(file).href);await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.body.dataset.theme=theme},theme);
   await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important}'});
   const name=file.endsWith('visual-after-invoice-detail.html')?'00-before-correction-detail':file.split('/').at(-1).replace('.html','');
   await page.screenshot({path:resolve(output,`${name}-${width}-${theme}.png`),fullPage:false});
   evidence.push({name,width,theme,horizontalOverflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),image:`${name}-${width}-${theme}.png`});if(name==='04-correction-editor'){
    await page.locator('.salesLinesEditor').scrollIntoViewIfNeeded();await page.screenshot({path:resolve(output,`04b-correction-lines-${width}-${theme}.png`),fullPage:false});
    evidence.push({name:'04b-correction-lines',width,theme,image:`04b-correction-lines-${width}-${theme}.png`});
   }
   await page.close();
  }
 }
 writeFileSync(resolve(output,'measurements.json'),JSON.stringify(evidence,null,2));
 console.log(`Captured ${evidence.length} offline screenshots; document horizontal overflow: ${evidence.filter(e=>e.horizontalOverflow).length}`);
}finally{await browser.close()}
