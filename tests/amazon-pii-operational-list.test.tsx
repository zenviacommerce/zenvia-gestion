import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {DEFAULT_APP_SETTINGS,DEFAULT_USER_PREFERENCES} from '../src/services/settingsSchema';
import JSZip from 'jszip';
import {jsPDF} from 'jspdf';
import {Orders} from '../src/pages/Orders';
import {OrderFinancialSummary} from '../src/components/OrderFinancialSummary';
import type {FulfillmentOrder} from '../src/services/orders';
const boundary=vi.hoisted(()=>({rows:[] as FulfillmentOrder[],pageCalls:vi.fn(),trackingLink:vi.fn(),selection:vi.fn(),selectedRows:vi.fn(),quotes:vi.fn(async()=>({options:[] as any[],weightKg:null,message:null,diagnostics:[]})),createLabel:vi.fn(),pickupSelection:vi.fn(),pickupPreview:vi.fn(),confirm:vi.fn(async()=>true)}));
vi.mock('../src/context/SettingsContext',()=>({useSettings:()=>({settings:{...DEFAULT_APP_SETTINGS,integrations:{...DEFAULT_APP_SETTINGS.integrations,amazonEnabled:false,shopifyEnabled:false,enviaEnabled:false},shipping:{...DEFAULT_APP_SETTINGS.shipping,labelSize:'AUTO',copies:1,enabledCarriers:[]},orders:{...DEFAULT_APP_SETTINGS.orders,bulkScope:'pending',retryTrackingConfirmation:false}},preferences:DEFAULT_USER_PREFERENCES,patchPreferences:async()=>{},updateSection:async()=>{}})}));
vi.mock('../src/services/orders',async original=>({...await original<typeof import('../src/services/orders')>(),listFulfillmentOrders:async()=>boundary.rows,getOrderTrackingLink:(id:string)=>boundary.trackingLink(id),
 fetchOrdersDashboardPage:async(filters:any)=>{boundary.pageCalls(filters);const gross=boundary.rows.reduce((n,o)=>n+(o.totalAmount||0),0),net=boundary.rows.reduce((n,o)=>n+(o.totalAmount||0)/((o.shippingAddress.country_code||o.destinationCountryCode)==='ES'?1.21:1),0);return {tariffCandidates:[],orders:boundary.rows.slice(filters.page*filters.pageSize,(filters.page+1)*filters.pageSize),total:boundary.rows.length,selectableTotal:boundary.rows.filter(o=>!o.piiPurgedAt).length,page:filters.page,pageSize:filters.pageSize,kpis:{pending:boundary.rows.length,preparablePending:boundary.rows.filter(o=>!o.piiPurgedAt).length,amazon:boundary.rows.length,shopify:0,manual:0,labelled:0,shipped:0,cancelled:0,overduePending:0,sales:{gross,net,vat:gross-net,count:boundary.rows.length,average:gross/boundary.rows.length},transport:{total:0,net:0,tax:0,mrw:0,correos:0,other:0,shipments:0,valued:0,missing:0,basis:'recorded_only'}},facets:{countries:[],carriers:[]}}},
 fetchMatchingOrderIds:(filters:any)=>boundary.selection(filters),listSelectedOrdersForBulk:(filters:any,ids:string[])=>boundary.selectedRows(filters,ids),
 listMatchingOrdersForAction:async()=>boundary.rows,listMatchingPendingOrdersForBulk:async()=>boundary.rows,getSendcloudStatus:async()=>({configured:false,integrations:[]}),getEnviaStatus:async()=>({configured:false,accounts:[]}),getShippingOptions:boundary.quotes,createOrderLabel:boundary.createLabel}));
