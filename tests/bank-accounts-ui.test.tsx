import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {DEFAULT_APP_SETTINGS,DEFAULT_USER_PREFERENCES} from '../src/services/settingsSchema';
import {InvoiceModal} from '../src/pages/SalesInvoicesCore';
import {ReceiptModal} from '../src/pages/SalesReceipts';
import {OrderInvoiceModal} from '../src/components/OrderInvoiceModal';
import {SeriesManagerModal} from '../src/components/SalesConfigurationModals';

const api=vi.hoisted(()=>({accounts:[] as any[],settings:{} as any,saveInvoice:vi.fn(),saveReceipt:vi.fn(),updateReceipt:vi.fn(),orderSave:vi.fn(),seriesSave:vi.fn(),updateInvoice:vi.fn()}));
vi.mock('../src/context/SettingsContext',()=>({useSettings:()=>({settings:api.settings,preferences:DEFAULT_USER_PREFERENCES})}));
vi.mock('../src/services/sales',async original=>({...await original<any>(),
 loadBusinessSettings:async()=>({legalName:'Empresa prueba',countryCode:'ES'}),
 loadClients:async()=>[{id:'client',name:'Cliente prueba',countryCode:'ES'}],
 ensureSalesSeries:async()=>[
  {id:'s1',name:'General',kind:'standard',prefix:'A-',nextNumber:1,padding:4,defaultBankAccountId:null},
  {id:'s2',name:'Canal',kind:'standard',prefix:'B-',nextNumber:1,padding:4,defaultBankAccountId:'b'},
 ],createSalesInvoiceDraft:(...args:any[])=>api.saveInvoice(...args),updateSalesInvoiceDraft:(...args:any[])=>api.updateInvoice(...args),
}));
vi.mock('../src/services/salesConfig',async original=>({...await original<any>(),loadTaxRegistrations:async()=>[],loadManagedSalesSeries:async()=>[],addSalesSeries:(input:any)=>api.seriesSave(input)}));
vi.mock('../src/services/salesInvoiceNumber',()=>({updateSalesInvoiceNumber:async()=>{}}));
vi.mock('../src/services/salesReceipts',async original=>({...await original<any>(),createSalesReceipt:(...args:any[])=>api.saveReceipt(...args),updateSalesReceipt:(...args:any[])=>api.updateReceipt(...args)}));
vi.mock('../src/services/businessBankAccounts',async original=>({...await original<any>(),loadBusinessBankAccounts:async()=>api.accounts}));
vi.mock('../src/services/companyBranding',async original=>({...await original<any>(),loadCompanyBranding:async()=>({logoPath:null,logoDataUrl:null})}));
vi.mock('../src/services/orderInvoices',()=>({prepareOrderInvoice:async()=>({invoice:null,lines:[{position:1,description:'Pedido prueba',quantity:1,unitPrice:10,discountPercent:0,taxRate:21}]}),saveOrderInvoice:(...args:any[])=>api.orderSave(...args)}));
const a={id:'a',alias:'Principal',iban:'ES9121000418450200051332',bic:'CAIXESBBXXX',holder:'Empresa prueba',isDefault:true,archivedAt:null,validationStatus:'valid'};
const b={...a,id:'b',alias:'Ventas',iban:'DE89370400440532013000',isDefault:false};
beforeEach(()=>{api.accounts=[a,b];api.settings=structuredClone(DEFAULT_APP_SETTINGS);api.settings.sales.defaultSeriesId='s1';api.saveInvoice.mockReset().mockResolvedValue('invoice');api.saveReceipt.mockReset().mockResolvedValue('receipt');api.updateReceipt.mockReset().mockResolvedValue(undefined);api.orderSave.mockReset().mockResolvedValue({id:'new',status:'issued'});api.seriesSave.mockReset().mockResolvedValue(undefined);api.updateInvoice.mockReset().mockResolvedValue(undefined)});
afterEach(cleanup);
const clients=[{id:'client',name:'Cliente prueba',countryCode:'ES'}];
async function choose(label:string,option:RegExp|string){fireEvent.click(screen.getByRole('combobox',{name:label}));fireEvent.click(await screen.findByRole('option',{name:option}));}
function invoice(){return render(<InvoiceModal open invoice={null} clients={clients} products={[]} onClose={()=>{}} onSaved={async()=>{}}/>)}
describe('bank choices on real document forms',()=>{
 it('resolves series/global defaults and preserves a manual invoice override on series change',async()=>{
  invoice();expect(await screen.findByRole('combobox',{name:'Cuenta bancaria'})).toBeTruthy();
  await waitFor(()=>expect(screen.getByRole('combobox',{name:'Cuenta bancaria'}).textContent).toContain('Principal'));
  await choose('Serie de facturación',/Canal/);expect(screen.getByRole('combobox',{name:'Cuenta bancaria'}).textContent).toContain('Ventas');
  await choose('Cuenta bancaria',/Principal/);await choose('Serie de facturación',/General/);await choose('Serie de facturación',/Canal/);
  expect(screen.getByRole('combobox',{name:'Cuenta bancaria'}).textContent).toContain('Principal');
  fireEvent.change(screen.getByPlaceholderText('Producto o servicio facturado'),{target:{value:'Servicio'}});fireEvent.click(screen.getByRole('button',{name:'Guardar borrador'}));
  await waitFor(()=>expect(api.saveInvoice).toHaveBeenCalled());expect(api.saveInvoice.mock.calls[0][0]).toMatchObject({bankAccountId:'a',paymentMethodId:'bank_transfer'});
 });
 it('warns precisely when a transfer has no bank and allows cash receipt without a bank',async()=>{
  api.accounts=[];render(<ReceiptModal receipt={null} clients={clients} products={[]} onClose={()=>{}} onSaved={async()=>{}}/>);
  expect(await screen.findByText('Falta una cuenta bancaria en Configuración → General')).toBeTruthy();
  expect(screen.getByRole('link',{name:'Configurar cuentas bancarias'})).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Descripción'),{target:{value:'Servicio'}});fireEvent.click(screen.getByRole('button',{name:'Guardar recibo'}));expect(api.saveReceipt).not.toHaveBeenCalled();
  await choose('Forma de pago del recibo','Efectivo');fireEvent.click(screen.getByRole('button',{name:'Guardar recibo'}));
  await waitFor(()=>expect(api.saveReceipt).toHaveBeenCalled());expect(api.saveReceipt.mock.calls[0][0]).toMatchObject({bankAccountId:null,paymentMethodId:'cash'});
 });
 it('shows the frozen bank on receipt edit without a live selector or replacement',async()=>{
  const receipt={id:'r',clientId:'client',receiptDate:'2026-10-01',notes:'',paidAmount:0,lines:[{position:1,description:'Servicio',quantity:1,unit:'ud',unitPrice:10,discountPercent:0,invoiceTaxRate:21}],bankAccountId:'old',bankAccountSnapshot:{version:1,accountId:'old',alias:'Cuenta archivada',iban:'FR1420041010050500013M02606',bic:null,holder:null},bankSnapshotSource:'receipt_created',bankSnapshotAt:'2026-10-01T10:00:00Z'};
  render(<ReceiptModal receipt={receipt as any} clients={clients} products={[]} onClose={()=>{}} onSaved={async()=>{}}/>);
  expect(screen.getByText('FR1420041010050500013M02606')).toBeTruthy();expect(screen.queryByRole('combobox',{name:'Cuenta bancaria'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Guardar recibo'}));await waitFor(()=>expect(api.updateReceipt).toHaveBeenCalled());expect(api.updateReceipt.mock.calls[0][1]).not.toHaveProperty('bankAccountId');
 });
});

it('shows an archived draft selection as unavailable without silently using the current default',async()=>{
 const draft={id:'draft-old',clientId:'client',seriesId:'s1',issueDate:'2026-10-01',invoiceType:'standard',invoiceNumber:'A-0001',lines:[],bankAccountId:'archived'};
 render(<InvoiceModal open invoice={draft as any} clients={clients} products={[]} onClose={()=>{}} onSaved={async()=>{}}/>);
 expect(await screen.findByRole('combobox',{name:'Cuenta bancaria'})).toBeTruthy();
 await waitFor(()=>expect(screen.getByRole('combobox',{name:'Cuenta bancaria'}).textContent).toContain('Cuenta no disponible'));
 expect(screen.getByText('La cuenta bancaria seleccionada ya no está disponible. Elige otra cuenta.')).toBeTruthy();
 expect(screen.getByRole('combobox',{name:'Cuenta bancaria'}).textContent).not.toContain('Principal');
});
it('persists a series-specific account and offers the global default as an explicit fallback',async()=>{
 render(<SeriesManagerModal open onClose={()=>{}}/>);
 expect(await screen.findByRole('combobox',{name:'Cuenta bancaria de la serie'})).toBeTruthy();
 expect(screen.getByRole('combobox',{name:'Cuenta bancaria de la serie'}).textContent).toContain('Predeterminada global');
 await choose('Cuenta bancaria de la serie',/Ventas/);
 fireEvent.change(screen.getByLabelText('Código'),{target:{value:'WEB'}});fireEvent.change(screen.getByLabelText('Nombre'),{target:{value:'Web'}});fireEvent.change(screen.getByLabelText('Prefijo'),{target:{value:'WEB-'}});
 fireEvent.click(screen.getByRole('button',{name:'Crear serie'}));await waitFor(()=>expect(api.seriesSave).toHaveBeenCalled());expect(api.seriesSave.mock.calls[0][0]).toMatchObject({defaultBankAccountId:'b'});
});
it('carries the selected account and stable method through the Shopify invoice save',async()=>{
 render(<OrderInvoiceModal order={{id:'order',orderNumber:'#123',billingAddress:{name:'Cliente',address_line_1:'Calle prueba',postal_code:'28001',city:'Madrid',country_code:'ES'},shippingAddress:{},customerName:'Cliente',customerEmail:'',currency:'EUR'} as any} onClose={()=>{}} onSaved={()=>{}}/>);
 expect(await screen.findByRole('combobox',{name:'Cuenta bancaria'})).toBeTruthy();
 await waitFor(()=>expect(screen.getByRole('combobox',{name:'Cuenta bancaria'}).textContent).toContain('Principal'));
 await choose('Cuenta bancaria',/Ventas/);fireEvent.click(screen.getByRole('button',{name:'Generar factura'}));
 await waitFor(()=>expect(api.orderSave).toHaveBeenCalled());expect(api.orderSave.mock.calls[0][1]).toMatchObject({bankAccountId:'b',paymentMethodId:'bank_transfer'});expect(api.orderSave.mock.calls[0][2]).toBe(true);
});

it('keeps a reopened legacy document without a snapshot bank-free instead of assigning the live default',async()=>{
 const draft={id:'legacy-reopened',clientId:'client',seriesId:'s1',issueDate:'2026-10-01',invoiceType:'standard',invoiceNumber:'A-0001',paymentMethod:'Transferencia bancaria',paymentMethodId:'bank_transfer',lines:[{position:1,description:'Servicio',quantity:1,unit:'ud',unitPrice:10,discountPercent:0,taxRate:21}],bankAccountId:null,bankAccountSnapshot:null,bankSnapshotSource:'legacy_missing',bankSnapshotAt:'2026-10-21T10:00:00Z'};
 render(<InvoiceModal open invoice={draft as any} clients={clients} products={[]} onClose={()=>{}} onSaved={async()=>{}}/>);
 expect(screen.getByText('Este documento no tiene datos bancarios conservados.')).toBeTruthy();expect(screen.queryByRole('combobox',{name:'Cuenta bancaria'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Guardar borrador'}));await waitFor(()=>expect(api.updateInvoice).toHaveBeenCalled());expect(api.updateInvoice.mock.calls[0][1]).not.toHaveProperty('bankAccountId');expect(api.updateInvoice.mock.calls[0][1]).not.toHaveProperty('bankAccountSnapshot');
});
it('uses the stable transfer identifier even after its configured label changes',async()=>{
 api.accounts=[];api.settings.sales.paymentMethods=api.settings.sales.paymentMethods.map((method:any)=>method.id==='bank_transfer'?{...method,label:'Transferencia SEPA'}:method);
 render(<ReceiptModal receipt={null} clients={clients} products={[]} onClose={()=>{}} onSaved={async()=>{}}/>);
 expect(await screen.findByText('Falta una cuenta bancaria en Configuración → General')).toBeTruthy();
 expect(screen.getByRole('combobox',{name:'Forma de pago del recibo'}).textContent).toContain('Transferencia SEPA');
});
it('does not offer a no-bank override that the server would replace with a default',async()=>{
 invoice();await waitFor(()=>expect(screen.getByRole('combobox',{name:'Cuenta bancaria'}).textContent).toContain('Principal'));
 fireEvent.click(screen.getByRole('combobox',{name:'Cuenta bancaria'}));await screen.findByRole('option',{name:/Ventas/});
 expect(screen.queryByRole('option',{name:'Sin cuenta bancaria'})).toBeNull();
});
