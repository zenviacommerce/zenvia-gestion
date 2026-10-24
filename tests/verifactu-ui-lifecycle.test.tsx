import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {SalesInvoice} from '../src/services/sales';

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
import {SalesInvoices} from '../src/pages/SalesInvoicesCore';
import {SalesReceipts} from '../src/pages/SalesReceipts';
import {createSalesReceipt,updateSalesReceipt} from '../src/services/salesReceipts';

function invoice(id:string,status:string){return {id,status,invoiceNumber:status==='draft'?null:'F-2026-0001',invoiceType:'standard',clientName:`Cliente ${id}`,issueDate:'2026-10-24',clientId:'c',seriesId:'s',currency:'EUR',subtotal:10,taxAmount:2.1,totalAmount:12.1,discountAmount:0,paidAmount:0,lines:[],payments:[]} as SalesInvoice}
const receiptInput={clientId:'c',receiptDate:'2026-10-24',lines:[{position:1,description:'Concepto',quantity:1,unit:'ud',unitPrice:10,discountPercent:0,invoiceTaxRate:21}]};
beforeEach(()=>{fixture.invoices=[];fixture.receipts=[];fixture.tables={};fixture.events=[];fixture.issueFails=false});
afterEach(cleanup);

describe('VERI*FACTU lifecycle controls',()=>{
 it('never offers reopening or deletion of an issued invoice even if the old edit setting is enabled',async()=>{
  fixture.invoices=[invoice('issued','issued')];render(<SalesInvoices/>);
  await screen.findAllByText('F-2026-0001');
  expect(screen.queryByTitle('Editar factura emitida')).toBeNull();
  expect(screen.queryByTitle('Eliminar factura emitida')).toBeNull();
  fireEvent.click(screen.getByTitle('Ver detalle'));
  expect(screen.queryByRole('button',{name:'Editar factura'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Eliminar factura'})).toBeNull();
 });
 it('bulk deletion counts and removes only drafts when issued invoices are selected too',async()=>{
  fixture.invoices=[invoice('issued','issued'),invoice('draft','draft')];fixture.tables.sales_invoices=fixture.invoices.map(row=>({...row}));
  render(<SalesInvoices selectedIds={['issued','draft']}/>);
  const button=await screen.findByRole('button',{name:'Eliminar seleccionadas (1)'});fireEvent.click(button);
  await waitFor(()=>expect(fixture.tables.sales_invoices.map(row=>row.id)).toEqual(['issued']));
  expect(fixture.events).not.toContain('delete_reversible_sales_invoice');
 });
 it('hides edit and delete on closed standalone receipts',async()=>{
  fixture.receipts=[{id:'receipt',status:'issued',issuedAt:'2026-10-24T12:00:00Z',receiptNumber:'REC-2026-0001',receiptDate:'2026-10-24',clientId:'c',clientName:'Cliente',currency:'EUR',totalAmount:10,paidAmount:0,lines:[],payments:[]}];
  render(<SalesReceipts/>);await screen.findByText('REC-2026-0001');
  expect(screen.queryByTitle('Editar')).toBeNull();expect(screen.queryByTitle('Eliminar')).toBeNull();
 });
 it('creates a draft and its lines before the controlled receipt issuance assigns a number',async()=>{
  const result=await createSalesReceipt(receiptInput);
  expect(fixture.tables.sales_receipts[0]).toMatchObject({status:'issued',receipt_number:'REC-2026-0001'});
  expect(fixture.tables.sales_receipt_lines).toHaveLength(1);
  expect(result.receiptNumber).toBe('REC-2026-0001');
  expect(fixture.events).toEqual(['sales_receipts:insert','sales_receipt_lines:insert','issue_sales_receipt_document']);
 });
 it('keeps the saved draft and its lines when shadow receipt issuance fails',async()=>{
  fixture.issueFails=true;
  await expect(createSalesReceipt(receiptInput)).rejects.toMatchObject({message:'Registro sombra no disponible',draftReceiptId:'sales_receipts-1'});
  expect(fixture.tables.sales_receipts[0]).toMatchObject({status:'draft'});expect(fixture.tables.sales_receipt_lines).toHaveLength(1);
  expect(fixture.events.filter(event=>event.endsWith(':delete'))).toEqual([]);
 });
 it('refuses to replace lines when an invoice is no longer a draft',async()=>{
  fixture.tables.sales_invoices=[{id:'closed',status:'issued'}];fixture.tables.sales_invoice_lines=[{id:'line',invoice_id:'closed',description:'Original'}];
  const actual=await vi.importActual<any>('../src/services/sales');
  await expect(actual.updateSalesInvoiceDraft('closed',{clientId:'c',seriesId:'s',issueDate:'2026-10-24',lines:[]},30)).rejects.toThrow(/borrador/i);
  expect(fixture.tables.sales_invoice_lines[0].description).toBe('Original');
 });
 it('refuses to replace receipt lines when its draft was already issued',async()=>{
  fixture.tables.sales_receipts=[{id:'closed',status:'issued'}];fixture.tables.sales_receipt_lines=[{id:'line',receipt_id:'closed',description:'Original'}];
  await expect(updateSalesReceipt('closed',receiptInput)).rejects.toThrow(/borrador/i);
  expect(fixture.tables.sales_receipt_lines[0].description).toBe('Original');
 });
});

it('disables legacy reopening and manual numbering without writing through the old RPCs',async()=>{
 const {reopenSalesInvoice}=await import('../src/services/salesReversible');
 const {updateSalesInvoiceNumber}=await import('../src/services/salesInvoiceNumber');
 await expect(reopenSalesInvoice('closed')).rejects.toThrow(/rectific/i);
 await expect(updateSalesInvoiceNumber('closed','F-2026-9999')).rejects.toThrow(/emitir/i);
 expect(fixture.events).toEqual([]);
});

it('imports the source number as a reference while leaving invoice numbering to issuance',async()=>{
 const {createSalesInvoiceDraftFromCandidate}=await import('../src/services/salesInvoiceImport');
 const candidate={clientId:'c',seriesId:'s',invoiceNumber:'EXTERNAL-77',issueDate:'2026-10-24',notes:'Importación revisada',lines:[{position:1,description:'Producto',quantity:1,unit:'ud',unitPrice:10,discountPercent:0,taxRate:21}]} as any;
 const id=await createSalesInvoiceDraftFromCandidate(candidate,30,'EUR');
 expect(fixture.tables.sales_invoices[0]).toMatchObject({id,status:'draft'});
 expect(fixture.tables.sales_invoices[0].invoice_number).toBeUndefined();
 expect(fixture.tables.sales_invoices[0].notes).toContain('EXTERNAL-77');
 expect(fixture.events).not.toContain('update_sales_invoice_number');
});

it('reviews external import references without requiring the internal fiscal series prefix',async()=>{
 const {SalesInvoiceImportModal}=await import('../src/components/SalesInvoiceImportModal');
 const view=render(<SalesInvoiceImportModal open clients={[]} existingInvoices={[]} onClose={()=>{}} onFinished={()=>{}}/>);
 fireEvent.change(view.container.querySelector('input[type="file"]')!,{target:{files:[new File(['synthetic'],'import.pdf',{type:'application/pdf'})]}});
 await screen.findByText(/EXTERNAL-77/);
 fireEvent.click(screen.getByRole('button',{name:/Revisar/}));
 const reference=screen.getByLabelText('Referencia del documento importado') as HTMLInputElement;
 expect(reference.value).toBe('EXTERNAL-77');
 fireEvent.click(screen.getByRole('button',{name:'Confirmar revisión'}));
 expect(screen.queryByText(/El número debe comenzar por/)).toBeNull();
 await screen.findByText('Revisada');
});

it('does not advertise reopening issued invoices in sales settings',async()=>{
 const {SettingsPage}=await import('../src/pages/Settings');
 render(<SettingsPage isAdmin access={{} as any}/>);
 fireEvent.click(screen.getByRole('tab',{name:/Facturación/}));
 await screen.findByText('Cobros y edición');
 expect(screen.queryByText('Permitir editar facturas emitidas')).toBeNull();
 expect(screen.getByText('Las facturas emitidas se conservan. Para corregirlas, crea una rectificativa.')).toBeTruthy();
});

it('keeps a failed-issuance receipt draft reviewable without offering collection, invoicing or PDF',async()=>{
 fixture.receipts=[{id:'draft',status:'draft',receiptNumber:'Borrador',receiptDate:'2026-10-24',clientId:'c',clientName:'Cliente',currency:'EUR',totalAmount:10,paidAmount:0,lines:[],payments:[]}];
 render(<SalesReceipts/>);await screen.findByText('Borrador');
 expect(screen.getByTitle('Editar borrador')).toBeTruthy();
 expect(screen.queryByTitle('Registrar cobro')).toBeNull();
 expect(screen.queryByTitle('Descargar PDF')).toBeNull();
 fireEvent.click(screen.getByRole('checkbox',{name:'Seleccionar Borrador'}));
 for(const button of screen.getAllByRole('button',{name:/Facturar seleccionados/}))expect((button as HTMLButtonElement).disabled).toBe(true);
});

it('keeps an unissued receipt draft out of collection KPI totals and counts',async()=>{
 fixture.receipts=[{id:'draft',status:'draft',receiptNumber:'Borrador',receiptDate:'2026-10-24',clientId:'c',clientName:'Cliente',currency:'EUR',totalAmount:75,paidAmount:0,lines:[],payments:[]}];
 render(<SalesReceipts/>);await screen.findByText('Borrador');
 const kpis=screen.getByLabelText('Indicadores de recibos');
 expect(kpis.textContent).not.toContain('75,00');
 expect(kpis.textContent).toContain('Pendiente de cobro0,00');
 expect(kpis.textContent).toContain('Recibos pendientes0');
});