vi.mock('../src/services/pickupReports',()=>({selectPickupOrderIds:(f:any)=>boundary.pickupSelection(f),previewPickupReport:(ids:string[])=>boundary.pickupPreview(ids),listPickupReports:async()=>[],createPickupReport:vi.fn(),getPickupReport:vi.fn()}));
vi.mock('../src/services/actionDialog',()=>({confirmAction:boundary.confirm}));
vi.mock('../src/services/orderLiveUpdates',()=>({watchFulfillmentOrders:()=>()=>{}}));
vi.mock('../src/services/transportTariffs',async original=>({...await original<typeof import('../src/services/transportTariffs')>(),listTransportTariffs:async()=>[]}));
vi.mock('../src/services/shippingRules',async original=>({...await original<typeof import('../src/services/shippingRules')>(),loadShippingRules:async()=>[]}));
afterEach(()=>{cleanup();window.history.replaceState({},'', '/');window.sessionStorage.clear();boundary.quotes.mockClear();boundary.pageCalls.mockClear();boundary.selection.mockReset();boundary.selectedRows.mockReset();});
function renderLabelledOrders(){const result=render(<Orders/>);fireEvent.click(screen.getByRole('tab',{name:/^Etiquetados/}));return result;}
const order={id:'synthetic-purged',sourceChannel:'amazon',orderNumber:'SYNTHETIC-PURGED',sourceStatus:'unshipped',customerName:null,customerEmail:null,customerPhone:null,shippingAddress:{},billingAddress:{},items:[{name:'Retained synthetic product',sku:'SYN',quantity:2}],totalAmount:24,currency:'EUR',piiPurgedAt:'2026-10-16T00:00:00Z',labelPrintCount:0,labelPrintStateKnown:true,orderCreatedAt:'2026-07-01T00:00:00Z',weightKg:1} as FulfillmentOrder;
it('renders anonymized desktop and mobile list, searches retained product and opens safe detail',async()=>{boundary.rows=[order];const {container}=render(<Orders/>);await waitFor(()=>expect(container.querySelector('.ordersTable tbody tr')).toBeTruthy());const desktop=container.querySelector('.ordersTable tbody') as HTMLElement;const mobile=container.querySelector('.ordersMobileList') as HTMLElement;expect(within(desktop).getByText(/Retained synthetic product/)).toBeTruthy();expect(within(mobile).getByText(/Retained synthetic product/)).toBeTruthy();expect(within(desktop).getByText('24,00 €')).toBeTruthy();expect(within(desktop).getByRole('checkbox').hasAttribute('disabled')).toBe(true);fireEvent.change(screen.getByPlaceholderText('Buscar pedido, cliente, producto, tracking o transportista…'),{target:{value:'Retained synthetic'}});await waitFor(()=>expect(container.querySelector('.ordersTable tbody tr')).toBeTruthy());fireEvent.click(within(container.querySelector('.ordersTable tbody') as HTMLElement).getByText('SYNTHETIC-PURGED'));expect(await screen.findByText(/Datos personales eliminados/)).toBeTruthy();});
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
 boundary.rows=[before];render(<OrderFinancialSummary filter={{preset:'all',from:'',to:''}} refreshRevision={0} visibleKpis={new Set(['orderValue','orderVat','orderNet'])}/>);await screen.findByText('121,00 €');expect(stats()).toEqual({gross:'121,00 €',vat:'21,00 €',net:'100,00 €'});cleanup();
 boundary.rows=[{...before,piiPurgedAt:order.piiPurgedAt,shippingAddress:{},destinationCountryCode:'ES'} as FulfillmentOrder];render(<OrderFinancialSummary filter={{preset:'all',from:'',to:''}} refreshRevision={0} visibleKpis={new Set(['orderValue','orderVat','orderNet'])}/>);await screen.findByText('121,00 €');expect(stats()).toEqual({gross:'121,00 €',vat:'21,00 €',net:'100,00 €'});expect(boundary.rows[0].shippingAddress).toEqual({});
});

it('navigates server pages of 25 without loading every order or quoting providers',async()=>{
 boundary.rows=Array.from({length:60},(_,n)=>({...order,id:'page-'+n,orderNumber:'PAGE-'+n,piiPurgedAt:null,orderCreatedAt:new Date().toISOString()}));
 const {container}=render(<Orders/>);await waitFor(()=>expect(container.querySelectorAll('.ordersTable tbody tr')).toHaveLength(25));
 expect(boundary.pageCalls).toHaveBeenCalledWith(expect.objectContaining({page:0,pageSize:25}));expect(boundary.quotes).not.toHaveBeenCalled();
 fireEvent.click(screen.getAllByRole('button',{name:'Siguiente'})[0]);await waitFor(()=>expect(boundary.pageCalls).toHaveBeenCalledWith(expect.objectContaining({page:1,pageSize:25})));
 await waitFor(()=>expect(screen.getAllByRole('navigation',{name:'Paginación de pedidos'})[0].textContent).toContain('60 pedidos · Página 2 de 3'));expect(container.querySelectorAll('.ordersTable tbody tr')).toHaveLength(25);expect(container.querySelector('.ordersTable tbody')!.textContent).toContain('PAGE-25');expect(boundary.quotes).not.toHaveBeenCalled();
});

