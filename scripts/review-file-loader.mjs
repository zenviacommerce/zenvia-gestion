import {readFile,writeFile} from 'node:fs/promises';
const sharedCss={
 '@zenvia/ui/styles.css':new URL('../packages/ui/dist/styles.css',import.meta.url),
 '@zenvia/ui/forms.css':new URL('../packages/ui/dist/forms.css',import.meta.url),
};
/** setContent/style.textContent have no CSS loader. Resolve the same published CSS as Vite. */
export async function readReviewFile(path,options){
 const contents=await readFile(path,options);
 if(typeof contents!=='string'||!String(path).endsWith('.css'))return contents;
 return expandReviewCss(contents);
}
export async function expandReviewCss(contents){
 const imports=[...contents.matchAll(/@import\s+['"](@zenvia\/ui\/[^'"]+)['"];?/g)];
 for(const match of imports){
  const path=sharedCss[match[1]];
  if(!path)throw new Error('Unknown shared UI CSS export: '+match[1]);
  const css=await readFile(path,'utf8');
  contents=contents.replace(match[0],()=>css);
 }
 return contents;
}

/** Freeze motion before React mounts, so compositing never caches an animated intermediate. */
export const reviewCaptureStyles=process.env.UI_EXTRACTION_OUTPUT?'*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}':'';
/** Only the extraction harness freezes motion; product sources stay byte-identical. */
const preparedPages=new WeakSet();
export async function captureReviewScreenshot(page,options){
 if(process.env.UI_EXTRACTION_OUTPUT&&!preparedPages.has(page)){
  await page.evaluate(()=>document.fonts.ready);
  // Recharts animates SVG paths with requestAnimationFrame, outside CSS animations.
  // Its default begin + duration is 1900ms; capture the completed chart on both sides.
  if(await page.locator('.recharts-wrapper').count())await page.waitForTimeout(2200);
  preparedPages.add(page);
 }
 if(process.env.UI_CAPTURE_GEOMETRY==='1')await writeFile(options.path+'.geometry.json',JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('.stat,svg')].map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {tag:e.tagName,cls:e.getAttribute('class'),box:{x:r.x,y:r.y,width:r.width,height:r.height},transform:s.transform,opacity:s.opacity,html:e.tagName==='svg'?e.outerHTML:null}})),null,2));
 return page.screenshot(options);
}
