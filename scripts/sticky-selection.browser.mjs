import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {chromium} from 'playwright';

// Run after installing Playwright's Chromium, or set CHROMIUM_EXECUTABLE_PATH.
// Exercise the real stylesheet cascade in a layout engine: jsdom cannot measure sticky cells.
test('selection cells remain visible, opaque and clickable after horizontal scrolling',async()=>{
  const main=await readFile(new URL('../src/main.tsx',import.meta.url),'utf8');
  const paths=['bulk-selection.css',...Array.from(main.matchAll(/import '\.\/([^']+\.css)'/g),m=>m[1])];
  const styles=(await Promise.all(paths.map(path=>readFile(new URL(`../src/${path}`,import.meta.url),'utf8')))).join('\n');
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox']});
  try{
    const page=await browser.newPage();
    for(const width of [1280,390])for(const theme of ['light','dark'])for(const tableClass of ['ordersTable','masterTable','salesTable','']){
      await page.setViewportSize({width,height:650});
      await page.setContent(`<html data-theme="${theme}"><head><style>${styles}</style><style>.fixture{width:calc(100vw - 40px);height:220px;overflow:auto;margin:20px}table{min-width:1600px}thead th{position:sticky;top:0}tbody td{height:52px}</style></head><body><section class="fixture tableCard"><table class="${tableClass}"><thead><tr><th class="bulkSelectionCell"><input aria-label="All" type="checkbox"></th><th>Other content</th></tr></thead><tbody>${Array.from({length:8},(_,i)=>`<tr class="clickableRow ${i===1?'bulkSelectedRow':''}"><td class="bulkSelectionCell"><input aria-label="Row ${i}" type="checkbox"></td><td>Content ${i}</td></tr>`).join('')}</tbody></table></section><div class="bulkMobileSelectableRow"><label class="bulkSelectCheckbox"><input type="checkbox"><span></span></label><div class="masterMobileRow">Card</div></div></body></html>`);
      const before=await page.locator('tbody .bulkSelectionCell').first().boundingBox();
      await page.locator('.fixture').evaluate(el=>{el.scrollLeft=650;});
      const after=await page.locator('tbody .bulkSelectionCell').first().boundingBox();
      assert.ok(Math.abs(before.x-after.x)<1,`${tableClass} ${theme} ${width}: selection moved horizontally`);
      for(const selector of ['thead .bulkSelectionCell','tbody .bulkSelectionCell']){
        const values=await page.locator(selector).first().evaluate(el=>{const s=getComputedStyle(el);return {position:s.position,bg:s.backgroundColor,z:s.zIndex,shadow:s.boxShadow};});
        assert.equal(values.position,'sticky');
        assert.notEqual(values.bg,'rgba(0, 0, 0, 0)');
        assert.ok(!values.bg.startsWith('rgba(')&&!values.bg.includes(' / '),`opaque cell: ${values.bg}`);
        assert.notEqual(values.shadow,'none');
      }
      const selected=page.locator('tr.bulkSelectedRow>.bulkSelectionCell');
      const unselectedBg=await page.locator('tbody .bulkSelectionCell').first().evaluate(el=>getComputedStyle(el).backgroundColor);
      const selectedBg=await selected.evaluate(el=>getComputedStyle(el).backgroundColor);
      assert.notEqual(selectedBg,unselectedBg,'selected cell keeps its row tint');
      assert.ok(!selectedBg.startsWith('rgba(')&&!selectedBg.includes(' / '),`opaque selected cell: ${selectedBg}`);
      await selected.hover();
      assert.notEqual(await selected.evaluate(el=>getComputedStyle(el).backgroundColor),selectedBg,'selected hover remains visible');
      await page.getByRole('checkbox',{name:'Row 0',exact:true}).check();
      assert.equal(await page.getByRole('checkbox',{name:'Row 0',exact:true}).isChecked(),true);
      await page.locator('.fixture').evaluate(el=>{el.scrollTop=65;});
      const header=await page.locator('thead .bulkSelectionCell').boundingBox();
      assert.ok(Math.abs(header.y-21)<2,'sticky header retains vertical position');
      assert.equal(await page.evaluate(({x,y})=>!!document.elementFromPoint(x,y)?.closest('thead'),{x:header.x+15,y:header.y+15}),true,'header selection paints over scrolled body cells');
      assert.equal(await page.locator('.bulkMobileSelectableRow>.bulkSelectCheckbox').evaluate(el=>getComputedStyle(el).position),'relative');
    }
  }finally{await browser.close();}
});