it('selects all 63 matching IDs beyond the visible 25 and previews all without buying',async()=>{
 boundary.rows=Array.from({length:63},(_,n)=>({...order,id:'all-'+n,orderNumber:'ALL-'+n,piiPurgedAt:null,orderCreatedAt:new Date().toISOString(),shippingAddress:{name:'DEMO',address_line_1:'Calle Ejemplo',house_number:'1',postal_code:'28013',city:'Madrid',country_code:'ES'}}));
 boundary.selection.mockResolvedValue(boundary.rows.map(o=>o.id));boundary.selectedRows.mockResolvedValue(boundary.rows);boundary.quotes.mockResolvedValue({options:[],weightKg:null,message:null,diagnostics:[]});
 const {container}=render(<Orders/>);await waitFor(()=>expect(container.querySelectorAll('.ordersTable tbody tr')).toHaveLength(25));
 fireEvent.click(screen.getByRole('button',{name:'Seleccionar todos de esta página'}));
 fireEvent.click(screen.getByRole('button',{name:'Seleccionar los 63 pedidos que coinciden con los filtros'}));
 await waitFor(()=>expect(screen.getByText(/Seleccionados.*63.*todos los resultados/)).toBeTruthy());
 fireEvent.click(screen.getByRole('checkbox',{name:'Deseleccionar pedidos pendientes de esta página'}));
 await waitFor(()=>expect(screen.getByText(/Seleccionados.*38.*todos los resultados/)).toBeTruthy());
 fireEvent.click(screen.getByRole('checkbox',{name:'Seleccionar pedidos pendientes de esta página'}));
 await waitFor(()=>expect(screen.getByText(/Seleccionados.*63.*todos los resultados/)).toBeTruthy());
 fireEvent.click(within(container.querySelector('.bulkSelectionActions') as HTMLElement).getByRole('button',{name:'Generar etiquetas seleccionadas (63)'}));
 await waitFor(()=>expect(boundary.selectedRows).toHaveBeenCalled());expect(boundary.selectedRows.mock.calls[0][0]).toEqual(expect.objectContaining({state:'pending'}));expect(new Set(boundary.selectedRows.mock.calls[0][1])).toEqual(new Set(boundary.rows.map(o=>o.id)));
 await waitFor(()=>expect(boundary.quotes).toHaveBeenCalledTimes(63));expect(boundary.createLabel).not.toHaveBeenCalled();
 expect(screen.getByText(/para los 63 pedidos/)).toBeTruthy();
});
it('ignores a late global selection response when the filters have changed',async()=>{
 boundary.rows=Array.from({length:63},(_,n)=>({...order,id:'race-'+n,orderNumber:'RACE-'+n,piiPurgedAt:null}));
 let resolve:(ids:string[])=>void;boundary.selection.mockImplementation(()=>new Promise<string[]>(r=>{resolve=r}));
 const {container}=render(<Orders/>);await waitFor(()=>expect(container.querySelectorAll('.ordersTable tbody tr')).toHaveLength(25));
 fireEvent.click(screen.getByRole('button',{name:'Seleccionar todos de esta página'}));fireEvent.click(screen.getByRole('button',{name:'Seleccionar los 63 pedidos que coinciden con los filtros'}));
 fireEvent.change(screen.getByPlaceholderText('Buscar pedido, cliente, producto, tracking o transportista…'),{target:{value:'changed'}});
 resolve!(boundary.rows.map(o=>o.id));await waitFor(()=>expect(screen.queryByText(/Seleccionados.*63.*todos los resultados/)).toBeNull());
 expect(boundary.quotes).not.toHaveBeenCalled();
});

