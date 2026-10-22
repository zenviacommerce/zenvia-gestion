// Reuse the actual-screen offline fixtures; never mount a reconstructed mock screen.
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const phase=process.argv[2]||'before';
if(!['before','after'].includes(phase))throw Error('before or after required');
const jobs=[['orders-workbench-review.mjs',['orders'],'const output='],['design-phase2-screenshots.mjs',['billing','expenses'],'let options='],['design-phase3-commerce-screenshots.mjs',['amazon','shopify'],'let options='],['design-phase3-final-screenshots.mjs',['support','admin','settings'],'let options=']];
const out=resolve('docs/deploy/20261022-shared-tabs-review',phase);
for(const [fixture,screens,marker] of jobs.filter(job=>!process.env.TABS_CAPTURE_JOB||job[0].includes(process.env.TABS_CAPTURE_JOB))){
 let prefix=(await readFile('scripts/'+fixture,'utf8')).split(marker)[0];
 // These fixtures all use the current worktree for both sides; run before editing.
 prefix=prefix.replace("const phase=process.argv[2]||'after'","const phase='capture'").replace("const phase=process.argv[2]||'after',","const phase='capture',");
 if(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES)prefix=prefix.replace("from 'playwright'","from '"+process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+"/playwright/index.mjs'");
 const tail=`
const captureRoot=${JSON.stringify(out)};await mkdir(captureRoot,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.TABS_CHROMIUM_ROOT?{executablePath:process.env.TABS_CHROMIUM_ROOT+'/chromium'}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],env:{...process.env,LD_LIBRARY_PATH:process.env.TABS_CHROMIUM_ROOT}});
const results=[];
try{for(const screen of ${JSON.stringify(screens)})for(const theme of ['light','dark'])for(const width of [390,1280,1440]){
 const page=await browser.newPage({locale:'es-ES',viewport:{width,height:1050},hasTouch:width===390}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url()==='https://tabs-review.test/'?r.fulfill({contentType:'text/html',body:'<html></html>'}):r.abort());await page.goto('https://tabs-review.test/');await page.clock.setFixedTime(new Date('2026-10-22T10:00:00Z'));
 await page.setContent('<html lang="es" data-theme="'+theme+'"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'*{animation:none!important;transition:none!important}</style></head><body><div id="root"></div><script>'+bundled.outputFiles[0].text.replaceAll('</script','<\\\\/script')+'</script></body></html>');
 await page.evaluate(s=>globalThis.renderFixture(s),screen);await page.getByRole('tablist').waitFor({timeout:10000}).catch(e=>{throw Error(screen+': '+errors.join('; ')+e.message)});await page.waitForTimeout(800);
 const proof=await page.evaluate(()=>({tabs:[...document.querySelectorAll('[role="tab"]')].map(e=>e.textContent.replace(/\\s+/g,' ').trim()),actions:[...document.querySelectorAll('.pageHead button,.dsPageHeader button')].map(e=>e.textContent.trim()),overflow:document.documentElement.scrollWidth>innerWidth}));
 if(errors.length)throw Error(screen+': '+errors.join('; '));if(proof.overflow)throw Error(screen+' overflow '+width);
 const file=screen+'-'+width+'-'+theme+'.png';await page.screenshot({path:captureRoot+'/'+file,animations:'disabled'});results.push({screen,width,theme,file,...proof});
 if(${JSON.stringify(phase)}==='after'){
  const tabs=page.getByRole('tab');
  if(screen==='orders'&&width===390){const rail=page.getByRole('tablist'),box=await rail.boundingBox(),cdp=await page.context().newCDPSession(page);const y=box.y+box.height/2,start=box.x+box.width-30;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start,y}]});for(let dx=30;dx<=240;dx+=30)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start-dx,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(150);const offset=await rail.evaluate(e=>e.scrollLeft);if(offset<=0)throw Error('Native finger scroll did not move rail');results.at(-1).fingerScrollLeft=offset;await cdp.detach();await tabs.first().press('Home')}
  if(['orders','amazon','shopify','admin','support'].includes(screen)){await tabs.last().press('End');await page.waitForTimeout(80)};
  // A veto is valid only for Settings. Other screens must expose the selected tab in the rail.
  const active=page.getByRole('tab',{selected:true});const visible=await active.evaluate(e=>{const r=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return r.left>=p.left-1&&r.right<=p.right+1});if(!visible)throw Error(screen+' selected tab outside rail');
 }
 if(screen==='settings'&&'after'===process.env.TABS_CAPTURE_PHASE){const legal=page.getByRole('textbox').first();await legal.fill('Cambio sin guardar');await page.getByRole('tab').nth(1).click();await page.waitForTimeout(80);if(await legal.inputValue()!=='Cambio sin guardar')throw Error('Dirty input lost');await page.getByRole('tab',{selected:true}).press('ArrowRight');await page.waitForTimeout(80);if(await legal.inputValue()!=='Cambio sin guardar')throw Error('Keyboard dirty guard lost input')}
 await page.close();
}}finally{await browser.close()}
await writeFile(captureRoot+'/'+${JSON.stringify(fixture)}+'.json',JSON.stringify(results,null,2));console.log(${JSON.stringify(fixture)}+' '+results.length+' captures');
`;
 const generated=resolve('scripts/.shared-tabs-'+fixture);await writeFile(generated,prefix+tail);
 try{const r=spawnSync(process.execPath,[generated],{env:{...process.env,UI_CAPTURE_SOURCE:'',TABS_CAPTURE_PHASE:phase,TABS_CHROMIUM_ROOT:process.env.TABS_CHROMIUM_ROOT||''},encoding:'utf8',maxBuffer:8e6});if(r.status!==0)throw Error(r.stderr+'\n'+r.stdout);console.log(r.stdout.trim())}finally{await rm(generated,{force:true})}
}
