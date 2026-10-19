// Synthetic, isolated compatibility checks. No Auth or MFA implementation is replaced.
import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createClient} from '@supabase/supabase-js';
import {fetchWithAuthTimeout} from '../src/services/authFetch';
import {checkInvoiceIntegrity} from '../src/services/invoiceCore';

const boundary=vi.hoisted(()=>({getSession:vi.fn(),rpc:vi.fn(),callback:null as null|((event:string)=>void)}));
vi.mock('../src/services/supabase',()=>({
  hasActiveTenant:()=>true,getActiveTenant:()=>({workspace_id:'synthetic-invoice-workspace'}),
  getActiveSupabase:()=>({auth:{getSession:boundary.getSession,onAuthStateChange:(cb:(event:string)=>void)=>{boundary.callback=cb;return {data:{subscription:{unsubscribe(){}}}}}},rpc:boundary.rpc}),
}));
import {MfaProvider,useMfaAccess} from '../src/context/MfaContext';

const key='synthetic-invoice-auth-boundary';
const syntheticSession=()=>({access_token:'synthetic-access',refresh_token:'synthetic-refresh',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user:{id:'00000000-0000-4000-8000-000000000071',aud:'authenticated',role:'authenticated',email:'invoice@example.test',app_metadata:{},user_metadata:{},created_at:'2022-02-03T00:00:00Z'}});
beforeEach(()=>{localStorage.clear();vi.clearAllMocks();boundary.getSession.mockResolvedValue({data:{session:syntheticSession()},error:null});boundary.rpc.mockResolvedValue({data:{state:'ready',factor_ids:['synthetic-factor']},error:null});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();localStorage.clear();});

it('invoice integrity evaluation preserves a persisted session without contacting Auth',()=>{
  const before=JSON.stringify(syntheticSession());localStorage.setItem(key,before);
  const network=vi.fn(()=>{throw new Error('unexpected network')});vi.stubGlobal('fetch',network);
  const result=checkInvoiceIntegrity({header:{subtotal:137,vat:28.77,total:165.77},sources:[{kind:'manual',lines:[{description:'Synthetic item',quantity:1,unitPrice:137,lineNet:137,taxRate:21}]}],requireLines:true});
  expect(result.status).toBe('ready');expect(localStorage.getItem(key)).toBe(before);expect(network).not.toHaveBeenCalled();
});

it('real supabase-js logout clears persisted invoice-session credentials and emits SIGNED_OUT',async()=>{
  localStorage.setItem(key,JSON.stringify(syntheticSession()));
  const network=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>new Response('{}',{status:200,headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',network);
  const client=createClient('https://invoice-auth.example.test','synthetic-anon',{global:{fetch:fetchWithAuthTimeout},auth:{storageKey:key,persistSession:true,autoRefreshToken:false,detectSessionInUrl:false}});
  const events:string[]=[];const {data}=client.auth.onAuthStateChange(event=>{events.push(event)});
  try{
    expect((await client.auth.getSession()).data.session?.user.id).toBe(syntheticSession().user.id);
    expect((await client.auth.signOut({scope:'local'})).error).toBeNull();
    expect(network).toHaveBeenCalledTimes(1);expect(String(network.mock.calls[0][0])).toContain('/auth/v1/logout?scope=local');
    expect(localStorage.getItem(key)).toBeNull();expect((await client.auth.getSession()).data.session).toBeNull();expect(events).toContain('SIGNED_OUT');
  }finally{data.subscription.unsubscribe();client.auth.stopAutoRefresh();}
});

function InvoiceBoundary(){const access=useMfaAccess();return access.ready?<p>Invoice workspace</p>:<p>Locked: {access.state}</p>}
it('the unchanged MFA provider removes invoice access after a signed-out event',async()=>{
  render(<MfaProvider><InvoiceBoundary/></MfaProvider>);
  expect(await screen.findByText('Invoice workspace')).toBeTruthy();
  boundary.getSession.mockResolvedValue({data:{session:null},error:null});
  act(()=>boundary.callback?.('SIGNED_OUT'));
  await waitFor(()=>expect(screen.queryByText('Invoice workspace')).toBeNull());
  expect(screen.getByText('Locked: signed_out')).toBeTruthy();
});