it.each(['tenant','tariffs','integrations'])('stops outstanding bulk quote batches when %s changes',async entity=>{
 boundary.rows=Array.from({length:6},(_,n)=>({...order,id:'tenant-'+n,orderNumber:'TENANT-'+n,piiPurgedAt:null,orderCreatedAt:new Date().toISOString(),shippingAddress:{name:'DEMO',address_line_1:'Calle Ejemplo',house_number:'1',postal_code:'28013',city:'Madrid',country_code:'ES'}}));
 boundary.selectedRows.mockResolvedValue(boundary.rows);
 const resolves:Array<(value:any)=>void>=[];boundary.quotes.mockImplementation(()=>new Promise(resolve=>resolves.push(resolve)));
 const {container}=render(<Orders/>);await waitFor(()=>expect(container.querySelectorAll('.ordersTable tbody tr')).toHaveLength(6));
 fireEvent.click(screen.getByRole('button',{name:'Seleccionar todos de esta página'}));fireEvent.click(within(container.querySelector('.bulkSelectionActions') as HTMLElement).getByRole('button',{name:'Generar etiquetas seleccionadas (6)'}));
 await waitFor(()=>expect(boundary.quotes).toHaveBeenCalledTimes(3));
 await act(async()=>{window.dispatchEvent(entity==='tenant'?new Event('zenvia:tenant-changed'):new CustomEvent('zenvia:entity-changed',{detail:entity}));await new Promise(r=>setTimeout(r,10));resolves.forEach(resolve=>resolve({options:[],diagnostics:[]}));});
 expect(boundary.quotes).toHaveBeenCalledTimes(3);expect(screen.queryByRole('heading',{name:'Generar etiquetas en bloque'})).toBeNull();
});

it('selects all 63 labelled orders for pickup across pages without buying labels',async()=>{
 boundary.rows=Array.from({length:63},(_,n)=>({...order,id:'pickup-'+n,orderNumber:'PICKUP-'+n,piiPurgedAt:null,shippingProvider:'mrw',shippingLabelUrl:'https://label.test/'+n,trackingNumber:'MRW'+n,labelCreatedAt:new Date().toISOString()} as FulfillmentOrder));
 boundary.selection.mockResolvedValue(boundary.rows.map(o=>o.id));
 boundary.pickupPreview.mockImplementation(async(ids:string[])=>({items:ids.map(id=>({orderId:id,orderNumber:id,channel:'amazon',carrier:'MRW',trackingNumber:'TRACK-'+id,packages:1,eligible:true,previousReports:[]})),totalPackages:ids.length,canCreate:true}));
 const {container}=render(<Orders/>);fireEvent.click(screen.getByRole('tab',{name:/^Etiquetados/}));
 await waitFor(()=>expect(container.querySelectorAll('.ordersTable tbody tr')).toHaveLength(25));
 fireEvent.click(screen.getByRole('button',{name:'Seleccionar todos de esta página'}));fireEvent.click(screen.getByRole('button',{name:'Seleccionar los 63 pedidos que coinciden con los filtros'}));
 await waitFor(()=>expect(screen.getByText(/Seleccionados.*63.*todos los resultados/)).toBeTruthy());
 expect(within(container.querySelector('.bulkSelectionActions') as HTMLElement).queryByRole('button',{name:'Generar etiquetas seleccionadas (63)'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:/Generar informe de recogida/ }));
 expect(await screen.findByRole('dialog',{name:'Informe de recogida'})).toBeTruthy();
 await waitFor(()=>expect(boundary.pickupPreview).toHaveBeenCalledWith(boundary.rows.map(o=>o.id)));
 expect(boundary.selection.mock.calls.at(-1)[0].state).toBe('labelled');expect(boundary.pickupSelection).not.toHaveBeenCalled();expect(boundary.createLabel).not.toHaveBeenCalled();
});

