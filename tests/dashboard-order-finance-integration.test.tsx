import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Dashboard} from '../src/pages/Dashboard';
import {DEFAULT_APP_SETTINGS,DEFAULT_USER_PREFERENCES} from '../src/services/settingsSchema';
import type {FulfillmentOrder} from '../src/services/orders';
import type {Invoice} from '../src/types';
const mocks=vi.hoisted(()=>({fetch:vi.fn(),list:vi.fn(),summary:vi.fn(),sales:vi.fn(),watch:vi.fn(),preferences:[] as string[]}));
vi.mock('../src/services/orders',()=>({fetchOrdersDashboardPage:mocks.fetch,listFulfillmentOrders:mocks.list,fetchOrdersOperationalSummary:mocks.summary}));
vi.mock('../src/services/transportTariffs',()=>({listTransportTariffs:async()=>[]}));
vi.mock('../src/services/sales',()=>({loadSalesInvoices:mocks.sales}));
vi.mock('../src/services/viewCache',()=>({readViewCache:()=>null,writeViewCache:vi.fn()}));
vi.mock('../src/services/ordersSnapshot',()=>({readOrdersSnapshot:()=>[],ORDERS_SNAPSHOT_EVENT:'test-orders-snapshot'}));
vi.mock('../src/services/orderLiveUpdates',()=>({watchFulfillmentOrders:mocks.watch}));
vi.mock('../src/context/SettingsContext',()=>({useSettings:()=>({settings:DEFAULT_APP_SETTINGS,preferences:{...DEFAULT_USER_PREFERENCES,defaultPeriod:'all',dashboardKpis:mocks.preferences},patchPreferences:vi.fn()})}));
vi.mock('../src/components/PeriodFilterPanel',()=>({PeriodFilterPanel:({onChange}:{onChange:(value:unknown)=>void})=><button onClick={()=>onChange({preset:'custom',from:'2026-09-01',to:'2026-09-30'})}>Septiembre</button>}));
vi.mock('recharts',()=>({ResponsiveContainer:()=>null,PieChart:()=>null,Pie:()=>null,Tooltip:()=>null,Cell:()=>null}));
afterEach(cleanup);
beforeEach(()=>{
 mocks.summary.mockReset().mockResolvedValue({orders:3,pending:1,shipped:1,cancelled:0,amazon:2,shopify:1});
 mocks.preferences=[];mocks.watch.mockReset().mockReturnValue(vi.fn());mocks.list.mockReset().mockResolvedValue([{id:'old-pending',sourceStatus:'pending',orderCreatedAt:'2025-01-01'} as FulfillmentOrder]);
 mocks.sales.mockReset().mockResolvedValue([{id:'issued',status:'issued',issueDate:'2026-10-01',totalAmount:121,taxAmount:21,paidAmount:121,clientName:'Cliente'}, {id:'draft',status:'draft',issueDate:'2026-10-01',totalAmount:999,taxAmount:99,paidAmount:0,clientName:'Borrador'}]);
 mocks.fetch.mockReset().mockResolvedValue({orders:[],tariffCandidates:[],kpis:{sales:{gross:242,net:200,vat:42,count:2,average:121},transport:{total:10,net:8,tax:2,mrw:3,correos:4,other:3,shipments:4,valued:3,missing:1,basis:'recorded_only'}}});
});
it('renders server operational totals without downloading logistics for every order',async()=>{
 mocks.summary.mockResolvedValue({orders:950,pending:2,shipped:943,cancelled:64,amazon:940,shopify:10});
 render(<Dashboard invoices={[]} products={[]} suppliers={[]}/>);
 await waitFor(()=>expect(card('Pedidos').textContent).toContain('950'));
 expect(card('Pendientes').textContent).toContain('2');
 expect(mocks.list).not.toHaveBeenCalled();
});
it('renders the server physical-dispatch count independently of marketplace status',async()=>{
 mocks.preferences=['shippedOrders'];mocks.summary.mockResolvedValue({orders:3,pending:0,shipped:1,cancelled:0,amazon:2,shopify:1});
 render(<Dashboard invoices={[]} products={[]} suppliers={[]}/>);
 await waitFor(()=>expect(within(card('Enviados') as HTMLElement).getByText('1')).toBeTruthy());
});
function card(label:string){return screen.getByText(label).closest('.stat')!;}
it('queues an order invalidation received while the initial aggregate read is running',async()=>{
 let release!:(value:unknown)=>void;
 mocks.summary.mockReturnValueOnce(new Promise(resolve=>{release=resolve;})).mockResolvedValue({orders:9,pending:2,shipped:7,cancelled:0,amazon:8,shopify:1});
 render(<Dashboard invoices={[]} products={[]} suppliers={[]}/>);
 await waitFor(()=>expect(mocks.summary).toHaveBeenCalledTimes(1));
 const financeReads=mocks.fetch.mock.calls.length;
 await act(async()=>{window.dispatchEvent(new Event('test-orders-snapshot'));window.dispatchEvent(new Event('test-orders-snapshot'));});
 await act(async()=>release({orders:1,pending:1,shipped:0,cancelled:0,amazon:1,shopify:0}));
 await waitFor(()=>expect(card('Pedidos').textContent).toContain('9'));
 expect(mocks.summary).toHaveBeenCalledTimes(2);
 await waitFor(()=>expect(mocks.fetch.mock.calls.length).toBeGreaterThan(financeReads));
});
it('keeps issued invoice finances distinct while displaying all five order amounts once',async()=>{
 render(<Dashboard invoices={[{id:'expense',invoiceDate:'2026-10-01',total:60.5,vat:10.5,status:'paid',category:'Servicios',supplierName:'Proveedor'} as Invoice]} products={[]} suppliers={[]}/>);
 await screen.findByText('242,00 €');await waitFor(()=>expect(card('Facturación').textContent).toContain('121,00'));
 expect(card('IVA neto').textContent).toContain('10,50');expect(card('Resultado').textContent).toContain('60,50');expect(card('IVA estimado').textContent).toContain('42,00');
 expect(screen.getAllByText('Total vendido')).toHaveLength(1);expect(screen.queryByText('Valor de pedidos')).toBeNull();
 for(const label of ['Gastos','Pendiente de cobro','Gastos por revisar','Pedidos','Pendientes','Enviados','Cancelados','Ticket medio','Neto sin IVA','Coste transportistas (IVA incl.)'])expect(screen.getByText(label)).toBeTruthy();
});
it('uses the dashboard period and existing watcher or snapshot invalidations without hiding cross-period pending work',async()=>{
 render(<Dashboard invoices={[]} products={[]} suppliers={[]}/>);await screen.findByText('242,00 €');
 fireEvent.click(screen.getByRole('button',{name:'Septiembre'}));
 await waitFor(()=>expect(mocks.fetch.mock.lastCall?.[0]).toMatchObject({from:'2026-09-01',to:'2026-09-30'}));
 expect(within(card('Pendientes') as HTMLElement).getByText('1')).toBeTruthy();
 const before=mocks.fetch.mock.calls.length;await act(async()=>window.dispatchEvent(new Event('test-orders-snapshot')));
 await waitFor(()=>expect(mocks.fetch.mock.calls.length).toBeGreaterThan(before));expect(mocks.watch).toHaveBeenCalledTimes(2);expect(mocks.watch.mock.results[0].value).toHaveBeenCalled();
});
it('honors explicit KPI preferences and maps legacy orderValue to Total vendido',async()=>{
 mocks.preferences=['sales','orderValue','pendingOrders'];render(<Dashboard invoices={[]} products={[]} suppliers={[]}/>);
 await screen.findByText('242,00 €');expect(screen.getByText('Total vendido')).toBeTruthy();expect(screen.getByText('Pendientes')).toBeTruthy();
 expect(screen.queryByText('IVA estimado')).toBeNull();expect(screen.queryByText('Ticket medio')).toBeNull();expect(screen.queryByText('Gastos')).toBeNull();
});

