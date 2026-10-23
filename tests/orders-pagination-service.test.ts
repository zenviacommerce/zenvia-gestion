import {it,expect,vi} from 'vitest';
const api=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../src/services/supabase',()=>({supabase:api,getActiveSupabase:()=>api}));
import {listMatchingOrdersForAction,type OrdersDashboardFilters} from '../src/services/orders';
const filters={from:'',to:'',state:'pending',channel:'all',query:'',tracking:'all',country:'all',carrier:'all',page:0,pageSize:25,overdueHours:24,sortKey:'orderDate',sortDirection:'desc'} as OrdersDashboardFilters;
it('loads period operational aggregates without any full-order or logistics request',async()=>{
 const service=await import('../src/services/orders');
 expect((service as any).fetchOrdersOperationalSummary).toBeTypeOf('function');
 api.rpc.mockReturnValue({abortSignal:async()=>({data:{orders:12,pending:2,shipped:8,cancelled:1,amazon:9,shopify:3},error:null})});
 const result=await (service as any).fetchOrdersOperationalSummary('2026-10-01','2026-12-31');
 expect(result).toEqual({orders:12,pending:2,shipped:8,cancelled:1,amazon:9,shopify:3});
 expect(api.rpc).toHaveBeenLastCalledWith('orders_operational_summary_v1',{p_from:'2026-10-01',p_to:'2026-12-31'});
});
function respond(changed=false){api.rpc.mockImplementation((_name,args)=>{const page=args.p_page;return {abortSignal:()=>Promise.resolve({data:{rows:Array.from({length:page?5:100},(_,n)=>({id:'id-'+(page*100+n),sendcloud_id:'test',shipping_address:{},items:[]})),total:changed&&page?106:105,page,pageSize:100,kpis:{},facets:{}},error:null})}})}
it('explicit bulk actions retrieve all server pages while preserving filters',async()=>{respond();const orders=await listMatchingOrdersForAction(filters);expect(orders).toHaveLength(105);expect(new Set(orders.map(o=>o.id)).size).toBe(105);expect(api.rpc).toHaveBeenCalledWith('orders_dashboard_pickup_v1',expect.objectContaining({p_page:1,p_page_size:100,p_state:'pending'}));});
it('does not silently offer incomplete bulk targets if the matching set changes while paging',async()=>{respond(true);await expect(listMatchingOrdersForAction(filters)).rejects.toThrow(/cambiado/);});

it('selects every eligible server ID using the current filters, not the visible page',async()=>{
 const {fetchMatchingOrderIds}=await import('../src/services/orders');
 api.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:{ids:Array.from({length:63},(_,i)=>'id-'+i),total:63,limit:2000,exceeded:false},error:null})});
 const ids=await fetchMatchingOrderIds({...filters,country:'FR',query:'demo',page:2});
 expect(ids).toHaveLength(63);expect(api.rpc).toHaveBeenCalledWith('orders_dashboard_pickup_v1',expect.objectContaining({p_country:'FR',p_query:'demo',p_selection_limit:2000}));
});
it('rejects overflow and malformed partial selections without silently selecting a subset',async()=>{
 const {fetchMatchingOrderIds}=await import('../src/services/orders');
 for(const data of [{ids:[],total:2001,limit:2000,exceeded:true},{ids:['one'],total:63,limit:2000,exceeded:false},{ids:['one','one'],total:2,limit:2000,exceeded:false}]){
 api.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data,error:null})});await expect(fetchMatchingOrderIds(filters)).rejects.toThrow();}
});
it('retrieves the exact saved global selection across pages and refuses changed eligibility',async()=>{
 const {listSelectedOrdersForBulk}=await import('../src/services/orders');
 const ids=Array.from({length:105},(_,i)=>'id-'+i);respond();
 expect(await listSelectedOrdersForBulk(filters,ids)).toHaveLength(105);
 expect(api.rpc).toHaveBeenCalledWith('orders_dashboard_pickup_v1',expect.objectContaining({p_selected_ids:ids,p_page:1,p_page_size:100,p_state:'all',p_channel:'all',p_query:'',p_from:null,p_to:null}));
 api.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:{rows:[],total:0,kpis:{},facets:{}},error:null})});
 await expect(listSelectedOrdersForBulk(filters,ids)).rejects.toThrow(/cambiado/);
});

it('sends pickup filter to server pages and IDs, but neutralizes it when rereading saved selection',async()=>{
 const {fetchOrdersDashboardPage,fetchMatchingOrderIds,listSelectedOrdersForBulk}=await import('../src/services/orders');
 api.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:{rows:[{id:'one',pickup_reports:[{id:'rec',number:'REC-2026-0001'}],shipping_address:{},items:[]}],total:1,kpis:{},facets:{}},error:null})});
 const page=await fetchOrdersDashboardPage({...filters,pickupReport:'in'});expect(page.orders[0].pickupReports).toEqual([{id:'rec',number:'REC-2026-0001'}]);
 expect(api.rpc).toHaveBeenLastCalledWith('orders_dashboard_pickup_v1',expect.objectContaining({p_pickup_report:'in'}));
 await listSelectedOrdersForBulk({...filters,pickupReport:'none'},['one']);expect(api.rpc).toHaveBeenLastCalledWith('orders_dashboard_pickup_v1',expect.objectContaining({p_pickup_report:'all'}));
 api.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:{ids:['one'],total:1},error:null})});await fetchMatchingOrderIds({...filters,pickupReport:'none'});expect(api.rpc).toHaveBeenLastCalledWith('orders_dashboard_pickup_v1',expect.objectContaining({p_pickup_report:'none',p_selection_ids_only:true}));
});

it('routes workbench pages and IDs together while leaving financial calls on the existing API',async()=>{
 const {fetchOrdersDashboardPage,fetchMatchingOrderIds}=await import('../src/services/orders');
 api.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:{rows:[],total:0,kpis:{},facets:{},counters:{pending:4,labelled:3,shipped:2,issues:1,cancelled:0}},error:null})});
 const result=await fetchOrdersDashboardPage({...filters,workbench:true,trackingStaleDays:7,state:'issues'});
 expect(result.counters?.issues).toBe(1);
 expect(api.rpc).toHaveBeenLastCalledWith('orders_workbench_v1',expect.objectContaining({p_state:'issues',p_tracking_stale_days:7}));
 api.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:{ids:[],total:0},error:null})});
 await fetchMatchingOrderIds({...filters,workbench:true,trackingStaleDays:7,state:'issues'},true);
 expect(api.rpc).toHaveBeenLastCalledWith('orders_workbench_v1',expect.objectContaining({p_state:'issues',p_tracking_stale_days:7,p_selection_all:true}));
 api.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:{rows:[],kpis:{},facets:{}},error:null})});
 await fetchOrdersDashboardPage({...filters,state:'all',pageSize:1});
 expect(api.rpc).toHaveBeenLastCalledWith('orders_dashboard_pickup_v1',expect.not.objectContaining({p_tracking_stale_days:expect.anything()}));
});

