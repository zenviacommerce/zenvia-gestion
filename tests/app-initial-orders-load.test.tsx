import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {DEFAULT_APP_SETTINGS,DEFAULT_USER_PREFERENCES} from '../src/services/settingsSchema';
import App from '../src/App';

const state=vi.hoisted(()=>({settingsLoading:false,startPage:'dashboard',permissions:['dashboard','orders'],mfaReady:true,summary:vi.fn(),financial:vi.fn()}));
vi.mock('../src/context/MfaContext',()=>({useMfaAccess:()=>({ready:state.mfaReady})}));
vi.mock('../src/hooks/useEntityRefresh',()=>({useEntityRefresh:()=>{}}));
vi.mock('../src/context/SettingsContext',()=>({useSettings:()=>({loading:state.settingsLoading,settings:DEFAULT_APP_SETTINGS,preferences:{...DEFAULT_USER_PREFERENCES,startPage:state.startPage,defaultPeriod:'all',dashboardKpis:['orders','orderValue']},patchPreferences:async()=>{}})}));
vi.mock('../src/services/supabase',()=>({bootstrapTenantFromLocation:async()=>({status:'resolved'}),getActiveTenant:()=>({workspace_id:'test-workspace'}),getActiveSupabase:()=>({}),supabase:{rpc:async()=>({error:null}),auth:{getSession:async()=>({data:{session:{user:{id:'test-owner',email:'owner@example.test',user_metadata:{}}}},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}}));
vi.mock('../src/services/access',()=>({loadAccessProfile:async()=>({userId:'test-owner',email:'owner@example.test',fullName:'Owner',role:'user',active:true,dataOwnerId:'test-workspace',workspaceId:'test-workspace',workspaceName:'Test',workspaceSlug:'test',workspaceStatus:'active',planKey:'test',planName:'Test',subscriptionStatus:'active',isPlatformAdmin:false,entitlements:{},permissions:state.permissions})}));
vi.mock('../src/services/repository',()=>({bootstrapUser:async()=>{},loadAppData:async()=>({invoices:[],products:[],suppliers:[],categories:[]})}));
vi.mock('../src/services/companyBranding',()=>({loadCompanyBranding:async()=>({logoDataUrl:null})}));
vi.mock('../src/services/sales',()=>({loadSalesInvoices:async()=>[]}));
vi.mock('../src/services/orders',()=>({fetchOrdersOperationalSummary:state.summary,fetchOrdersDashboardPage:state.financial}));
vi.mock('../src/services/transportTariffs',()=>({listTransportTariffs:async()=>[]}));
vi.mock('../src/services/orderLiveUpdates',()=>({watchFulfillmentOrders:()=>()=>{}}));
vi.mock('../src/components/AppAgent',()=>({AppAgent:()=>null}));
vi.mock('../src/components/AlertCenter',()=>({AlertCenter:()=>null}));
vi.mock('../src/components/PasskeySetup',()=>({PasskeySetup:()=>null}));
vi.mock('../src/components/UploadInvoiceModal',()=>({UploadInvoiceModal:()=>null}));
vi.mock('../src/components/BulkInvoiceImportModal',()=>({BulkInvoiceImportModal:()=>null}));
vi.mock('../src/components/ProductModal',()=>({ProductModal:()=>null}));
vi.mock('../src/components/SupplierModal',()=>({SupplierModal:()=>null}));
vi.mock('../src/pages/Orders',()=>({Orders:()=> <h1>Pedidos de prueba</h1>}));
vi.mock('recharts',()=>({ResponsiveContainer:()=>null,PieChart:()=>null,Pie:()=>null,Tooltip:()=>null,Cell:()=>null}));

beforeEach(()=>{
 state.settingsLoading=false;state.startPage='dashboard';state.permissions=['dashboard','orders'];state.mfaReady=true;
 state.summary.mockReset().mockResolvedValue({orders:2,pending:2,shipped:0,cancelled:0,amazon:0,shopify:2});
 state.financial.mockReset().mockResolvedValue({tariffCandidates:[],kpis:{sales:{gross:0,net:0,vat:0,count:0,average:0},transport:{total:0,net:0,tax:0,mrw:0,correos:0,other:0,shipments:0,valued:0,missing:0,basis:'recorded_only'}}});
 window.history.replaceState({},'','/');
});
afterEach(cleanup);

it.each(['pending','labelled','shipped'])('opens the %s deep link without firing hidden Dashboard RPCs',async tab=>{
 window.history.replaceState({},'',`/?page=orders&tab=${tab}`);
 render(<App/>);await screen.findByRole('heading',{name:'Pedidos de prueba'});
 expect(state.summary).not.toHaveBeenCalled();expect(state.financial).not.toHaveBeenCalled();
});
it('honours a personal Orders start page without first requesting Dashboard data',async()=>{
 state.startPage='orders';render(<App/>);await screen.findByRole('heading',{name:'Pedidos de prueba'});
 expect(state.summary).not.toHaveBeenCalled();expect(state.financial).not.toHaveBeenCalled();
});
it('waits for preferences before mounting a data-reading page',async()=>{
 state.settingsLoading=true;state.startPage='orders';const view=render(<App/>);
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
 expect(state.summary).not.toHaveBeenCalled();expect(state.financial).not.toHaveBeenCalled();
 state.settingsLoading=false;view.rerender(<App/>);await screen.findByRole('heading',{name:'Pedidos de prueba'});
 expect(state.summary).not.toHaveBeenCalled();expect(state.financial).not.toHaveBeenCalled();
});
it('still loads the financial and operational Dashboard when it is the selected start page',async()=>{
 render(<App/>);await screen.findByRole('heading',{name:'Resumen'});
 await waitFor(()=>expect(state.summary).toHaveBeenCalledTimes(1));expect(state.financial).toHaveBeenCalledTimes(1);
});
it('does not bypass page permissions for an Orders deep link',async()=>{
 state.permissions=['dashboard'];window.history.replaceState({},'','/?page=orders&tab=pending');render(<App/>);
 await screen.findByRole('heading',{name:'Resumen'});expect(screen.queryByRole('heading',{name:'Pedidos de prueba'})).toBeNull();
});
it('can finish entry through browser history while preferences are still loading',async()=>{
 state.settingsLoading=true;render(<App/>);await screen.findByText('Preparando tu vista…');
 await act(async()=>{window.history.pushState({},'','/?page=orders&tab=pending');window.dispatchEvent(new PopStateEvent('popstate'));});
 await screen.findByRole('heading',{name:'Pedidos de prueba'});
 expect(state.summary).not.toHaveBeenCalled();expect(state.financial).not.toHaveBeenCalled();
});
