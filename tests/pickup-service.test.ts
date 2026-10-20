import {expect,it,vi} from 'vitest';
const boundary=vi.hoisted(()=>({rpc:vi.fn(),client:{} as any,workspace:'workspace'}));
vi.mock('../src/services/supabase',()=>({getActiveSupabase:()=>boundary.client,getActiveTenant:()=>({workspace_id:boundary.workspace})}));
import {createPickupReport,previewPickupReport,selectPickupOrderIds} from '../src/services/pickupReports';
it('rejects empty/duplicate/oversized selections before RPC',async()=>{boundary.rpc.mockClear();boundary.client={rpc:boundary.rpc};for(const ids of [[],['x','x'],Array.from({length:2001},(_,i)=>String(i))])await expect(previewPickupReport(ids)).rejects.toThrow();expect(boundary.rpc).not.toHaveBeenCalled()});
it('uses stable request id and explicit package confirmation without copying buyer data',async()=>{
 boundary.client={rpc:boundary.rpc};boundary.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:{id:'report',number:'REC-2026-0001'},error:null})});
 await createPickupReport(['order'],'request',false,{'order':2});expect(boundary.rpc).toHaveBeenCalledWith('pickup_report_create',{p_order_ids:['order'],p_request_id:'request',p_allow_duplicates:false,p_package_counts:{order:2}});
});
it('rejects a late result after switching workspaces',async()=>{let resolve:any;boundary.client={rpc:()=>({abortSignal:()=>new Promise(r=>resolve=r)})};const pending=previewPickupReport(['order']);boundary.workspace='other';resolve({data:{items:[]},error:null});await expect(pending).rejects.toThrow(/empresa/)});
it('fails visibly when selecting all exceeds limit, without silently truncating',async()=>{boundary.client={rpc:()=>({abortSignal:()=>Promise.resolve({data:{ids:['one'],total:2001,exceeded:true},error:null})})};await expect(selectPickupOrderIds({state:'labelled'} as any)).rejects.toThrow(/2.000/)});
