// @vitest-environment node
import{it,expect}from'vitest';import{readFileSync}from'node:fs';import{createRequire}from'node:module';import{dirname}from'node:path';import{createCanvas,DOMMatrix,ImageData,Path2D}from'@napi-rs/canvas';import{createPickupReportPdfBlob}from'../src/services/pickupReportPdf';
Object.assign(globalThis,{DOMMatrix,ImageData,Path2D});
const mm=72/25.4,report={id:'synthetic',number:'REC-PRUEBA-LOGO',createdAt:'2026-10-23T06:03:00Z',createdBy:'fixture',sender:{legalName:'DOCUMENTO DE PRUEBA',taxId:'DEMO',address:'Madrid',email:'test@example.test',phone:''},items:[{orderId:'test',orderNumber:'SYNTHETIC',channel:'amazon',carrier:'MRW',trackingNumber:'SYNTHETIC-1',packages:1}],totalPackages:1};
const image=(path:string,mime:string)=>'data:'+mime+';base64,'+readFileSync('tests/fixtures/'+path).toString('base64');
for(const format of ['png','webp','webp-lossy'])for(const signed of [false,true])it(`renders transparent ${format} logo/stamp on white without touching the title (signed=${signed})`,async()=>{
 const{getDocument,OPS}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const logo=image(format==='png'?'company-logo-production.png':format==='webp-lossy'?'company-logo-transparent-lossy.webp':'company-logo-transparent.webp',format==='png'?'image/png':'image/webp'),stamp=image('pickup-stamp-transparent'+(format==='webp-lossy'?'-lossy.webp':'.'+format),format==='png'?'image/png':'image/webp');
 const signatures=signed?[{carrier:'MRW',driverName:'CONDUCTOR DE PRUEBA',identifier:'TEST-PLATE',receivedAt:'2026-10-23T06:10:00Z',packages:1,signatureDataUrl:image('pickup-signature-synthetic.png','image/png')}]:[];
 const blob=createPickupReportPdfBlob(report,{logoDataUrl:logo,stampDataUrl:stamp,requireStamp:signed,signatures});
 const pdf=await getDocument({data:new Uint8Array(await blob.arrayBuffer()),standardFontDataUrl:dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))+'/standard_fonts/'}).promise;
 try{const page=await pdf.getPage(1),ops=await page.getOperatorList(),images=ops.fnArray.map((fn:number,i:number)=>fn===OPS.paintImageXObject?ops.argsArray[ops.fnArray.lastIndexOf(OPS.transform,i)]:null).filter(Boolean);
 const logoBox=images.find((t:number[])=>t[5]>page.view[3]-26*mm);expect(logoBox).toBeTruthy();expect(logoBox[0]).toBeLessThanOrEqual(30*mm+.01);expect(logoBox[3]).toBeLessThanOrEqual(12*mm+.01);
 const title:any=(await page.getTextContent()).items.find((item:any)=>item.str==='JUSTIFICANTE DE RECOGIDA');expect(logoBox[5]).toBeGreaterThan(title.transform[5]+title.height);
 const viewport=page.getViewport({scale:3}),canvas=createCanvas(viewport.width,viewport.height),ctx=canvas.getContext('2d');await page.render({canvasContext:ctx as any,viewport}).promise;
 const pixel=(t:number[])=>{const x=Math.round((t[4]+.3*mm)*3),y=Math.round((page.view[3]-t[5]-t[3]+.3*mm)*3);return Array.from(ctx.getImageData(x,y,1,1).data).slice(0,3)};
 expect(pixel(logoBox).every(channel=>channel>=245)).toBe(true);const stampBox=images.find((t:number[])=>t[4]>110*mm);expect(stampBox).toBeTruthy();expect(stampBox[4]).toBeGreaterThanOrEqual(112*mm-.01);expect(stampBox[4]+stampBox[0]).toBeLessThanOrEqual(168*mm+.01);expect(pixel(stampBox).every(channel=>channel>=245)).toBe(true);
 }finally{await pdf.destroy()}
});
