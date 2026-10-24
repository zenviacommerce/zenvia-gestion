import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,symlinkSync,rmSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';

// Offline visual fixtures only. All business rows below are synthetic and all
// data boundaries reuse the isolated lifecycle-test mocks; no backend is used.
const fixture=vi.hoisted(()=>({invoices:[] as any[],receipts:[] as any[],tables:{} as Record<string,any[]>,issueFails:false,events:[] as string[]}));
vi.mock('../src/services/supabase',()=>({supabase:{
 from:(table:string)=>{
  let operation='select',value:any,filters:[string,any][]=[],single=false;
  const execute=()=>{
   const rows=fixture.tables[table]||[];const matches=(row:any)=>filters.every(([key,val])=>row[key]===val);
   let result:any[]=[];
   if(operation==='select')result=rows.filter(matches);
   if(operation==='insert'){result=(Array.isArray(value)?value:[value]).map((row:any)=>({id:`${table}-${rows.length+1}`,status:'draft',...row}));fixture.tables[table]=[...rows,...result];fixture.events.push(`${table}:insert`);}
   if(operation==='update'){result=rows.filter(matches).map((row:any)=>Object.assign(row,value));fixture.events.push(`${table}:update`);}
   if(operation==='delete'){result=rows.filter(matches);fixture.tables[table]=rows.filter(row=>!matches(row));fixture.events.push(`${table}:delete`);}
   return Promise.resolve({data:single?(result[0]||null):result,error:null});
  };
  const chain:any={select:()=>chain,insert:(v:any)=>{operation='insert';value=v;return chain},update:(v:any)=>{operation='update';value=v;return chain},delete:()=>{operation='delete';return chain},eq:(k:string,v:any)=>{filters.push([k,v]);return chain},order:()=>chain,maybeSingle:()=>{single=true;return chain},single:()=>{single=true;return chain},then:(resolve:any,reject:any)=>execute().then(resolve,reject)};
  return chain;
 },
 rpc:async(name:string,args:any)=>{
  fixture.events.push(name);
  if(name==='issue_sales_receipt_document'){
   if(fixture.issueFails)return {data:null,error:new Error('Registro sombra no disponible')};
   const row=fixture.tables.sales_receipts?.find(item=>item.id===args.p_receipt_id);Object.assign(row,{status:'issued',issued_at:'2026-10-24T12:00:00Z',receipt_number:'REC-2026-0001'});return {data:row,error:null};
  }
  return {data:null,error:null};
 }
}}));
vi.mock('../src/context/SettingsContext',async()=>{const {DEFAULT_APP_SETTINGS}=await import('../src/services/settingsSchema');return {useSettings:()=>({settings:{...DEFAULT_APP_SETTINGS,sales:{...DEFAULT_APP_SETTINGS.sales,allowEditIssuedInvoices:true}},preferences:{},warnings:[],loading:false,error:'',patchPreferences:async()=>{}})}});
vi.mock('../src/services/sales',async original=>({...await original<any>(),ensureSalesSeries:async()=>[{id:'s',kind:'standard',active:true,prefix:'F-2026-',nextNumber:1,padding:4,name:'Serie F'}],loadSalesInvoices:async()=>fixture.invoices,loadClients:async()=>[],loadBusinessSettings:async()=>({legalName:'Empresa prueba'})}));
vi.mock('../src/services/salesReceipts',async original=>({...await original<any>(),loadSalesReceipts:async()=>fixture.receipts}));
vi.mock('../src/services/invoiceReaderEnhanced',()=>({readInvoiceDocumentEnhanced:vi.fn()}));
vi.mock('../src/services/salesInvoiceImport',async original=>({...await original<any>(),prepareSalesInvoiceImportCandidate:async()=>({id:'candidate',status:'needs_review',clientId:'c',seriesId:'s',invoiceNumber:'EXTERNAL-77',issueDate:'2026-10-24',dueDate:'2026-11-24',notes:'',lines:[{position:1,description:'Producto',quantity:1,unit:'ud',unitPrice:10,discountPercent:0,taxRate:21}],subtotal:10,taxAmount:2.1,totalAmount:12.1})}));
vi.mock('../src/services/billableProducts',()=>({loadBillableProducts:async()=>[]}));
vi.mock('../src/services/companyBranding',()=>({loadCompanyBranding:async()=>({ownerId:'owner',logoPath:null,logoDataUrl:null})}));
vi.mock('../src/services/actionDialog',()=>({confirmAction:async()=>true,openActionProcess:()=>({setItem:()=>{},finish:()=>{}})}));
vi.mock('../src/components/SendInvoiceModal',()=>({SendInvoiceModal:()=>null}));
vi.mock('../src/components/SalesConfigurationModals',()=>({SeriesManagerModal:()=>null,TaxRegistrationsPanel:()=>null}));
vi.mock('../src/services/toast',()=>({showError:()=>{},showSuccess:()=>{},errorMessage:(e:any)=>e.message}));
vi.mock('../src/services/salesInvoicePdf',()=>({downloadSalesInvoicePdf:()=>{},printSalesInvoicePdf:()=>{}}));
vi.mock('../src/services/salesReceiptPdf',()=>({downloadSalesReceiptPdf:()=>{},printSalesReceiptPdf:()=>{}}));

