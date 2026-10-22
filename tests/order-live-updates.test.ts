import {afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({workspace:'one',handlers:[] as Array<()=>void>,removed:vi.fn()}));
vi.mock('../src/services/supabase',()=>({get supabase(){return client},getActiveTenant:()=>({workspace_id:state.workspace}),getActiveSupabase:()=>client}));
const client={channel:vi.fn(()=>({on:vi.fn(function(this:any,_kind:any,filter:any,callback:()=>void){expect(filter.filter).toBe(`owner_id=eq.${state.workspace}`);state.handlers.push(callback);return this}),subscribe:vi.fn(function(this:any){return this})})),removeChannel:state.removed};
import {watchFulfillmentOrders} from '../src/services/orderLiveUpdates';
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.clearAllMocks();state.handlers=[];state.workspace='one'});
it('polls at most every 60 seconds and disconnects while hidden',async()=>{
 vi.useFakeTimers();let visibility='visible';vi.spyOn(document,'visibilityState','get').mockImplementation(()=>visibility as DocumentVisibilityState);
 const refresh=vi.fn(),stop=watchFulfillmentOrders(refresh,15000);
 await vi.advanceTimersByTimeAsync(59999);expect(refresh).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(251);expect(refresh).toHaveBeenCalledTimes(1);
 visibility='hidden';document.dispatchEvent(new Event('visibilitychange'));expect(state.removed).toHaveBeenCalledTimes(1);state.handlers[0]();await vi.advanceTimersByTimeAsync(120000);expect(refresh).toHaveBeenCalledTimes(1);
 visibility='visible';document.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(250);expect(refresh).toHaveBeenCalledTimes(2);stop();
});
it('coalesces events, serializes slow requests and ignores stale workspace callbacks',async()=>{
 vi.useFakeTimers();let done!:()=>void;const refresh=vi.fn(()=>new Promise<void>(resolve=>{done=resolve})),stop=watchFulfillmentOrders(refresh);
 state.handlers[0]();window.dispatchEvent(new Event('zenvia:orders-refresh'));await vi.advanceTimersByTimeAsync(250);expect(refresh).toHaveBeenCalledTimes(1);
 state.handlers[0]();await vi.advanceTimersByTimeAsync(250);expect(refresh).toHaveBeenCalledTimes(1);done();await vi.advanceTimersByTimeAsync(250);expect(refresh).toHaveBeenCalledTimes(2);done();await vi.advanceTimersByTimeAsync(0);
 const old=state.handlers[0];state.workspace='two';window.dispatchEvent(new Event('zenvia:tenant-changed'));old();await vi.advanceTimersByTimeAsync(250);expect(refresh).toHaveBeenCalledTimes(2);stop();
});
