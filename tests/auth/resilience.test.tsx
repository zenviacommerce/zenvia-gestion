import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {AuthRetryableFetchError} from '@supabase/supabase-js';
import {AuthScreen} from '../../src/components/AuthScreen';
import {activateTenant,bootstrapTenantFromLocation,clearActiveTenant,getActiveSupabase} from '../../src/services/supabase';
import {classifyAuthError,retryTransientAuth} from '../../src/services/authResilience';
import {fetchWithAuthTimeout} from '../../src/services/authFetch';

let tenantSequence=0;
const tenant={workspace_id:'test-workspace',slug:'test',name:'Test',supabase_url:'https://tenant.test',publishable_key:'test-publishable-key'};
let key=`zenvia-gestion-auth-${tenant.workspace_id}`;
const credentials={email:'test@example.com',password:'test-password'};
let requests:Array<{url:string;at:number;signal?:AbortSignal|null}>;
let tokenFetch:(init?:RequestInit)=>Promise<Response>;
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','X-Supabase-Api-Version':'2024-01-01'}});
const savedSession=()=>JSON.stringify({access_token:'test-access-token',refresh_token:'test-refresh-token',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:'test-user',aud:'authenticated',role:'authenticated',email:credentials.email,app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}});
async function flush(){await act(async()=>{await vi.advanceTimersByTimeAsync(0)});}
async function advance(ms:number){await act(async()=>{await vi.advanceTimersByTimeAsync(ms)});}
async function client(session=false){
  if(session)localStorage.setItem(key,savedSession());
  const c=await activateTenant(tenant,false);
  await c.auth.getSession();
  c.auth.stopAutoRefresh();
  return c;
}
async function submit(){
  render(<AuthScreen/>);
  fireEvent.change(screen.getByLabelText('Email'),{target:{value:credentials.email}});
  fireEvent.change(screen.getByLabelText('Contraseña'),{target:{value:credentials.password}});
  fireEvent.click(screen.getByRole('button',{name:'Entrar'}));
  await flush();
}
function tokens(){return requests.filter(r=>r.url.includes('/auth/v1/token'));}
// No Supabase/Auth/React/service mocks: the only replacement is the underlying network.
beforeEach(async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
  requests=[];localStorage.clear();
  tenant.workspace_id=`test-workspace-${++tenantSequence}`;key=`zenvia-gestion-auth-${tenant.workspace_id}`;
  tokenFetch=async()=>{throw new TypeError('Failed to fetch')};
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    requests.push({url,at:Date.now(),signal:init?.signal});
    if(url.includes('/functions/v1/tenant-router'))return json({status:'resolved',tenant});
    if(url.includes('/auth/v1/token'))return tokenFetch(init);
    throw new Error(`Unexpected network access: ${url}`);
  }));
  // auth-js logs each expected simulated network exception. Assert these logs in tests.
  vi.spyOn(console,'error').mockImplementation(()=>{});
});
afterEach(async()=>{
  cleanup();
  try{getActiveSupabase().auth.stopAutoRefresh()}catch{}
  await clearActiveTenant({signOut:false});
  vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();
});