const root=process.cwd();
const output=process.env.VF_CAPTURE_DIR;
afterEach(cleanup);

function syntheticInvoice(id:string,status:'draft'|'issued'){
 return {id,status,invoiceNumber:status==='draft'?null:'F-2026-0001',invoiceType:'standard',clientName:status==='draft'?'Cliente sintético B':'Cliente sintético A',issueDate:'2026-10-24',dueDate:'2026-11-23',clientId:'c',seriesId:'s',seriesName:'Serie F',currency:'EUR',subtotal:100,taxAmount:21,totalAmount:121,discountAmount:0,paidAmount:0,clientTaxId:'SINTETICO-NO-VALIDO',issuerName:'Empresa de demostración',lines:[{id:`line-${id}`,position:1,description:'Servicio de demostración',quantity:1,unit:'ud',unitPrice:100,discountPercent:0,taxRate:21,lineTotal:121}],payments:[]};
}
function syntheticReceipt(id:string,status:'draft'|'issued'){
 return {id,status,issuedAt:status==='issued'?'2026-10-24T12:00:00Z':null,receiptNumber:status==='draft'?'Borrador':'REC-2026-0001',receiptDate:'2026-10-24',clientId:'c',clientName:status==='draft'?'Cliente sintético B':'Cliente sintético A',currency:'EUR',totalAmount:100,paidAmount:0,notes:'Datos sintéticos: evidencia visual local, sin conexión a producción.',lines:[{id:`line-${id}`,position:1,description:'Producto de demostración',quantity:1,unit:'ud',unitPrice:100,discountPercent:0,invoiceTaxRate:21,lineTotal:100}],payments:[]};
}
function cssBundle(){
 // Preserve the application stylesheet order, including the real compiled UI
 // package and all root CSS imports. Receipts share src/sales.css; there is no
 // receipts.css file in this repository.
 const main=readFileSync(join(root,'src/main.tsx'),'utf8');
 const paths=[join(root,'packages/ui/dist/styles.css'),join(root,'packages/ui/dist/forms.css'),...Array.from(main.matchAll(/import ['"](.+?\.css)['"]/g),match=>resolve(root,'src',match[1])),join(root,'src/sales.css'),join(root,'src/bulk-selection.css'),join(root,'src/shared-forms.css')];
 return [...new Set(paths)].filter(existsSync).map(path=>`/* ${path.slice(root.length+1)} */\n${readFileSync(path,'utf8').replace(/@import\s+['"][^'"]+['"];?/g,'')}`).join('\n');
}
function saveHtml(name:string,styles:string,baseline:boolean){
 document.documentElement.lang='es';
 document.documentElement.dataset.visualFixture='synthetic-offline';
 document.documentElement.dataset.stage=baseline?'before':'after';
 document.head.innerHTML='';
 const charset=document.createElement('meta');charset.setAttribute('charset','utf-8');document.head.append(charset);
 const viewport=document.createElement('meta');viewport.name='viewport';viewport.content='width=device-width, initial-scale=1';document.head.append(viewport);
 const provenance=document.createElement('meta');provenance.name='fixture-provenance';provenance.content=baseline?'Componentes originales main: zenvia-gestion; dependencias compartidas y datos sintéticos mockeados.':'Componentes modificados: zenvia-verifactu-phase1; datos sintéticos mockeados.';document.head.append(provenance);
 const title=document.createElement('title');title.textContent=`${name} — demostración sintética sin backend`;document.head.append(title);
 const style=document.createElement('style');style.textContent=styles;document.head.append(style);
 writeFileSync(join(resolve(output!),`visual-${name}.html`),'<!doctype html>\n'+document.documentElement.outerHTML,'utf8');
}

it.skipIf(!output)('exports before/after offline HTML from the real sales and receipt components',async()=>{
 mkdirSync(resolve(output!),{recursive:true});
 const privateCopy=mkdtempSync(join(root,'tests/.verifactu-visual-baseline-'));
 const baselineRoot=process.env.VF_BASELINE_ROOT||resolve(root,'../zenvia-gestion');
 symlinkSync(join(root,'node_modules'),join(privateCopy,'node_modules'),'dir');
 const styles=cssBundle();
 try{
  for(const stage of ['before','after'] as const){
   const baseline=stage==='before';
   let invoicesModule:any,receiptsModule:any;
   if(baseline){
    // Copy only the original page modules. Rewrite their relative imports to
    // the shared dependency tree so the same verified mocks apply, without
    // modifying either source tree. Original component bodies stay unchanged.
    for(const filename of ['SalesInvoicesCore.tsx','SalesReceipts.tsx']){
     const original=readFileSync(join(baselineRoot,'src/pages',filename),'utf8');
     const copied=original.replace(/(from\s+|import\s+)(['"])\.\.\//g,(_all,prefix,quote)=>`${prefix}${quote}${root}/src/`);
     writeFileSync(join(privateCopy,filename),copied,'utf8');
    }
    invoicesModule=await import(/* @vite-ignore */ join(privateCopy,'SalesInvoicesCore.tsx'));
    receiptsModule=await import(/* @vite-ignore */ join(privateCopy,'SalesReceipts.tsx'));
   }else{
    invoicesModule=await import('../src/pages/SalesInvoicesCore');
    receiptsModule=await import('../src/pages/SalesReceipts');
   }
   fixture.invoices=[syntheticInvoice('issued','issued'),syntheticInvoice('draft','draft')];
   fixture.receipts=[syntheticReceipt('issued','issued'),syntheticReceipt('draft','draft')];
   const Invoices=invoicesModule.SalesInvoices;
   render(<Invoices selectedIds={['issued','draft']}/>);
   await screen.findAllByText('F-2026-0001');
   await waitFor(()=>expect(screen.queryByText('Cargando facturación…')).toBeNull());
   saveHtml(`${stage}-invoices`,styles,baseline);
   fireEvent.click(screen.getAllByTitle('Ver detalle')[0]);
   await screen.findByText('Servicio de demostración');
   saveHtml(`${stage}-invoice-detail`,styles,baseline);
   cleanup();
   const Receipts=receiptsModule.SalesReceipts;
   render(<Receipts/>);
   await screen.findByText('REC-2026-0001');
   saveHtml(`${stage}-receipts`,styles,baseline);
   fireEvent.click(screen.getAllByTitle('Ver detalle')[0]);
   await screen.findAllByText('Producto de demostración');
   saveHtml(`${stage}-receipt-detail`,styles,baseline);
   cleanup();
  }
 }finally{rmSync(privateCopy,{recursive:true,force:true});}
},30000);
