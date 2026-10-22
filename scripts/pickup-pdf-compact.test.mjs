import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {getDocument,OPS} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {pickupFixture,pickupLogoFixture,loadPdfModule} from './pickup-pdf-fixture.mjs';
const {createPickupReportPdfBlob}=await loadPdfModule();
const folder='tmp/pdfs/compact';await mkdir(folder,{recursive:true});
const mm=72/25.4;
for(const count of [9,25,30,60]){
 const items=Array.from({length:count},(_,i)=>({...pickupFixture.items[i%8],orderNumber:`PED-2026-${String(i+1).padStart(5,'0')}`,carrier:'MRW',trackingNumber:`MRW20261020${String(i+1).padStart(15,'0')}`}));
 const blob=createPickupReportPdfBlob({...pickupFixture,items},{logoDataUrl:pickupLogoFixture,generatedAt:new Date('2026-10-20T07:45:00Z')});
 await writeFile(`${folder}/pickup-${count}.pdf`,Buffer.from(await blob.arrayBuffer()));
 const pdf=await getDocument({data:new Uint8Array(await blob.arrayBuffer()),useSystemFonts:true,disableFontFace:true}).promise;
 assert.equal(pdf.numPages,count===60?2:1,`${count} ordinary shipments should use ${count===60?2:1} pages`);
 let signatures=0,boxes=0;const extracted=[];
 for(let n=1;n<=pdf.numPages;n++){
  const page=await pdf.getPage(n),content=await page.getTextContent(),text=content.items.map(i=>i.str).join(' '),ops=await page.getOperatorList();extracted.push(...content.items.map(i=>i.str));
  assert.match(text,/Pedido/);assert.match(text,/Seguimiento/);assert.ok(text.includes(`Página ${n} de ${pdf.numPages}`));assert.ok(text.includes(pickupFixture.number));
  if(text.includes('Firma del conductor/a')){signatures++;assert.match(text,/PED-2026-/, 'Signatures must share page with shipment rows');}
  for(let j=0;j<ops.fnArray.length;j++)if(ops.fnArray[j]===OPS.constructPath){const [commands,coords]=ops.argsArray[j];if(commands.length===1&&commands[0]===OPS.rectangle&&Math.abs(coords[2]/mm-60)<.1&&Math.abs(Math.abs(coords[3])/mm-25)<.1){boxes++;assert.ok((coords[1]+coords[3])/mm>=16,'Signature boxes stay above footer');}}
 }
 for(const item of items){assert.ok(extracted.some(text=>text.includes(item.orderNumber)),item.orderNumber);assert.ok(extracted.includes(item.trackingNumber),'Normal tracking must stay on one line: '+item.trackingNumber);}
 assert.equal(signatures,1);assert.equal(boxes,2,'Two 60 x 25 mm signature boxes');
 console.log(`${count} shipments: ${pdf.numPages} page(s), signatures with rows, 2 signature boxes`);await pdf.destroy();
}
