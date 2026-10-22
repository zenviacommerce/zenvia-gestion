import {afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({workspace:'one',handlers:[] as Array<()=>void>,removed:vi.fn()}));
vi.mock('../src/services/supabase',()=>({getActiveTenant:()=>({workspace_id:state.workspace}),getActiveSupabase:()=>client}));
const client={channel:vi.fn(()=>({on:vi.fn(function(this:any,_kind:any,_filter:any,callback:()=>void){state.handlers.push(callback);return this}),subscribe:vi.fn(function(this:any){return this})})),removeChannel:state.removed};
import {watchShopifyAnalytics} from '../src/services/shopifyLiveUpdates';
afterEach(()=>{vi.useRealTimers();state.handlers=[];state.workspace='one';vi.clearAllMocks();});
it('coalesces scoped realtime and local events, polls only visibly, and cleans up',async()=>{
 vi.useFakeTimers();let visibility='visible';vi.spyOn(document,'visibilityState','get').mockImplementation(()=>visibility as DocumentVisibilityState);
 const refresh=vi.fn(async()=>{}),stop=watchShopifyAnalytics(refresh);
 state.handlers[0]();state.handlers[1]();window.dispatchEvent(new Event('zenvia:orders-refresh'));
 await vi.advanceTimersByTimeAsync(250);expect(refresh).toHaveBeenCalledTimes(1);
 visibility='hidden';await vi.advanceTimersByTimeAsync(25000);expect(refresh).toHaveBeenCalledTimes(1);
 visibility='visible';document.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(250);expect(refresh).toHaveBeenCalledTimes(2);
 stop();state.handlers[0]();await vi.advanceTimersByTimeAsync(30000);expect(refresh).toHaveBeenCalledTimes(2);expect(state.removed).toHaveBeenCalled();
});
it('rejects stale tenant callbacks and rebinds its channel',async()=>{
 vi.useFakeTimers();const refresh=vi.fn(),stop=watchShopifyAnalytics(refresh),old=state.handlers[0];state.workspace='two';window.dispatchEvent(new Event('zenvia:tenant-changed'));old();await vi.advanceTimersByTimeAsync(250);expect(refresh).not.toHaveBeenCalled();state.handlers.at(-1)!();await vi.advanceTimersByTimeAsync(250);expect(refresh).toHaveBeenCalledTimes(1);stop();
});
it('serializes slow refreshes and schedules one trailing refresh',async()=>{
 vi.useFakeTimers();let done!:()=>void;const refresh=vi.fn(()=>new Promise<void>(resolve=>{done=resolve})),stop=watchShopifyAnalytics(refresh);state.handlers[0]();await vi.advanceTimersByTimeAsync(250);state.handlers[0]();await vi.advanceTimersByTimeAsync(250);expect(refresh).toHaveBeenCalledTimes(1);done();await vi.advanceTimersByTimeAsync(250);expect(refresh).toHaveBeenCalledTimes(2);stop();done();
});
it('releases hidden subscriptions and uses a sixty second visible fallback',async()=>{
 vi.useFakeTimers();let visibility='visible';vi.spyOn(document,'visibilityState','get').mockImplementation(()=>visibility as DocumentVisibilityState);
 const refresh=vi.fn(),stop=watchShopifyAnalytics(refresh),old=state.handlers[0];
 await vi.advanceTimersByTimeAsync(59999);expect(refresh).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(251);expect(refresh).toHaveBeenCalledTimes(1);
 visibility='hidden';document.dispatchEvent(new Event('visibilitychange'));expect(state.removed).toHaveBeenCalledTimes(1);old();await vi.advanceTimersByTimeAsync(120000);expect(refresh).toHaveBeenCalledTimes(1);
 visibility='visible';document.dispatchEvent(new Event('visibilitychange'));old();await vi.advanceTimersByTimeAsync(250);expect(refresh).toHaveBeenCalledTimes(2);stop();
});
