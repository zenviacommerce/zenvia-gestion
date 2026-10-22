// @vitest-environment node
import {it,expect} from 'vitest';
import {getDocument,OPS} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {createRequire} from 'node:module';import {dirname} from 'node:path';
import {createPickupReportPdfBlob} from '../src/services/pickupReportPdf';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const report={id:'report',number:'REC-SYNTHETIC-42',createdAt:'2026-10-22T09:00:00Z',createdBy:'actor',sender:{legalName:'Sender test SL',taxId:'DEMO',address:'Synthetic address',email:'office@example.test',phone:''},items:[{orderId:'one',orderNumber:'DEMO-1',channel:'shopify',carrier:'MRW',trackingNumber:'SYNTHETIC-000123',packages:2},{orderId:'two',orderNumber:'DEMO-2',channel:'amazon',carrier:'GLS',trackingNumber:'SYNTHETIC-000456',packages:1}],totalPackages:3};
const signature={carrier:'MRW',driverName:'Conductor sintético',identifier:'TEST-PLATE-42',receivedAt:'2026-10-22T10:30:00Z',packages:2,signatureDataUrl:png};
const open=async(blob:Blob)=>getDocument({data:new Uint8Array(await blob.arrayBuffer()),standardFontDataUrl:dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))+'/standard_fonts/'}).promise;
it('embeds a driver signature and sender stamp only in the matching carrier page',async()=>{
 const pdf=await open(createPickupReportPdfBlob(report,{stampDataUrl:png,signatures:[signature]} as any));
 try{expect(pdf.numPages).toBe(2);for(let n=1;n<=2;n++){const page=await pdf.getPage(n),text=(await page.getTextContent()).items.map((x:any)=>x.str||'').join(' '),ops=await page.getOperatorList();
  const signed=text.includes('Transportista: MRW');expect(text.includes(signature.driverName)).toBe(signed);expect(text.includes(signature.identifier)).toBe(signed);
  const positions=ops.fnArray.map((fn,i)=>fn===OPS.paintImageXObject?ops.argsArray[ops.fnArray.lastIndexOf(OPS.transform,i)][4]:null).filter(x=>x!==null);
  expect(positions.filter(x=>x<80*72/25.4)).toHaveLength(signed?1:0);expect(positions.filter(x=>x>110*72/25.4)).toHaveLength(1);
 }}finally{await pdf.destroy()}
});
it('shows actual parcels separately when the driver count differs from the original report',async()=>{
 const pdf=await open(createPickupReportPdfBlob({...report,items:report.items.slice(0,1)},{stampDataUrl:png,signatures:[{...signature,packages:3}]} as any));
 try{const text=(await (await pdf.getPage(1)).getTextContent()).items.map((x:any)=>x.str||'').join(' ');expect(text).toContain('3 bultos');expect(text).toMatch(/informe.*2 bultos/i);expect(text).toContain('TEST-PLATE-42')}finally{await pdf.destroy()}
});
it('retains the rest of the signed report when identifier and signature are removed by retention',async()=>{
 const pdf=await open(createPickupReportPdfBlob({...report,items:report.items.slice(0,1)},{stampDataUrl:png,signatures:[{...signature,identifier:'',signatureDataUrl:null,redacted:true}]}));
 try{const page=await pdf.getPage(1),text=(await page.getTextContent()).items.map((x:any)=>x.str||'').join(' '),ops=await page.getOperatorList();expect(text).toContain(signature.driverName);expect(text).toContain(report.number);expect(text).toContain('SYNTHETIC-000123');expect(text).toContain('TOTAL RECOGIDO');expect(text).toContain('retirad');expect(text).not.toContain(signature.identifier);expect(ops.fnArray.filter(fn=>fn===OPS.paintImageXObject)).toHaveLength(1)}finally{await pdf.destroy()}
});
it('refuses signing without a renderable required sender stamp while unsigned printing remains tolerant',()=>{
 expect(()=>createPickupReportPdfBlob(report,{signatures:[signature],stampDataUrl:'data:image/png;base64,iVBORw==',requireStamp:true} as any)).toThrow('PICKUP_STAMP_REQUIRED');
 expect(()=>createPickupReportPdfBlob(report,{signatures:[signature],requireStamp:true} as any)).toThrow('PICKUP_STAMP_REQUIRED');
 expect(()=>createPickupReportPdfBlob(report,{stampDataUrl:'data:image/png;base64,iVBORw=='})).not.toThrow();
});
