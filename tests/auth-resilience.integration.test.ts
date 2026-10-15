// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createClient} from '@supabase/supabase-js';
import {fetchWithAuthTimeout} from '../src/services/authFetch';
import {classifyAuthError,retryTransientAuth} from '../src/services/authResilience';

const URL='https://example.supabase.co';
const KEY='test-anon-key';
const STORAGE='zenvia-gestion-auth-test';
const savedFetch=globalThis.fetch;
const session={access_token:'access',refresh_token:'refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'00000000-0000-4000-8000-000000000001',aud:'authenticated',role:'authenticated',email:'test@example.com',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}};
function client(){return createClient(URL,KEY,{global:{fetch:fetchWithAuthTimeout},auth:{storageKey:STORAGE,persistSession:true,autoRefreshToken:false,detectSessionInUrl:false}})}
function reply(status:number,body:unknown){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}})}
function login(c:ReturnType<typeof client>){return retryTransientAuth(async()=>{const r=await c.auth.signInWithPassword({email:'test@example.com',password:'wrong-password'});if(r.error)throw r.error;return r})}
beforeEach(()=>{localStorage.clear();vi.useRealTimers()});
afterEach(()=>{globalThis.fetch=savedFetch;vi.useRealTimers();localStorage.clear()});
describe('GoTrue transport with real supabase-js 2.105.0',()=>{
it('A: TypeError retries three times and stays temporarily unavailable',async()=>{
 let calls=0;globalThis.fetch=vi.fn(async()=>{calls++;throw new TypeError('Failed to fetch')});
 await expect(login(client())).rejects.toMatchObject({name:'AuthRetryableFetchError'});
 expect(calls).toBe(3);
 expect(classifyAuthError(new TypeError('Failed to fetch'))).toBe('temporarily-unavailable');
 expect(classifyAuthError({message:'Failed to fetch',name:'AuthRetryableFetchError'})).not.toBe('invalid-credentials');
});
it('B: persisted valid session loads without network when Auth is down',async()=>{
 localStorage.setItem(STORAGE,JSON.stringify(session));
 const calls=vi.fn(async()=>{throw new TypeError('offline')});globalThis.fetch=calls;
 const result=await client().auth.getSession();
 expect(result.data.session?.access_token).toBe('access');
 expect(calls).not.toHaveBeenCalled();
});
it('C: invalid credentials return without retries',async()=>{
 const calls=vi.fn(async()=>reply(400,{code:'invalid_credentials',msg:'Invalid login credentials'}));globalThis.fetch=calls;
 await expect(login(client())).rejects.toMatchObject({status:400});
 expect(calls).toHaveBeenCalledTimes(1);
 expect(classifyAuthError({status:400,code:'invalid_credentials'})).toBe('invalid-credentials');
});
it('D: failed refresh is retryable and preserves localStorage verbatim',async()=>{
 localStorage.setItem(STORAGE,JSON.stringify(session));const original=localStorage.getItem(STORAGE);
 globalThis.fetch=vi.fn(async()=>{throw new TypeError('Failed to fetch')});
 const result=await client().auth.refreshSession();
 expect(result.error?.name).toBe('AuthRetryableFetchError');
 expect(localStorage.getItem(STORAGE)).toBe(original);
},30000);
it('E: hanging fetch aborts at 6s; retries at 6.5s and 13.5s; final failure at 19.5s',async()=>{
 vi.useFakeTimers();const starts:number[]=[];const zero=Date.now();
 globalThis.fetch=vi.fn((_input,init)=>{starts.push(Date.now()-zero);return new Promise<Response>((_resolve,reject)=>{const signal=(init as RequestInit)?.signal;signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})})}) as typeof fetch;
 const result=retryTransientAuth(()=>fetchWithAuthTimeout(URL+'/auth/v1/token',{method:'POST'})).then(()=>null,e=>e);
 await vi.advanceTimersByTimeAsync(18000);
 expect(starts).toEqual([0,6500,13500]);
 // The 18-second UI advisory must not terminate the pending retry loop.
 let settled=false;void result.then(()=>{settled=true});
 expect(settled).toBe(false);
 await vi.advanceTimersByTimeAsync(1500);
 const error=await result;
 expect(classifyAuthError(error)).toBe('temporarily-unavailable');
 expect(starts).toHaveLength(3);
});
it.each([500,504])('F: HTTP %i retries and retains persisted session',async(status)=>{
 localStorage.setItem(STORAGE,JSON.stringify(session));const original=localStorage.getItem(STORAGE);
 const calls=vi.fn(async()=>reply(status,{msg:'server unavailable'}));globalThis.fetch=calls;
 const result=await retryTransientAuth(async()=>{const r=await client().auth.signInWithPassword({email:'test@example.com',password:'wrong-password'});if(r.error)throw r.error;return r}).catch(e=>e);
 expect(classifyAuthError(result)).toBe('temporarily-unavailable');
 expect(calls).toHaveBeenCalledTimes(3);
 expect(localStorage.getItem(STORAGE)).toBe(original);
},30000);
it('G: RPC and Storage fetches are not aborted after six seconds',async()=>{
 vi.useFakeTimers();let aborted=false;
 globalThis.fetch=vi.fn((_input,init)=>new Promise<Response>(resolve=>{(init as RequestInit)?.signal?.addEventListener('abort',()=>{aborted=true});setTimeout(()=>resolve(reply(200,{})),7000)})) as typeof fetch;
 const a=fetchWithAuthTimeout(URL+'/rest/v1/rpc/test',{method:'POST'});
 const b=fetchWithAuthTimeout(URL+'/storage/v1/object/test');
 await vi.advanceTimersByTimeAsync(7000);
 expect((await a).status).toBe(200);expect((await b).status).toBe(200);expect(aborted).toBe(false);
});
});
