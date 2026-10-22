import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {OrderFinancialSummary} from '../src/components/OrderFinancialSummary';
import {DEFAULT_APP_SETTINGS,DEFAULT_USER_PREFERENCES} from '../src/services/settingsSchema';
import type {OrdersDashboardPage,FulfillmentOrder} from '../src/services/orders';
import type {TransportTariffDocument} from '../src/services/transportTariffs';
const mocks=vi.hoisted(()=>({fetch:vi.fn(),tariffs:vi.fn(),currency:'EUR'}));
vi.mock('../src/services/orders',()=>({fetchOrdersDashboardPage:mocks.fetch}));
vi.mock('../src/services/transportTariffs',()=>({listTransportTariffs:mocks.tariffs}));
vi.mock('../src/context/SettingsContext',()=>({useSettings:()=>({settings:{...DEFAULT_APP_SETTINGS,general:{...DEFAULT_APP_SETTINGS.general,currencyCode:mocks.currency}},preferences:DEFAULT_USER_PREFERENCES})}));
afterEach(cleanup);
const filter={preset:'custom' as const,from:'2026-10-01',to:'2026-10-22'};
const props={filter,refreshRevision:0,visibleKpis:new Set(['orderValue','orderVat','orderNet','orderAverage','orderTransport'])};
function response():OrdersDashboardPage{return {orders:[],total:100,selectableTotal:100,page:0,pageSize:1,facets:{countries:[],carriers:[]},tariffCandidates:[],kpis:{pending:0,preparablePending:0,amazon:0,shopify:0,manual:0,labelled:0,shipped:0,cancelled:0,overduePending:0,sales:{gross:242,net:200,vat:42,count:2,average:121},transport:{total:10,net:8,tax:2,mrw:3,correos:4,other:3,shipments:4,valued:3,missing:1,basis:'recorded_only'}}};}
beforeEach(()=>{mocks.currency='EUR';mocks.fetch.mockReset().mockResolvedValue(response());mocks.tariffs.mockReset().mockResolvedValue([]);});
it('renders all five aggregate financial amounts with the independent summary period',async()=>{
 render(<OrderFinancialSummary {...props}/>);
 await screen.findByText('242,00 €');
 for(const text of ['42,00 €','200,00 €','121,00 €','10,00 €','Total vendido','IVA estimado','Neto sin IVA','Ticket medio','Coste transportistas (IVA incl.)'])expect(screen.getByText(text)).toBeTruthy();
 expect(screen.getByText(/Otros 3,00/)).toBeTruthy();expect(screen.getByText(/3\/4 envíos con coste · 1 sin valorar/)).toBeTruthy();
 expect(mocks.fetch).toHaveBeenCalledWith(expect.objectContaining({from:filter.from,to:filter.to,state:'all',channel:'all',query:'',tracking:'all',country:'all',carrier:'all',page:0,pageSize:1,sortKey:'orderDate',sortDirection:'desc'}));
});
it('prices narrow tariff candidates outside the one-row page using the existing tariff calculator',async()=>{
 const data=response();data.tariffCandidates=[{id:'off-page',orderCreatedAt:'2026-10-02',weightKg:1,carrierCode:'mrw',carrierName:'MRW',shippingProvider:'mrw',shippingServiceName:'19h',shippingAddress:{country_code:'ES',postal_code:'28001'},kpiCarrierLabel:'MRW',shippingCostAmount:null} as FulfillmentOrder & {kpiCarrierLabel:string}];
 mocks.fetch.mockResolvedValue(data);
 mocks.tariffs.mockResolvedValue([{id:'t',status:'active',carrierCode:'mrw',carrierName:'MRW',effectiveFrom:null,effectiveTo:null,currencyCode:'EUR',pricesIncludeVat:true,fuelSurchargeIncluded:true,services:[{serviceName:'19h',canonicalServiceKey:'19h',externalProvider:'mrw',externalServiceCode:'19h',bands:[{countryCode:'ES',zoneCode:'peninsular',zoneName:'Península',minWeightKg:0,maxWeightKg:5,basePrice:6,extraKgPrice:null}]}],revisions:[]} as TransportTariffDocument]);
 render(<OrderFinancialSummary {...props}/>);await screen.findByText('16,00 €');expect(screen.getByText(/MRW 9,00/)).toBeTruthy();expect(screen.getByText(/4\/4 envíos con coste/)).toBeTruthy();
});
it('retains the last successful amounts on a refresh error without inventing zero amounts',async()=>{
 const view=render(<OrderFinancialSummary {...props}/>);await screen.findByText('242,00 €');
 mocks.fetch.mockRejectedValue(new Error('offline'));view.rerender(<OrderFinancialSummary {...props} refreshRevision={1}/>);
 await screen.findByRole('alert');expect(screen.getByText('242,00 €')).toBeTruthy();expect(screen.getByRole('alert').textContent).toContain('último resumen');
});
it('shows an unavailable state rather than zeros when the first read fails',async()=>{
 mocks.fetch.mockRejectedValue(new Error('offline'));render(<OrderFinancialSummary {...props}/>);
 await screen.findByRole('alert');expect(screen.queryByText('0,00 €')).toBeNull();
});
it('serializes invalidations and discards a response from an obsolete period',async()=>{
 let resolve!:(value:OrdersDashboardPage)=>void;mocks.fetch.mockImplementationOnce(()=>new Promise<OrdersDashboardPage>(r=>{resolve=r;}));
 const view=render(<OrderFinancialSummary {...props}/>);
 view.rerender(<OrderFinancialSummary {...props} filter={{...filter,from:'2026-09-01',to:'2026-09-30'}} refreshRevision={2}/>);
 expect(mocks.fetch).toHaveBeenCalledTimes(1);
 const stale=response();stale.kpis.sales.gross=999;
 await act(async()=>resolve(stale));
 await waitFor(()=>expect(mocks.fetch).toHaveBeenCalledTimes(2));await screen.findByText('242,00 €');expect(screen.queryByText('999,00 €')).toBeNull();
 expect(mocks.fetch.mock.calls[1][0]).toMatchObject({from:'2026-09-01',to:'2026-09-30'});
});
it('does not present an incomplete recorded-only cost total when tariffs cannot be read',async()=>{
 mocks.tariffs.mockRejectedValue(new Error('tariffs unavailable'));render(<OrderFinancialSummary {...props}/>);
 await screen.findByRole('alert');expect(screen.queryByText('10,00 €')).toBeNull();expect(screen.queryByText('0,00 €')).toBeNull();
});
it('never relabels the previous period amounts as the new period after a failed read',async()=>{
 const view=render(<OrderFinancialSummary {...props}/>);await screen.findByText('242,00 €');
 mocks.fetch.mockRejectedValue(new Error('offline'));
 view.rerender(<OrderFinancialSummary {...props} filter={{...filter,from:'2026-09-01',to:'2026-09-30'}}/>);
 await screen.findByRole('alert');expect(screen.queryByText('242,00 €')).toBeNull();expect(screen.queryByText('0,00 €')).toBeNull();
});

it('keeps EUR aggregate amounts denominated in EUR when the configured currency is USD',async()=>{
 mocks.currency='USD';render(<OrderFinancialSummary {...props}/>);await screen.findByText('242,00 €');expect(screen.getByText('10,00 €')).toBeTruthy();expect(screen.queryByText(/US\$/)).toBeNull();
});
