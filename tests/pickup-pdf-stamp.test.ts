// @vitest-environment node
import {expect,it} from 'vitest';
import {createRequire} from 'node:module';
import {dirname} from 'node:path';
import {getDocument,OPS} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {createPickupReportPdfBlob} from '../src/services/pickupReportPdf';
const report={id:'report',number:'REC-2026-0042',createdAt:'2026-10-20T07:30:00Z',createdBy:'user',sender:{legalName:'Sender SL',taxId:'TAX',address:'Company address',email:'office@example.test',phone:''},items:[{orderId:'order',orderNumber:'406-1',channel:'amazon',carrier:'MRW',trackingNumber:'REAL-123',packages:1}],totalPackages:1};
// Explicit synthetic fixture: 1px stamp, used only to inspect PDF placement.
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
it('embeds the stamp only in the sender box, proportionally within its inner edges',async()=>{
 const blob=createPickupReportPdfBlob(report,{stampDataUrl:png});const pdf=await getDocument({data:new Uint8Array(await blob.arrayBuffer()),standardFontDataUrl:dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))+'/standard_fonts/'}).promise;
 const page=await pdf.getPage(1),ops=await page.getOperatorList();const images=ops.fnArray.map((fn,i)=>fn===OPS.paintImageXObject?i:-1).filter(i=>i>=0);
 expect(images).toHaveLength(1);const index=images[0],transformIndex=ops.fnArray.lastIndexOf(OPS.transform,index),transform=ops.argsArray[transformIndex];
 expect(transformIndex).toBeGreaterThanOrEqual(0);expect(transform[0]).toBeCloseTo(transform[3]);
 // PDF coordinates are points, sender starts at x=110mm; driver ends at x=72mm; sender ends at x=170mm.
 expect(transform[4]).toBeGreaterThan(110*72/25.4);expect(transform[4]+transform[0]).toBeLessThan(170*72/25.4);
 await pdf.destroy();
});
it('keeps PDF generation available with an absent or damaged stamp',()=>{
 expect(createPickupReportPdfBlob(report).size).toBeGreaterThan(1000);expect(createPickupReportPdfBlob(report,{stampDataUrl:'corrupt'}).size).toBeGreaterThan(1000);
});

it.each([false,true])('keeps wrapped company names above the address (logo=%s)',async(withLogo)=>{
 const blob=createPickupReportPdfBlob({...report,sender:{...report.sender,legalName:'DISTRIBUIDORA INTERNACIONAL DE SUMINISTROS INDUSTRIALES Y PRODUCTOS DE CONSUMO DEL NOROESTE SOCIEDAD LIMITADA',address:'ADDRESS-START Calle de prueba 28'}},{logoDataUrl:withLogo?png:null});
 const pdf=await getDocument({data:new Uint8Array(await blob.arrayBuffer()),standardFontDataUrl:dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))+'/standard_fonts/'}).promise;
 try{
  const text=await (await pdf.getPage(1)).getTextContent();
  const tax=text.items.find((item:any)=>item.str?.includes('NIF:')) as any;
  const address=text.items.find((item:any)=>item.str?.includes('ADDRESS-START')) as any;
  expect(tax).toBeTruthy();expect(address).toBeTruthy();
  expect(tax.transform[5]-address.transform[5]).toBeGreaterThanOrEqual(3*72/25.4);
 }finally{await pdf.destroy()}
});
