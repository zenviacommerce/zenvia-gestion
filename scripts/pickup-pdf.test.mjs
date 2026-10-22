import assert from 'node:assert/strict';
import {getDocument,OPS} from 'pdfjs-dist/legacy/build/pdf.mjs';
import { writeFile } from 'node:fs/promises';
import { pickupFixture, pickupLogoFixture, loadPdfModule } from './pickup-pdf-fixture.mjs';
const { createPickupReportPdfBlob, pickupReportPdfFilename } = await loadPdfModule();
const path='tmp/pdfs/pickup-test.pdf';
await writeFile(path,Buffer.from(await createPickupReportPdfBlob(pickupFixture).arrayBuffer()));
async function extract(blob){const pdf=await getDocument({data:new Uint8Array(await blob.arrayBuffer()),useSystemFonts:true,disableFontFace:true}).promise;const pages=[];for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n);const content=await page.getTextContent();pages.push(content.items.map(i=>i.str).join(' '))}await pdf.destroy();return pages.join('\f')+'\f'}
const text=await extract(createPickupReportPdfBlob(pickupFixture));
const pages=text.split('\f').filter(page=>page.trim());
assert.ok(pages.length>=2,'48 rows must produce separate carrier sheets');
assert.equal((text.match(/Firma del conductor\/a/g)||[]).length,2);
assert.equal((text.match(/Firma \/ sello del remitente/g)||[]).length,2);
assert.ok(text.includes('39 bultos / 26 envíos'));
assert.ok(text.includes('33 bultos / 22 envíos'));
for(const item of pickupFixture.items) assert.ok(text.includes(item.orderNumber),item.orderNumber);
for(const secret of ['PRIVATE BUYER','private-buyer','internal-user','internal-order','internal-report']) assert.ok(!text.includes(secret),secret);
for(let i=0;i<pages.length;i++) {
  assert.ok(pages[i].includes(`Página ${i+1} de ${pages.length}`));
  assert.ok(pages[i].includes('Zenvia Commerce SL'));
  assert.ok(pages[i].includes('Europe/Madrid'));
  assert.ok(!(pages[i].includes('Transportista: MRW') && pages[i].includes('Transportista: Correos Express')));
}
assert.equal(pickupReportPdfFilename({...pickupFixture,number:'REC/42'}),'REC_42.pdf');
assert.throws(()=>createPickupReportPdfBlob({...pickupFixture,items:[]}),/no contiene/);
// An extremely long tracking ID is continued, never silently truncated.
const long='LONGTRACK'+ '1234567890'.repeat(250)+'TRACKEND';
await writeFile(path,Buffer.from(await createPickupReportPdfBlob({...pickupFixture,items:[{...pickupFixture.items[0],orderNumber:'LONGORDER'+ 'abcdefghij'.repeat(250)+'ORDEREND',trackingNumber:long}]}).arrayBuffer()));
const longText=await extract(createPickupReportPdfBlob({...pickupFixture,items:[{...pickupFixture.items[0],orderNumber:'LONGORDER'+ 'abcdefghij'.repeat(250)+'ORDEREND',trackingNumber:long}]}));
assert.ok(longText.includes('LONGTRACK')); assert.ok(longText.replace(/\s+/g,'').includes('TRACKEND'));
assert.ok(longText.replace(/\s+/g,'').includes('ORDEREND'));
assert.ok(longText.includes('Firma del conductor/a'));
console.log(`Pickup PDF tests passed: ${pages.length} pages, carrier grouping, signatures, privacy, wrapping and footer.`);

const lowerCase = await extract(createPickupReportPdfBlob({...pickupFixture,items:pickupFixture.items.slice(0,2).map((item,i)=>({...item,channel:i?'shopify':'amazon'}))},{generatedAt:new Date('2026-10-20T07:45:00Z')}));
assert.ok(lowerCase.includes('Amazon'));assert.ok(lowerCase.includes('Shopify'));
assert.ok(!lowerCase.includes('shopify'));assert.ok(!lowerCase.includes('amazon'));
assert.ok(lowerCase.includes('Fecha y hora de recogida:'));
assert.ok(lowerCase.includes('9:30'));assert.ok(lowerCase.includes('9:45'));

// Check PDF drawing geometry, not only extracted text: no separator crosses text,
// signature rectangles are 60 x 25 mm, tracking stays in its column.
const styled = await getDocument({data:new Uint8Array(await createPickupReportPdfBlob(pickupFixture,{logoDataUrl:pickupLogoFixture}).arrayBuffer()),useSystemFonts:true,disableFontFace:true}).promise;
let boxes=0,logos=0;const mm=72/25.4;
for(let n=1;n<=styled.numPages;n++){
 const page=await styled.getPage(n), content=await page.getTextContent(), ops=await page.getOperatorList();
 const orders=content.items.filter(i=>/^PED-2026-/.test(i.str)).length;
 const channels=content.items.filter(i=>/ · (Amazon|Shopify)$/.test(i.str)).length;
 assert.equal(channels,orders,'A normal row must not leave its channel orphaned on another page');
 for(let j=0;j<ops.fnArray.length;j++){
  const fn=ops.fnArray[j],args=ops.argsArray[j];
  if(fn===OPS.setCharSpacing)assert.equal(args[0],0,'No manual character spacing');
  if(fn===OPS.paintImageXObject)logos++;
  if(fn!==OPS.constructPath)continue;
  const [commands,coords]=args;
  if(commands.length===1&&commands[0]===OPS.rectangle&&Math.abs(Math.abs(coords[3])/mm-25)<0.1&&Math.abs(coords[2]/mm-60)<0.1)boxes++;
  if(commands.length!==2||commands[0]!==OPS.moveTo||commands[1]!==OPS.lineTo||coords[1]!==coords[3])continue;
  const y=coords[1];
  for(const item of content.items){if(!item.str?.trim())continue;const [,,,,x,baseline]=item.transform;if(x+item.width<coords[0]||x>coords[2])continue;assert.ok(y<baseline-1||y>baseline+item.height,'Separator overlaps '+item.str);}
 }
 for(const item of content.items){if(item.str?.trim()&&Math.abs(item.transform[4]/mm-77)<0.2)assert.ok(item.width/mm<=112.1,'Tracking escapes its column: '+item.str);}
}
assert.equal(boxes,4,'Two 60 x 25mm signature boxes per carrier');assert.equal(logos,styled.numPages,'Logo on every page');await styled.destroy();
