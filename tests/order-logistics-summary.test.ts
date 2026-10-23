import {it,expect,vi} from 'vitest';
const boundary=vi.hoisted(()=>({rows:[] as any[],facts:[] as any[],rpc:vi.fn(),client:{} as any}));
vi.mock('../src/services/supabase',()=>({supabase:{},getActiveSupabase:()=>boundary.client}));
import {listFulfillmentOrders} from '../src/services/orders';import{isProcessedOrder,isPendingOrder}from'../src/services/orderStatus';
import {readOrdersSnapshot} from '../src/services/ordersSnapshot';
it('Summary reads the same current-label evidence and historical distinction as the workbench',async()=>{
 boundary.rows=[{id:'one',source_channel:'amazon',source_status:'shipped',order_number:'DEMO1',label_created_at:'2026-10-23T08:00:00Z'},{id:'two',source_channel:'shopify',source_status:'shipped',order_number:'DEMO2'}];
 boundary.facts=[{id:'one',logistics_identity:'generation1',logistics_state:'labelled',logistics:null},{id:'two',logistics_identity:'history2',logistics_state:'shipped',logistics:{historical:true,historicalDate:'2026-10-22T08:00:00Z'}}];
 const query:any={};for(const name of ['select','order','limit'])query[name]=()=>query;query.abortSignal=async()=>({data:boundary.rows,error:null});
 boundary.rpc.mockImplementation(()=>({abortSignal:async()=>({data:boundary.facts,error:null})}));
 boundary.client={from:()=>query,rpc:boundary.rpc,auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}};
 const rows=await listFulfillmentOrders();expect(rows).toHaveLength(2);expect(rows[0].logisticsIdentity).toBe('generation1');expect(isProcessedOrder(rows[0])).toBe(false);expect(isPendingOrder(rows[0])).toBe(false);expect(rows[1].logisticsHistorical).toBe(true);expect(isProcessedOrder(rows[1])).toBe(true);expect(isPendingOrder(rows[1])).toBe(false);expect(boundary.rpc).toHaveBeenCalledWith('order_logistics_read',{p_ids:['one','two']});
});

it('alert reads skip global logistics and cannot overwrite the classified snapshot',async()=>{
 const previous=readOrdersSnapshot();boundary.rpc.mockClear();
 const rows=await (listFulfillmentOrders as any)({logistics:false});
 expect(rows).toHaveLength(2);
 expect(boundary.rpc).not.toHaveBeenCalled();
 expect(readOrdersSnapshot()).toBe(previous);
});

