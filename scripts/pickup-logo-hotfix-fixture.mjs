import {build} from 'esbuild';import{readFile,mkdir,writeFile}from'node:fs/promises';import{pathToFileURL}from'node:url';
const phase=process.argv[2]||'after',out=process.env.PICKUP_LOGO_OUTPUT||'docs/deploy/20261023-pickup-logo-hotfix';await mkdir(out,{recursive:true});
await build({entryPoints:['src/services/pickupReportPdf.ts'],outfile:'tmp/pdfs/hotfix-module.mjs',bundle:true,platform:'node',format:'esm'});
const {createPickupReportPdfBlob}=await import(pathToFileURL(process.cwd()+'/tmp/pdfs/hotfix-module.mjs'));
const image=async(name,mime)=>`data:${mime};base64,${(await readFile('tests/fixtures/'+name)).toString('base64')}`;
const report={id:'synthetic-review',number:'REC-PRUEBA-LOGO',createdAt:'2026-10-23T06:03:00Z',createdBy:'synthetic-actor',sender:{legalName:'Zenvia Commerce · DOCUMENTO DE PRUEBA',taxId:'DEMO',address:'Dirección sintética · Madrid',email:'prueba@example.test',phone:''},items:Array.from({length:9},(_,i)=>({orderId:'fixture-'+i,orderNumber:'DEMO-'+(i+1),channel:'amazon',carrier:'MRW',trackingNumber:'SYNTHETIC-'+String(i+1).padStart(6,'0'),packages:1})),totalPackages:9};
const signature={carrier:'MRW',driverName:'CONDUCTOR DE PRUEBA',identifier:'TEST-PLATE',receivedAt:'2026-10-23T06:10:00Z',packages:9,signatureDataUrl:await image('pickup-signature-synthetic.png','image/png')};
for(const kind of ['png','webp'])for(const signed of [false,true]){
 const logoDataUrl=await image(kind==='png'?'company-logo-production.png':'company-logo-transparent.webp','image/'+kind),stampDataUrl=await image('pickup-stamp-transparent.'+kind,'image/'+kind);
 const file=`${phase}-${kind}-${signed?'signed':'pending'}.pdf`,blob=createPickupReportPdfBlob(report,{logoDataUrl,stampDataUrl,generatedAt:new Date('2026-10-23T06:15:00Z'),...(signed?{requireStamp:true,signatures:[signature]}:{})});await writeFile(out+'/'+file,Buffer.from(await blob.arrayBuffer()));
}console.log(JSON.stringify({phase,out,files:4}));
