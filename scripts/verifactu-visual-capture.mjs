// Renders committed synthetic offline fixtures only; never opens an application URL.
import {chromium} from 'playwright';
import {readFileSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const root=resolve('docs/deploy/20261024-verifactu-phase1');
const out=resolve(process.env.VF_VISUAL_OUTPUT||'artifacts/verifactu-phase1-visual');
mkdirSync(out,{recursive:true});
const browser=await chromium.launch();
try{
 for(const stage of ['before','after'])for(const view of ['invoices','invoice-detail','receipts','receipt-detail'])for(const width of [1440,390]){
  const file=resolve(root,`visual-${stage}-${view}.html`);
  if(!readFileSync(file,'utf8').includes('synthetic-offline'))throw new Error('Synthetic fixture marker required');
  const page=await browser.newPage({viewport:{width,height:1000},deviceScaleFactor:1});
  await page.route('**/*',route=>route.request().url().startsWith('file:')||route.request().url().startsWith('data:')?route.continue():route.abort());
  await page.goto(pathToFileURL(file).href);await page.screenshot({path:resolve(out,`${stage}-${view}-${width}.png`),fullPage:true});await page.close();
 }
}finally{await browser.close()}
