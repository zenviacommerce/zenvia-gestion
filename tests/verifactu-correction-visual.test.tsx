import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {SalesInvoice} from '../src/services/sales';

const fixture=vi.hoisted(()=>({invoices:[] as any[],receipts:[] as any[],tables:{} as Record<string,any[]>,issueFails:false,events:[] as string[],calls:[] as {name:string,args:any}[],cancellations:[] as any[]}));
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
  fixture.events.push(name);fixture.calls.push({name,args});
  if(name==='verifactu_shadow_status')return {data:{cancellations:fixture.cancellations},error:null};
  if(name==='create_sales_invoice_correction'){
   const source=fixture.invoices.find(i=>i.id===args.p_original_id);
   const draft={...source,id:'new-correction',invoiceNumber:null,status:'draft',invoiceType:'rectifying',seriesId:'r',rectifiesInvoiceId:source.id,verifactuType:args.p_type,rectificationMode:args.p_mode,rectificationReason:args.p_reason,rectificationOriginalNumber:source.invoiceNumber,rectificationOriginalDate:source.issueDate,rectificationOriginalBase:source.subtotal,rectificationOriginalTax:source.taxAmount,lines:source.lines.map((l:any)=>({...l,unitPrice:args.p_mode==='S'?l.unitPrice:0}))};
   fixture.invoices.push(draft);fixture.tables.sales_invoices=[...(fixture.tables.sales_invoices||[]),draft];return {data:draft.id,error:null};
  }

  if(name==='issue_sales_receipt_document'){
   if(fixture.issueFails)return {data:null,error:new Error('Registro sombra no disponible')};
   const row=fixture.tables.sales_receipts?.find(item=>item.id===args.p_receipt_id);Object.assign(row,{status:'issued',issued_at:'2026-10-24T12:00:00Z',receipt_number:'REC-2026-0001'});return {data:row,error:null};
  }
  return {data:null,error:null};
 }
}}));
vi.mock('../src/context/SettingsContext',async()=>{const {DEFAULT_APP_SETTINGS}=await import('../src/services/settingsSchema');return {useSettings:()=>({settings:{...DEFAULT_APP_SETTINGS,sales:{...DEFAULT_APP_SETTINGS.sales,allowEditIssuedInvoices:true}},preferences:{},warnings:[],loading:false,error:'',patchPreferences:async()=>{}})}});
vi.mock('../src/services/sales',async original=>({...await original<any>(),ensureSalesSeries:async()=>[{id:'s',kind:'standard',active:true,prefix:'F-2026-',nextNumber:1,padding:4,name:'Serie F'},{id:'r',kind:'rectifying',active:true,prefix:'R-2026-',nextNumber:1,padding:4,name:'Serie R'}],loadSalesInvoices:async()=>fixture.invoices,loadClients:async()=>[],loadBusinessSettings:async()=>({legalName:'Empresa prueba'})}));
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
import {SalesInvoices} from '../src/pages/SalesInvoicesCore';
import {SalesReceipts} from '../src/pages/SalesReceipts';
import {createSalesReceipt,updateSalesReceipt} from '../src/services/salesReceipts';


