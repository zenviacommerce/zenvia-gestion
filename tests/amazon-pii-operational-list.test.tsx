import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {DEFAULT_APP_SETTINGS,DEFAULT_USER_PREFERENCES} from '../src/services/settingsSchema';
import JSZip from 'jszip';
import {jsPDF} from 'jspdf';
import {Orders} from '../src/pages/Orders';
import type {FulfillmentOrder} from '../src/services/orders';
const boundary=vi.hoisted(()=>({rows:[] as FulfillmentOrder[],quotes:vi.fn(async()=>({options:[] as any[],weightKg:null,message:null,diagnostics:[]})),createLabel:vi.fn()}));
vi.mock('../src/context/SettingsContext',()=>({useSettings:()=>({settings:{...DEFAULT_APP_SETTINGS,integrations:{...DEFAULT_APP_SETTINGS.integrations,amazonEnabled:false,shopifyEnabled:false,enviaEnabled:false},shipping:{...DEFAULT_APP_SETTINGS.shipping,labelSize:'AUTO',copies:1,enabledCarriers:[]},orders:{...DEFAULT_APP_SETTINGS.orders,bulkScope:'pending',retryTrackingConfirmation:false}},preferences:DEFAULT_USER_PREFERENCES,patchPreferences:async()=>{},updateSection:async()=>{}})}));
vi.mock('../src/services/orders',async original=>({...await original<typeof import('../src/services/orders')>(),listFulfillmentOrders:async()=>boundary.rows,getSendcloudStatus:async()=>({configured:false,integrations:[]}),getEnviaStatus:async()=>({configured:false,accounts:[]}),getShippingOptions:boundary.quotes,createOrderLabel:boundary.createLabel}));
vi.mock('../src/services/actionDialog',()=>({confirmAction:async()=>true}));
vi.mock('../src/services/orderLiveUpdates',()=>({watchFulfillmentOrders:()=>()=>{}}));
vi.mock('../src/services/transportTariffs',async original=>({...await original<typeof import('../src/services/transportTariffs')>(),listTransportTariffs:async()=>[]}));
vi.mock('../src/services/shippingRules',async original=>({...await original<typeof import('../src/services/shippingRules')>(),loadShippingRules:async()=>[]}));
afterEach(()=>{cleanup();boundary.quotes.mockClear();});
const order={id:'synthetic-purged',sourceChannel:'amazon',orderNumber:'SYNTHETIC-PURGED',sourceStatus:'unshipped',customerName:null,customerEmail:null,customerPhone:null,shippingAddress:{},billingAddress:{},items:[{name:'Retained synthetic product',sku:'SYN',quantity:2}],totalAmount:24,currency:'EUR',piiPurgedAt:'2026-10-16T00:00:00Z',labelPrintCount:0,labelPrintStateKnown:true,orderCreatedAt:'2026-07-01T00:00:00Z',weightKg:1} as FulfillmentOrder;
it('renders anonymized desktop and mobile list, searches retained product and opens safe detail',async()=>{boundary.rows=[order];const {container}=render(<Orders/>);await waitFor(()=>expect(container.querySelector('.ordersTable tbody tr')).toBeTruthy());const desktop=container.querySelector('.ordersTable tbody') as HTMLElement;const mobile=container.querySelector('.ordersMobileList') as HTMLElement;expect(within(desktop).getByText(/Retained synthetic product/)).toBeTruthy();expect(within(mobile).getByText(/Retained synthetic product/)).toBeTruthy();expect(within(desktop).getByText('24,00 €')).toBeTruthy();expect(within(desktop).getByRole('checkbox').hasAttribute('disabled')).toBe(true);fireEvent.change(screen.getByPlaceholderText('Buscar pedido, cliente, producto, tracking o transportista…'),{target:{value:'Retained synthetic'}});expect(container.querySelector('.ordersTable tbody tr')).toBeTruthy();fireEvent.click(within(desktop).getByText('SYNTHETIC-PURGED'));expect(await screen.findByText(/Datos personales eliminados/)).toBeTruthy();});
it('does not allow the pending ZIP workflow to quote or export purged records',async()=>{boundary.rows=[order];render(<Orders/>);await screen.findAllByText('SYNTHETIC-PURGED');const button=screen.getByRole('button',{name:/Generar etiquetas pendientes/}) as HTMLButtonElement;expect(button.disabled).toBe(true);fireEvent.click(button);expect(boundary.quotes).not.toHaveBeenCalled();});