describe('Phase 2 — real supabase-js 2.105.0 and production authFetch',()=>{
  it('A: network login makes 3 attempts and shows temporary failure, never credentials/reset',async()=>{
    const c=await client();const login=vi.spyOn(c.auth,'signInWithPassword');
    await submit();await advance(1500);
    expect(tokens()).toHaveLength(3);
    expect(tokens().map(r=>r.at-tokens()[0].at)).toEqual([0,500,1500]);
    const result=await login.mock.results[2].value;
    expect(result.error).toBeInstanceOf(AuthRetryableFetchError);
    expect(classifyAuthError(result.error)).toBe('temporarily-unavailable');
    expect(screen.getByText(/Tu sesión no se ha borrado/)).toBeTruthy();
    expect(screen.queryByText(/credenciales incorrectas|invalid login credentials/i)).toBeNull();
    expect(screen.queryByRole('button',{name:/Restablecer acceso/})).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(3);
  });
  it('B: production bootstrap recovers a valid persisted session while Auth is down, without login',async()=>{
    const c=await client(true);const original=localStorage.getItem(key);
    const resolution=await bootstrapTenantFromLocation();
    const {data,error}=await retryTransientAuth(()=>c.auth.getSession().then(r=>{if(r.error)throw r.error;return r}));
    expect(resolution.status).toBe('resolved');expect(error).toBeNull();
    expect(data.session?.user.id).toBe('test-user');
    expect(localStorage.getItem(key)).toBe(original);
    expect(requests).toHaveLength(0);
  });
  it('C: invalid_credentials makes exactly 1 request and no retry',async()=>{
    tokenFetch=async()=>json({code:'invalid_credentials',msg:'Invalid login credentials'},400);
    const c=await client();const login=vi.spyOn(c.auth,'signInWithPassword');
    await submit();await advance(30000);
    expect(tokens()).toHaveLength(1);
    expect(classifyAuthError((await login.mock.results[0].value).error)).toBe('invalid-credentials');
    expect(screen.getByText('Invalid login credentials')).toBeTruthy();
    expect(screen.queryByText(/Tu sesión no se ha borrado/)).toBeNull();
    expect(console.error).not.toHaveBeenCalled();
  });
  it('D: refreshSession returns AuthRetryableFetchError and leaves persisted session byte-for-byte intact',async()=>{
    const c=await client(true);const original=localStorage.getItem(key);
    const refresh=c.auth.refreshSession();await advance(35000);
    const result=await refresh;
    expect(result.error).toBeInstanceOf(AuthRetryableFetchError);
    expect(classifyAuthError(result.error)).toBe('temporarily-unavailable');
    expect(localStorage.getItem(key)).toBe(original);
    expect(tokens().length).toBeGreaterThan(1); // SDK owns refresh retries, unlike password login.
    expect(tokens().every(r=>r.url.includes('grant_type=refresh_token'))).toBe(true);
  });
  it('E: hung login aborts each attempt at 6s; 18s warning preserves pending state; final transient at 19.5s',async()=>{
    const aborted:number[]=[];
    tokenFetch=init=>new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>{aborted.push(Date.now());reject(init!.signal!.reason)},{once:true}));
    const c=await client(true);const original=localStorage.getItem(key);const login=vi.spyOn(c.auth,'signInWithPassword');
    await submit();const start=tokens()[0].at;
    await advance(5999);expect(tokens()[0].signal?.aborted).toBe(false);
    await advance(1);expect(tokens()[0].signal?.aborted).toBe(true);
    await advance(12000);
    expect(screen.getByText(/Seguimos intentándolo/)).toBeTruthy();
    expect(screen.getByRole('button',{name:/Verificando acceso/}).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText(/Tu sesión no se ha borrado/)).toBeNull();
    expect(localStorage.getItem(key)).toBe(original);
    await advance(1499);expect(aborted).toHaveLength(2);
    await advance(1);expect(aborted.map(t=>t-start)).toEqual([6000,12500,19500]);
    expect(tokens()).toHaveLength(3);
    expect(classifyAuthError((await login.mock.results[2].value).error)).toBe('temporarily-unavailable');
    expect(screen.getByText(/Tu sesión no se ha borrado/)).toBeTruthy();
    expect(screen.queryByText(/Seguimos intentándolo/)).toBeNull();
    expect(localStorage.getItem(key)).toBe(original);
  });
  it.each([500,504])('F: token HTTP %s retries login, classifies transient, preserves session (also on refresh)',async status=>{
    tokenFetch=async()=>json({message:'Auth temporarily unavailable'},status);
    const c=await client(true);const original=localStorage.getItem(key);const login=vi.spyOn(c.auth,'signInWithPassword');
    await submit();await advance(1500);
    expect(tokens()).toHaveLength(3);
    expect(classifyAuthError((await login.mock.results[2].value).error)).toBe('temporarily-unavailable');
    expect(screen.getByText(/Tu sesión no se ha borrado/)).toBeTruthy();
    expect(localStorage.getItem(key)).toBe(original);
    const refresh=c.auth.refreshSession();await advance(35000);
    const result=await refresh;
    expect(localStorage.getItem(key)).toBe(original);
    expect(result.error).toBeInstanceOf(AuthRetryableFetchError);
  });
  it.each(['/rest/v1/products','/storage/v1/object/invoices/file.pdf','/functions/v1/report'])('G: %s has no auth timeout and completes after 60s',async path=>{
    let resolve!:(r:Response)=>void;
    const network=vi.fn((_input:RequestInfo|URL,_init?:RequestInit)=>new Promise<Response>(r=>{resolve=r}));
    vi.stubGlobal('fetch',network);
    const abort=new AbortController();let done=false;
    const pending=fetchWithAuthTimeout(`https://tenant.test${path}`,{signal:abort.signal}).then(r=>{done=true;return r});
    await advance(60000);
    expect(done).toBe(false);expect(abort.signal.aborted).toBe(false);
    expect(network.mock.calls[0][1]?.signal).toBe(abort.signal);
    resolve(json({ok:true}));expect((await pending).status).toBe(200);
  });
});