import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const output=process.env.VF_CORRECTION_CAPTURE;
function sample(status='issued',id='original'):SalesInvoice{return {id,status,invoiceNumber:status==='draft'?null:'F202655',invoiceType:'standard',clientName:'Cliente de demostración',issuerName:'Emisor sintético · SIN VALIDEZ FISCAL',issuerTaxId:'SINTETICO-NO-VALIDO',notes:'DEMOSTRACIÓN SIN VALIDEZ FISCAL. No emitida en producción ni remitida a la AEAT.',issueDate:'2026-10-24',operationDate:'2026-10-20',dueDate:'2026-11-23',clientId:'c',seriesId:'s',seriesName:'Serie F',currency:'EUR',subtotal:100,taxAmount:21,totalAmount:121,discountAmount:0,paidAmount:0,lines:[{position:1,description:'Producto de demostración',quantity:2,unit:'ud',unitPrice:50,discountPercent:0,taxRate:21,lineTotal:121}],payments:[]} as SalesInvoice}
function save(name:string){
 const clone=document.documentElement.cloneNode(true) as HTMLElement;document.querySelectorAll('input').forEach((live,index)=>{const target=clone.querySelectorAll('input')[index];if(live.type==='checkbox'||live.type==='radio'){if(live.checked)target.setAttribute('checked','');else target.removeAttribute('checked');}else target.setAttribute('value',live.value)});clone.lang='es';clone.dataset.visualFixture='synthetic-offline';
 clone.querySelector('head')!.innerHTML='<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'+name+' · Datos sintéticos, sin producción</title><link rel="stylesheet" href="../20261024-verifactu-phase1/visual-fixture.css"><link rel="stylesheet" href="visual-correction.css">';
 writeFileSync(resolve(output!,name+'.html'),'<!doctype html>\n'+clone.outerHTML);
}
it.skipIf(!output)('exports the correction circuit from actual rendered components using synthetic data only',async()=>{
 mkdirSync(output!,{recursive:true});writeFileSync(resolve(output!,'visual-correction.css'),readFileSync('src/components/SalesCorrectionModals.css','utf8'));fixture.invoices=[sample()];
 render(<SalesInvoices/>);await screen.findAllByText('F202655');save('01-issued-list');
 fireEvent.click(screen.getByTitle('Ver detalle'));await screen.findByText(/Las facturas emitidas no se pueden editar/);save('02-immutable-detail');
 fireEvent.click(screen.getAllByRole('button',{name:'Crear rectificativa'}).at(-1)!);
 await chooseSelect('Tipo de rectificativa',/^R1/);await chooseSelect('Modalidad de rectificación',/^S ·/);fireEvent.change(screen.getByLabelText('Motivo de la rectificación'),{target:{value:'Devolución parcial acordada: una unidad'}});save('03-correction-classification');
 fireEvent.click(screen.getByRole('button',{name:'Crear borrador rectificativo'}));await screen.findByRole('heading',{name:'Rectificativa en borrador'});await waitFor(()=>expect(screen.getByDisplayValue('Producto de demostración')).toBeTruthy());save('04-correction-editor');cleanup();
 const original=sample();const correction={...sample('issued','correction'),invoiceType:'rectifying',seriesId:'r',invoiceNumber:'R20260001',rectifiesInvoiceId:original.id,verifactuType:'R1',rectificationMode:'S',rectificationReason:'Devolución parcial acordada: una unidad',rectificationOriginalNumber:'F202655',rectificationOriginalDate:'2026-10-24',rectificationOriginalBase:100,rectificationOriginalTax:21,subtotal:50,taxAmount:10.5,totalAmount:60.5,lines:[{...original.lines[0],quantity:1,lineTotal:60.5}]} as SalesInvoice;
 fixture.invoices=[{...original,fiscalStatus:'rectified',relatedCorrections:[{id:correction.id,number:correction.invoiceNumber!,status:'issued'}]},correction];render(<SalesInvoices/>);await screen.findAllByText('R20260001');save('05-correction-issued-list');fireEvent.click(screen.getAllByTitle('Ver detalle')[1]);await screen.findByText('Factura original');save('06-correction-issued-detail');
 fireEvent.click(screen.getByRole('button',{name:'Anular'}));await screen.findByRole('heading',{name:'Anular factura'});await chooseSelect('Supuesto de anulación',/^Emisión duplicada/);fireEvent.change(screen.getByLabelText('Motivo de la anulación'),{target:{value:'Rectificativa duplicada, emitida por error en esta demostración'}});fireEvent.click(screen.getByLabelText(/Confirmo que procede anular/));save('07-cancellation-confirm');cleanup();
 fixture.invoices=[original,{...correction,fiscalStatus:'cancelled',cancelledAt:'2026-10-24T19:00:00Z'}];render(<SalesInvoices/>);await screen.findAllByText('Anulada');save('08-cancelled-list');
 const pdf=await vi.importActual<any>('../src/services/salesInvoicePdf');const blob=pdf.createSalesInvoicePdfBlob(correction);const buffer=await new Promise<ArrayBuffer>((res,rej)=>{const reader=new FileReader();reader.onload=()=>res(reader.result as ArrayBuffer);reader.onerror=rej;reader.readAsArrayBuffer(blob)});writeFileSync(resolve(output!,'rectificativa-synthetic.pdf'),Buffer.from(buffer));cleanup();
});

async function chooseSelect(label:string,option:RegExp){fireEvent.click(screen.getByRole('combobox',{name:label}));fireEvent.click(await screen.findByRole('option',{name:option}));}
