import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export const pickupFixture = {
  id:'internal-report-uuid-private',number:'REC-2026-0042',createdAt:'2026-10-20T08:15:00Z',createdBy:'internal-user-uuid-private',
  sender:{legalName:'Zenvia Commerce SL',taxId:'B12345678',address:'Calle del Comercio 28, nave 4, 28022 Madrid',email:'logistica@example.test',phone:'+34 910 000 042'},
  totalPackages:72,
  items:Array.from({length:48},(_,i)=>({orderId:`internal-order-${i}`,orderNumber:`PED-2026-${String(i+1).padStart(5,'0')}`,channel:i%2?'Amazon':'Shopify',carrier:i<26?'MRW':'Correos Express',trackingNumber:`${i<26?'MRW':'CEX'}20261020${String(i+1).padStart(15,'0')}${i===8?'0123456789012345678901234567890123456789':''}`,packages:i%2+1,previousReports:[],eligible:true,buyerName:'PRIVATE BUYER NEVER PRINT',buyerEmail:'private-buyer@example.test'})),
};
export async function loadPdfModule() {
  await mkdir('tmp/pdfs',{recursive:true});
  await build({entryPoints:['src/services/pickupReportPdf.ts'],bundle:true,platform:'node',format:'esm',outfile:'tmp/pdfs/pickupReportPdf.mjs'});
  return import(pathToFileURL(`${process.cwd()}/tmp/pdfs/pickupReportPdf.mjs`).href);
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const {createPickupReportPdfBlob}=await loadPdfModule();
  const destination='docs/deploy/pickup-review-20261020/pdf-manifest-sample.pdf';
  await mkdir('docs/deploy/pickup-review-20261020',{recursive:true});
  await writeFile(destination,Buffer.from(await createPickupReportPdfBlob(pickupFixture).arrayBuffer()));
  console.log(destination);
}