it('exports a real ZIP/PDF from anonymized synthetic order while excluding a purged companion',async()=>{
 const pdf=new jsPDF();pdf.text('SYNTHETIC NON-PERSONAL LABEL',10,10);const base64=pdf.output('datauristring').split(',')[1];
 boundary.createLabel.mockResolvedValue({base64,mimeType:'application/pdf',parcelId:1,shipmentId:null,trackingNumber:null,trackingUrl:null,shippingOptionCode:'test',contractId:null});
 boundary.quotes.mockResolvedValue({options:[{provider:'sendcloud',providerName:'Synthetic carrier',code:'test',name:'Synthetic service',carrierCode:'correos',carrierName:'Correos',contractId:null,price:3,currency:'EUR',raw:{}}],weightKg:null,message:null,diagnostics:[]});
 // These are invented placeholders, never a production buyer or address.
 const anonymous={...order,id:'synthetic-allowed',orderNumber:'SYNTHETIC-ANONYMIZED',piiPurgedAt:null,shippingAddress:{name:'ANONYMIZED',address_line_1:'SYNTHETIC',city:'SYNTHETIC',postal_code:'00000',country_code:'ES'}};
 boundary.rows=[order,anonymous];
 let exported:Blob|undefined;Object.defineProperty(URL,'createObjectURL',{configurable:true,value:(blob:Blob)=>{exported=blob;return 'blob:synthetic';}});Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:()=>{}});
 const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
 render(<Orders/>);await screen.findAllByText('SYNTHETIC-ANONYMIZED');fireEvent.click(screen.getByRole('button',{name:/Generar etiquetas pendientes/}));
 await waitFor(()=>expect((screen.getByRole('button',{name:'Generar todas'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Generar todas'}));await waitFor(()=>expect(exported).toBeTruthy());
 const bytes=await new Promise<ArrayBuffer>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=reject;reader.readAsArrayBuffer(exported!);});
 const zip=await JSZip.loadAsync(bytes);const files=Object.keys(zip.files);expect(files).toEqual(['SYNTHETIC-ANONYMIZED.pdf']);const content=await zip.file(files[0])!.async('string');expect(content.startsWith('%PDF-')).toBe(true);expect(content).toContain('SYNTHETIC NON-PERSONAL LABEL');expect(content).not.toContain('SYNTHETIC-PURGED');expect(boundary.createLabel.mock.calls.map(args=>args[0])).toEqual(['synthetic-allowed']);click.mockRestore();
});

it('preserves estimated net/VAT after address purge using retained destination country',async()=>{
 const before={...order,piiPurgedAt:null,totalAmount:121,orderCreatedAt:new Date().toISOString(),shippingAddress:{country_code:'ES'}};
 const stats=()=>({gross:screen.getByText('Total vendido').parentElement!.querySelector('strong')!.textContent!.replace(/\s/g,' '),vat:screen.getByText('IVA estimado').parentElement!.querySelector('strong')!.textContent!.replace(/\s/g,' '),net:screen.getByText('Neto sin IVA').parentElement!.querySelector('strong')!.textContent!.replace(/\s/g,' ')});
 boundary.rows=[before];render(<Orders/>);await screen.findAllByText('SYNTHETIC-PURGED');expect(stats()).toEqual({gross:'121,00 €',vat:'21,00 €',net:'100,00 €'});cleanup();
 boundary.rows=[{...before,piiPurgedAt:order.piiPurgedAt,shippingAddress:{},destinationCountryCode:'ES'} as FulfillmentOrder];render(<Orders/>);await screen.findAllByText('SYNTHETIC-PURGED');expect(stats()).toEqual({gross:'121,00 €',vat:'21,00 €',net:'100,00 €'});expect(boundary.rows[0].shippingAddress).toEqual({});
});