it('keeps three selected IDs while searching, adds a fourth and previews the full report selection',async()=>{
 const all=Array.from({length:4},(_,n)=>({...order,id:'keep-'+n,orderNumber:'KEEP-'+n,piiPurgedAt:null}));boundary.rows=all.slice(0,3);
 boundary.pickupPreview.mockImplementation(async(ids:string[])=>({items:ids.map(id=>({orderId:id,orderNumber:id,channel:'amazon',carrier:'MRW',trackingNumber:'TRACK-'+id,packages:1,eligible:true,previousReports:[]})),canCreate:true,totalPackages:ids.length}));
 const {container}=renderLabelledOrders();await waitFor(()=>expect(container.querySelectorAll('.ordersTable tbody tr')).toHaveLength(3));
 fireEvent.click(screen.getByRole('button',{name:'Seleccionar todos de esta página'}));
 expect(screen.getByRole('button',{name:'Generar informe de recogida (3)'})).toBeTruthy();
 boundary.rows=[all[3]];fireEvent.change(screen.getByPlaceholderText('Buscar pedido, cliente, producto, tracking o transportista…'),{target:{value:'KEEP-3'}});
 await waitFor(()=>expect(container.querySelectorAll('.ordersTable tbody tr')).toHaveLength(1));
 expect(screen.getByRole('button',{name:'Generar informe de recogida (3)'})).toBeTruthy();
 fireEvent.click(within(container.querySelector('.ordersTable tbody') as HTMLElement).getByRole('checkbox'));
 fireEvent.click(screen.getByRole('button',{name:'Generar informe de recogida (4)'}));
 await waitFor(()=>expect(boundary.pickupPreview).toHaveBeenCalledWith(all.map(o=>o.id)));
 expect(boundary.confirm).toHaveBeenCalledWith(expect.objectContaining({message:expect.stringContaining('3 no están')}));
});
it('page and filter-wide selection add IDs, survive tab/page changes and support an indeterminate header',async()=>{
 boundary.rows=Array.from({length:30},(_,n)=>({...order,id:'union-'+n,orderNumber:'UNION-'+n,piiPurgedAt:null}));boundary.selection.mockResolvedValue(boundary.rows.map(o=>o.id));
 const {container}=render(<Orders/>);await waitFor(()=>expect(container.querySelectorAll('.ordersTable tbody tr')).toHaveLength(25));
 fireEvent.click(within(container.querySelector('.ordersTable tbody') as HTMLElement).getAllByRole('checkbox')[0]);
 expect((container.querySelector('.ordersTable thead input') as HTMLInputElement).indeterminate).toBe(true);
 fireEvent.click(screen.getAllByRole('button',{name:'Siguiente'})[0]);await waitFor(()=>expect(container.querySelectorAll('.ordersTable tbody tr')).toHaveLength(5));
 fireEvent.click(screen.getByRole('button',{name:'Seleccionar todos de esta página'}));expect(screen.getByText(/^6 seleccionados ·/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Seleccionar los 30 pedidos que coinciden con los filtros'}));await waitFor(()=>expect(screen.getByText(/^30 seleccionados ·/)).toBeTruthy());
 expect(screen.queryByRole('button',{name:/Generar informe de recogida/})).toBeNull();fireEvent.click(screen.getByRole('tab',{name:/^Etiquetados/}));await waitFor(()=>expect(screen.getByText(/^30 seleccionados ·/)).toBeTruthy());
 fireEvent.click(screen.getByRole('button',{name:'Quitar selección'}));expect((screen.getByRole('button',{name:'Generar informe de recogida (0)'}) as HTMLButtonElement).disabled).toBe(true);
});
it.each(['labels','invoices'])('uses all four persisted IDs for %s even when only the fourth is visible',async action=>{
 const all=Array.from({length:4},(_,n)=>({...order,id:'action-'+n,orderNumber:'ACTION-'+n,sourceChannel:'shopify',piiPurgedAt:null,shippingAddress:{name:'DEMO',address_line_1:'Calle Ejemplo',house_number:'1',postal_code:'28013',city:'Madrid',country_code:'ES'}} as FulfillmentOrder));boundary.rows=all.slice(0,3);boundary.selectedRows.mockResolvedValue(all);boundary.quotes.mockResolvedValue({options:[],weightKg:null,message:null,diagnostics:[]});
 const {container}=render(<Orders/>);await waitFor(()=>expect(container.querySelectorAll('.ordersTable tbody tr')).toHaveLength(3));fireEvent.click(screen.getByRole('button',{name:'Seleccionar todos de esta página'}));
 boundary.rows=[all[3]];fireEvent.change(screen.getByPlaceholderText('Buscar pedido, cliente, producto, tracking o transportista…'),{target:{value:'ACTION-3'}});await waitFor(()=>expect(container.querySelectorAll('.ordersTable tbody tr')).toHaveLength(1));fireEvent.click(within(container.querySelector('.ordersTable tbody') as HTMLElement).getByRole('checkbox'));
 fireEvent.click(action==='labels'?within(container.querySelector('.bulkSelectionActions') as HTMLElement).getByRole('button',{name:'Generar etiquetas seleccionadas (4)'}):screen.getByRole('button',{name:'Facturación manual de Shopify'}));
 await waitFor(()=>expect(boundary.selectedRows).toHaveBeenCalledWith(expect.anything(),all.map(o=>o.id)));
 if(action==='labels'){await waitFor(()=>expect(boundary.quotes).toHaveBeenCalledTimes(4));expect(boundary.createLabel).not.toHaveBeenCalled()}else{expect(await screen.findByRole('button',{name:'Revisar 4 pedidos'})).toBeTruthy()}
});

it('all matching IDs add to orders retained from a different search',async()=>{
 const previous=Array.from({length:3},(_,n)=>({...order,id:'previous-'+n,orderNumber:'PREVIOUS-'+n,piiPurgedAt:null}));boundary.rows=previous;
 const {container}=render(<Orders/>);await waitFor(()=>expect(container.querySelectorAll('.ordersTable tbody tr')).toHaveLength(3));fireEvent.click(screen.getByRole('button',{name:'Seleccionar todos de esta página'}));
 boundary.rows=Array.from({length:30},(_,n)=>({...order,id:'new-'+n,orderNumber:'NEW-'+n,piiPurgedAt:null}));boundary.selection.mockResolvedValue(boundary.rows.map(o=>o.id));
 fireEvent.change(screen.getByPlaceholderText('Buscar pedido, cliente, producto, tracking o transportista…'),{target:{value:'NEW'}});await waitFor(()=>expect(container.querySelectorAll('.ordersTable tbody tr')).toHaveLength(25));fireEvent.click(screen.getByRole('button',{name:'Seleccionar todos de esta página'}));
 expect(screen.getByText(/^28 seleccionados ·/)).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Seleccionar los 30 pedidos que coinciden con los filtros'}));await waitFor(()=>expect(screen.getByText(/^33 seleccionados ·/)).toBeTruthy());
});
it('shows retained selection with no search results, can review/remove it and cancels hidden-scope generation',async()=>{
 const original={...order,id:'retained',orderNumber:'RETAINED',piiPurgedAt:null};boundary.rows=[original];boundary.selectedRows.mockResolvedValue([original]);
 const {container}=renderLabelledOrders();await waitFor(()=>expect(container.querySelectorAll('.ordersTable tbody tr')).toHaveLength(1));fireEvent.click(screen.getByRole('button',{name:'Seleccionar todos de esta página'}));
 boundary.rows=[];fireEvent.change(screen.getByPlaceholderText('Buscar pedido, cliente, producto, tracking o transportista…'),{target:{value:'NOT-FOUND'}});await waitFor(()=>expect(container.querySelectorAll('.ordersTable tbody tr')).toHaveLength(0));
 fireEvent.click(screen.getByRole('button',{name:'Ver selección'}));const dialog=await screen.findByRole('dialog',{name:'Pedidos seleccionados'});expect(await within(dialog).findByText('RETAINED · Amazon')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Cerrar selección'}));
 await waitFor(()=>expect((screen.getByRole('button',{name:'Generar informe de recogida (1)'}) as HTMLButtonElement).disabled).toBe(false));
 const oldCalls=boundary.pickupPreview.mock.calls.length;boundary.confirm.mockResolvedValueOnce(false);fireEvent.click(screen.getByRole('button',{name:'Generar informe de recogida (1)'}));await waitFor(()=>expect(boundary.confirm).toHaveBeenCalled());expect(boundary.pickupPreview.mock.calls.length).toBe(oldCalls);
 fireEvent.click(screen.getByRole('button',{name:'Ver selección'}));fireEvent.click(await screen.findByRole('button',{name:'Quitar pedido RETAINED'}));expect((screen.getByRole('button',{name:'Generar informe de recogida (0)'}) as HTMLButtonElement).disabled).toBe(true);
});

it('shows clickable report numbers in list and mobile, and sends report filter without losing selection',async()=>{
 boundary.rows=[{...order,id:'report-order',orderNumber:'REPORT-ORDER',piiPurgedAt:null,pickupReports:[{id:'report-id',number:'REC-2026-0001'}]}];
 const {container}=renderLabelledOrders();await waitFor(()=>expect(container.querySelector('.ordersTable tbody tr')).toBeTruthy());
 const desktop=container.querySelector('.ordersTable tbody') as HTMLElement;const mobile=container.querySelector('.ordersMobileList') as HTMLElement;
 expect(within(mobile).getByRole('button',{name:'Abrir informe REC-2026-0001'})).toBeTruthy();
 fireEvent.click(within(desktop).getByRole('button',{name:'Abrir informe REC-2026-0001'}));expect(await screen.findByRole('dialog',{name:'Informes de recogida'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Cerrar historial de recogidas'}));
 fireEvent.click(within(desktop).getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Añadir filtro'}));fireEvent.click(within(screen.getByRole('dialog',{name:'Añadir filtro'})).getByRole('button',{name:'Informe de recogida',exact:true}));fireEvent.click(screen.getByLabelText('Filtrar por informe de recogida'));fireEvent.click(await screen.findByRole('option',{name:'Sin informe activo'}));
 await waitFor(()=>expect(boundary.pageCalls).toHaveBeenLastCalledWith(expect.objectContaining({pickupReport:'none'})));
 expect(screen.getByRole('button',{name:'Generar informe de recogida (1)'})).toBeTruthy();
});

it('report header uses shared sortable control and requests global ASC/DESC pages',async()=>{
 boundary.rows=[{...order,id:'report-order',orderNumber:'SORT-REPORT',piiPurgedAt:null,pickupReports:[{id:'report',number:'REC-2026-0001'}]}];
 render(<Orders/>);const header=await screen.findByRole('columnheader',{name:'Informe de recogida'});const button=within(header).getByRole('button',{name:'Informe de recogida'});
 fireEvent.click(button);await waitFor(()=>expect(boundary.pageCalls).toHaveBeenLastCalledWith(expect.objectContaining({sortKey:'pickupReport',sortDirection:'asc',page:0})));
 await waitFor(()=>expect(screen.getByRole('columnheader',{name:'Informe de recogida'}).getAttribute('aria-sort')).toBe('ascending'));fireEvent.click(screen.getByRole('button',{name:'Informe de recogida',exact:true}));await waitFor(()=>expect(boundary.pageCalls).toHaveBeenLastCalledWith(expect.objectContaining({sortKey:'pickupReport',sortDirection:'desc',page:0})));await waitFor(()=>expect(screen.getByRole('columnheader',{name:'Informe de recogida'}).getAttribute('aria-sort')).toBe('descending'));
});

it('reactivates a retained workbench at the pending queue with clean filters and accepts an issues deep link',async()=>{
 boundary.rows=[{...order,id:'navigation',piiPurgedAt:null}];
 const view=render(<Orders active/>);await screen.findAllByText('SYNTHETIC-PURGED');
 fireEvent.click(screen.getByRole('tab',{name:/^Enviados/}));
 fireEvent.change(screen.getByPlaceholderText('Buscar pedido, cliente, producto, tracking o transportista…'),{target:{value:'previous search'}});
 fireEvent.click(screen.getByRole('button',{name:'Añadir filtro'}));
 fireEvent.click(within(screen.getByRole('dialog',{name:'Añadir filtro'})).getByRole('button',{name:'Canal',exact:true}));
 fireEvent.click(screen.getByLabelText('Filtrar por canal'));fireEvent.click(await screen.findByRole('option',{name:'Shopify',exact:true}));
 fireEvent.click(screen.getByRole('button',{name:'Aplicar filtro'}));
 await waitFor(()=>expect(boundary.pageCalls).toHaveBeenLastCalledWith(expect.objectContaining({state:'shipped',query:'previous search',channel:'shopify'})));
 view.rerender(<Orders active={false}/>);window.history.pushState({},'', '/?page=orders&tab=pending');view.rerender(<Orders active pendingOnly/>);
 await waitFor(()=>expect(screen.getByRole('tab',{name:/^Pendientes/}).getAttribute('aria-selected')).toBe('true'));
 await waitFor(()=>expect(boundary.pageCalls).toHaveBeenLastCalledWith(expect.objectContaining({state:'pending',query:'',channel:'all',tracking:'all',country:'all',carrier:'all',pickupReport:'all'})));
 expect((screen.getByPlaceholderText('Buscar pedido, cliente, producto, tracking o transportista…') as HTMLInputElement).value).toBe('');
 view.rerender(<Orders active={false}/>);window.history.pushState({},'', '/?page=orders&tab=issues');view.rerender(<Orders active/>);
 await waitFor(()=>expect(screen.getByRole('tab',{name:/^Incidencias/}).getAttribute('aria-selected')).toBe('true'));
 await waitFor(()=>expect(boundary.pageCalls).toHaveBeenLastCalledWith(expect.objectContaining({state:'issues'})));
});
it('renders server-matched rows with a missing order date and a retained product identifier',async()=>{
 boundary.rows=[{...order,id:'date-null',orderNumber:'SERVER-MATCHED',piiPurgedAt:null,orderCreatedAt:null,items:[{product_id:'retained-id-only',quantity:1}]} as unknown as FulfillmentOrder];
 const {container}=render(<Orders/>);await waitFor(()=>expect(container.querySelectorAll('.ordersTable tbody tr')).toHaveLength(1));
 fireEvent.change(screen.getByPlaceholderText('Buscar pedido, cliente, producto, tracking o transportista…'),{target:{value:'retained-id-only'}});
 await waitFor(()=>expect(boundary.pageCalls).toHaveBeenLastCalledWith(expect.objectContaining({query:'retained-id-only'})));
 expect(within(container.querySelector('.ordersTable tbody') as HTMLElement).getByText('SERVER-MATCHED')).toBeTruthy();
 expect(within(container.querySelector('.ordersMobileList') as HTMLElement).getByText('SERVER-MATCHED')).toBeTruthy();
});

it('prioritizes operational columns, shows the carrier reason and resolves a missing link only on demand',async()=>{
 boundary.rows=[{...order,id:'issue-test',orderNumber:'ISSUE-TEST',piiPurgedAt:null,shippingProvider:'envia',trackingNumber:'SYNTHETIC',trackingNormalizedState:'exception',trackingStatusMessage:'Destinatario ausente',trackingEventAt:'2026-10-21T08:00:00Z'} as FulfillmentOrder];
 boundary.trackingLink.mockReset();boundary.trackingLink.mockResolvedValue({url:'https://carrier.example.test/track'});
 const popup={opener:{},location:{href:''},close:vi.fn()};const open=vi.spyOn(window,'open').mockReturnValue(popup as unknown as Window);
 try{
  const {container}=render(<Orders/>);fireEvent.click(screen.getByRole('tab',{name:/^Incidencias/}));
  await waitFor(()=>expect(container.querySelector('.ordersPriorityTracking')).toBeTruthy());
  const columns=[...container.querySelectorAll('.ordersTable th')].map(e=>e.textContent?.trim());expect(columns.slice(1,5)).toEqual(['Pedido','Cliente','Transportista','Seguimiento']);
  const cell=container.querySelector('.ordersPriorityTracking') as HTMLElement;
  expect(within(cell).getByText('Destinatario ausente')).toBeTruthy();expect(boundary.trackingLink).not.toHaveBeenCalled();
  fireEvent.click(within(cell).getByRole('button',{name:/Abrir seguimiento/}));
  await waitFor(()=>expect(popup.location.href).toBe('https://carrier.example.test/track'));
  expect(boundary.trackingLink).toHaveBeenCalledWith('issue-test');expect(popup.opener).toBeNull();expect(container.querySelector('.ordersDrawer')).toBeNull();
 }finally{open.mockRestore()}
});
