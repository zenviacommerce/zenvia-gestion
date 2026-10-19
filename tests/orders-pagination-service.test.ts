import {it,expect,vi} from 'vitest';
const api=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../src/services/supabase',()=>({supabase:api,getActiveSupabase:()=>api}));
import {listMatchingOrdersForAction,type OrdersDashboardFilters} from '../src/services/orders';
const filters={from:'',to:'',state:'pending',channel:'all',query:'',tracking:'all',country:'all',carrier:'all',page:0,pageSize:25,overdueHours:24,sortKey:'orderDate',sortDirection:'desc'} as OrdersDashboardFilters;
function respond(changed=false){api.rpc.mockImplementation((_name,args)=>{const page=args.p_page;return {abortSignal:()=>Promise.resolve({data:{rows:Array.from({length:page?5:100},(_,n)=>({id:'id-'+(page*100+n),sendcloud_id:'test',shipping_address:{},items:[]})),total:changed&&page?106:105,page,pageSize:100,kpis:{},facets:{}},error:null})}})}
it('explicit bulk actions retrieve all server pages while preserving filters',async()=>{respond();const orders=await listMatchingOrdersForAction(filters);expect(orders).toHaveLength(105);expect(new Set(orders.map(o=>o.id)).size).toBe(105);expect(api.rpc).toHaveBeenCalledWith('orders_dashboard_page_v1',expect.objectContaining({p_page:1,p_page_size:100,p_state:'pending'}));});
it('does not silently offer incomplete bulk targets if the matching set changes while paging',async()=>{respond(true);await expect(listMatchingOrdersForAction(filters)).rejects.toThrow(/cambiado/);});
