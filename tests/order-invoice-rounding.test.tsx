import {cleanup,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {shopifyInvoiceLines} from '../src/services/shopifyInvoiceCore';
import {OrderInvoiceModal} from '../src/components/OrderInvoiceModal';
import type {FulfillmentOrder} from '../src/services/orders';
const fixture=vi.hoisted(()=>({fail:false}));
vi.mock('../src/context/SettingsContext',()=>({useSettings:()=>({settings:{sales:{defaultSeriesId:'series',defaultTaxRegistrationId:'tax'},general:{}}})}));
vi.mock('../src/services/sales',()=>({ensureSalesSeries:async()=>[{id:'series',name:'Serie F',prefix:'F',kind:'standard'}],loadBusinessSettings:async()=>({legalName:'Emisor de prueba'}),loadClients:async()=>[]}));
vi.mock('../src/services/salesConfig',()=>({loadTaxRegistrations:async()=>[{id:'tax',label:'Registro ES',vatNumber:'ES-PRUEBA',active:true,isDefault:true}]}));
vi.mock('../src/services/companyBranding',()=>({loadCompanyBranding:async()=>null}));
vi.mock('../src/services/orderInvoices',()=>({prepareOrderInvoice:async()=>{if(fixture.fail)throw Error('Desglose fiscal inválido');return {invoice:null,lines:shopifyInvoiceLines(payload())}},saveOrderInvoice:vi.fn()}));
vi.mock('../src/services/salesInvoicePdf',()=>({downloadSalesInvoicePdf:vi.fn()}));
vi.mock('../src/components/SendInvoiceModal',()=>({SendInvoiceModal:()=>null}));
const money=(amount:number)=>({shopMoney:{amount:String(amount),currencyCode:'EUR'}});
function payload(){return {taxesIncluded:true,totalPriceSet:money(40.98),lineItems:{nodes:[{name:'Producto A',quantity:1,originalUnitPriceSet:money(27.99),discountAllocations:[],taxLines:[{rate:.21,priceSet:money(4.86)}]},{name:'Producto B',quantity:1,originalUnitPriceSet:money(12.99),discountAllocations:[],taxLines:[{rate:.21,priceSet:money(2.25)}]}]},shippingLines:{nodes:[]}}}
const order={id:'order-1023',orderNumber:'#1023',currency:'EUR',shippingAddress:{},billingAddress:{},customerName:'Cliente de prueba',customerEmail:''} as FulfillmentOrder;
afterEach(()=>{cleanup();fixture.fail=false});
it('opens the two-line Shopify #1023 fiscal shape with exact total, issuer and selected fiscal defaults',async()=>{
 render(<OrderInvoiceModal order={order} onClose={()=>{}} onSaved={()=>{}}/>);
 await waitFor(()=>expect(screen.getByText('Producto B')).toBeTruthy());
 expect(screen.getByText('Producto A')).toBeTruthy();
 expect(screen.getByText('Total: 40.98 EUR')).toBeTruthy();
 expect(screen.getByText(/Emisor: Emisor de prueba/)).toBeTruthy();
 expect(screen.getByRole('combobox',{name:'Serie'}).textContent).toContain('Serie F');
 expect(screen.getByRole('combobox',{name:'Registro IVA del emisor'}).textContent).toContain('Registro ES');
 expect((screen.getByRole('button',{name:'Generar factura'}) as HTMLButtonElement).disabled).toBe(false);
});
it('keeps issuer and series visible when fiscal preparation fails, while blocking issuance',async()=>{
 fixture.fail=true;render(<OrderInvoiceModal order={order} onClose={()=>{}} onSaved={()=>{}}/>);
 await waitFor(()=>expect(screen.getByText('Desglose fiscal inválido')).toBeTruthy());
 expect(screen.getByText(/Emisor: Emisor de prueba/)).toBeTruthy();
 expect(screen.getByRole('combobox',{name:'Serie'}).textContent).toContain('Serie F');
 expect((screen.getByRole('button',{name:'Generar factura'}) as HTMLButtonElement).disabled).toBe(true);
});
