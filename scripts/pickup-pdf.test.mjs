import assert from 'node:assert/strict';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import { writeFile } from 'node:fs/promises';
import { pickupFixture, loadPdfModule } from './pickup-pdf-fixture.mjs';
const { createPickupReportPdfBlob, pickupReportPdfFilename } = await loadPdfModule();
const path='tmp/pdfs/pickup-test.pdf';
await writeFile(path,Buffer.from(await createPickupReportPdfBlob(pickupFixture).arrayBuffer()));
async function extract(blob){const pdf=await getDocument({data:new Uint8Array(await blob.arrayBuffer()),useSystemFonts:true,disableFontFace:true}).promise;const pages=[];for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n);const content=await page.getTextContent();pages.push(content.items.map(i=>i.str).join(' '))}await pdf.destroy();return pages.join('\f')+'\f'}
const text=await extract(createPickupReportPdfBlob(pickupFixture));
const pages=text.split('\f').filter(page=>page.trim());
assert.ok(pages.length>=4,'48 rows must produce multiple carrier sheets');
assert.equal((text.match(/Firma del conductor\/a/g)||[]).length,2);
assert.equal((text.match(/Firma \/ sello del remitente/g)||[]).length,2);
assert.ok(text.includes('39 bultos / 26 envíos'));
assert.ok(text.includes('33 bultos / 22 envíos'));
for(const item of pickupFixture.items) assert.ok(text.includes(item.orderNumber),item.orderNumber);
for(const secret of ['PRIVATE BUYER','private-buyer','internal-user','internal-order','internal-report']) assert.ok(!text.includes(secret),secret);
for(let i=0;i<pages.length;i++) {
  assert.ok(pages[i].includes(`Página ${i+1} / ${pages.length}`));
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
