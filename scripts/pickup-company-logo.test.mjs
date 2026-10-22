import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {getDocument,OPS} from 'pdfjs-dist/legacy/build/pdf.mjs';
const realLogo=await readFile('tests/fixtures/company-logo-production.png');
const h=globalThis.pickupLogoHarness={mode:'real',payload:realLogo,mime:'image/png',calls:[],links:[],blobs:new Map(),client:{}};
const native={window:globalThis.window,Image:globalThis.Image,document:globalThis.document,create:URL.createObjectURL,revoke:URL.revokeObjectURL};
let serial=0;
URL.createObjectURL=blob=>{const key='blob:logo-'+(++serial);h.blobs.set(key,blob);return key};
URL.revokeObjectURL=key=>h.blobs.delete(key);
globalThis.Image=class {
 set src(value){const blob=h.blobs.get(value);void blob.arrayBuffer().then(b=>loadImage(Buffer.from(b))).then(image=>{this.native=image;this.naturalWidth=image.width;this.naturalHeight=image.height;this.onload?.()}).catch(()=>this.onerror?.())}
};
globalThis.window={setTimeout:()=>0};
globalThis.document={createElement(tag){
 if(tag==='a')return {click(){h.links.push({filename:this.download,blob:h.blobs.get(this.href)})},remove(){}};
 assert.equal(tag,'canvas');const canvas=createCanvas(1,1);return {
 get width(){return canvas.width},set width(v){canvas.width=v},get height(){return canvas.height},set height(v){canvas.height=v},
 getContext(){const ctx=canvas.getContext('2d');return {clearRect:(...a)=>ctx.clearRect(...a),drawImage:(image,...a)=>ctx.drawImage(image.native,...a)}},
 toDataURL:()=>canvas.toDataURL('image/png')};
},body:{appendChild(){}}};
await mkdir('tmp/pdfs',{recursive:true});
await build({stdin:{contents:"export {loadCompanyBranding} from './src/services/companyBranding'; export {createPickupReportPdfBlob,downloadPickupReportPdf} from './src/services/pickupReportPdf';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',outfile:'tmp/pdfs/pickup-company-logo-test.mjs',plugins:[{name:'authenticated-storage-boundary',setup(b){b.onResolve({filter:/^\.\/pickupReportDocuments$/},()=>({path:'document-reader',namespace:'document-reader'}));b.onLoad({filter:/.*/,namespace:'document-reader'},()=>({contents:'export const getPickupDocumentPdf=()=>globalThis.pickupLogoHarness.serverPdf();'}));b.onResolve({filter:/^\.\/supabase$/},()=>({path:'supabase',namespace:'logo-test'}));b.onLoad({filter:/.*/,namespace:'logo-test'},()=>({contents:`
const h=globalThis.pickupLogoHarness;
export const getActiveSupabase=()=>supabase;export const getActiveTenant=()=>({workspace_id:'fixture-workspace'});
export const supabase={from(table){const query={select(){return query},eq(column,value){if(table==='company_branding'){if(column!=='owner_id'||value!=='fixture-owner')throw Error('Wrong owner')}return query},async maybeSingle(){h.calls.push({table});return {data:table==='business_settings'?{owner_id:'fixture-owner'}:{logo_path:h.mode==='none'?null:'fixture-owner/branding/logo.webp'},error:null}}};return query},storage:{from(bucket){if(bucket!=='company-assets')throw Error('Wrong bucket');return {async download(path){h.calls.push({bucket,path});if(path!=='fixture-owner/branding/logo.webp')throw Error('Wrong path');return h.mode==='failed'?{data:null,error:Error('Storage unavailable')}:{data:new Blob([h.payload],{type:h.mime}),error:null}}}}}};
`}))}}]});
const {loadCompanyBranding,createPickupReportPdfBlob,downloadPickupReportPdf}=await import(pathToFileURL(process.cwd()+'/tmp/pdfs/pickup-company-logo-test.mjs').href);
const report={id:'fixture-report',number:'REC-2026-0042',createdAt:'2026-10-20T07:30:00Z',createdBy:'fixture-user',sender:{legalName:'Zenvia Commerce SL',taxId:'B12345678',address:'Synthetic company address',email:'logistica@example.test',phone:''},items:[{orderId:'fixture-order',orderNumber:'DEMO-001',channel:'amazon',carrier:'MRW',trackingNumber:'TRACK-123',packages:1}],totalPackages:1};
// Server-PDF boundary is mocked here; real Edge optional-branding behavior has handler tests.
h.serverPdf=async()=>{let branding={logoDataUrl:null};try{branding=await loadCompanyBranding()}catch{}return createPickupReportPdfBlob(report,{logoDataUrl:branding.logoDataUrl})};
async function inspect(blob){const pdf=await getDocument({data:new Uint8Array(await blob.arrayBuffer()),useSystemFonts:true,disableFontFace:true}).promise;const page=await pdf.getPage(1),ops=await page.getOperatorList(),text=(await page.getTextContent()).items.map(x=>x.str).join(' ');const images=ops.fnArray.filter(x=>x===OPS.paintImageXObject).length;await pdf.destroy();return {images,text}}
async function rgba(buffer){const image=await loadImage(buffer),canvas=createCanvas(image.width,image.height);canvas.getContext('2d').drawImage(image,0,0);return {width:image.width,height:image.height,pixels:canvas.getContext('2d').getImageData(0,0,image.width,image.height).data}}
test('real General logo from company-assets passes authenticated download, PNG conversion and jsPDF embedding',async()=>{
 h.mode='real';h.payload=realLogo;h.mime='image/png';h.calls=[];
 const branding=await loadCompanyBranding();assert.match(branding.logoDataUrl,/^data:image\/png;base64,/);
 assert.deepEqual(h.calls,[{table:'business_settings'},{table:'company_branding'},{bucket:'company-assets',path:'fixture-owner/branding/logo.webp'}]);
 assert.deepEqual(await rgba(Buffer.from(branding.logoDataUrl.split(',')[1],'base64')),await rgba(realLogo),'Actual logo pixels retained');
 const pdf=await inspect(createPickupReportPdfBlob(report,{logoDataUrl:branding.logoDataUrl}));assert.equal(pdf.images,1);assert.match(pdf.text,/Zenvia Commerce SL/);
});
test('stored JPEG, WebP and SVG are rasterized to PNG before jsPDF',async()=>{
 const source=await loadImage(realLogo),canvas=createCanvas(source.width,source.height);canvas.getContext('2d').drawImage(source,0,0);
 for(const [mime,payload] of [['image/jpeg',canvas.toBuffer('image/jpeg')],['image/webp',canvas.toBuffer('image/webp')],['image/svg+xml',Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="100"><rect width="150" height="100" fill="#13805e"/></svg>')]]){
 h.mode='real';h.mime=mime;h.payload=payload;const branding=await loadCompanyBranding();assert.match(branding.logoDataUrl,/^data:image\/png;base64,/);assert.equal((await inspect(createPickupReportPdfBlob(report,{logoDataUrl:branding.logoDataUrl}))).images,1);
 }
});
test('no configured logo skips Storage and prints the company name without an invented logo',async()=>{
 h.mode='none';h.calls=[];const branding=await loadCompanyBranding();assert.equal(branding.logoDataUrl,null);assert.equal(h.calls.filter(x=>x.bucket).length,0);
 const pdf=await inspect(createPickupReportPdfBlob(report,{logoDataUrl:branding.logoDataUrl}));assert.equal(pdf.images,0);assert.match(pdf.text,/Zenvia Commerce SL/);
});
test('Storage failure still downloads a printable PDF with saved sender text',async()=>{
 h.mode='failed';h.links=[];await downloadPickupReportPdf(report);assert.equal(h.links.length,1);assert.equal(h.links[0].filename,'REC-2026-0042.pdf');const pdf=await inspect(h.links[0].blob);assert.equal(pdf.images,0);assert.match(pdf.text,/Zenvia Commerce SL/);
});
after(()=>{URL.createObjectURL=native.create;URL.revokeObjectURL=native.revoke;globalThis.Image=native.Image;globalThis.document=native.document;globalThis.window=native.window;delete globalThis.pickupLogoHarness});
