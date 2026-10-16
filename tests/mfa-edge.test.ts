import {describe,it,expect,vi} from 'vitest';
import {assertMfaWithClient,assertBridgeMfaAllowed} from '../supabase/functions/_shared/mfa-policy';

describe('Edge MFA authority',()=>{
 it('passes the original bearer to a dedicated client and asks SQL for current authority',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:null,error:null});
  const create=vi.fn(()=>({rpc}));
  await assertMfaWithClient(new Request('https://edge.test',{headers:{Authorization:'Bearer original.jwt'}}),true,create);
  expect(create).toHaveBeenCalledWith('original.jwt');
  expect(rpc).toHaveBeenCalledWith('security_mfa_assert',{p_recent:true});
 });
 it('rejects absent or non-bearer credentials without touching SQL',async()=>{
  const create=vi.fn();
  for(const authorization of ['', 'Basic abc','original.jwt']){
   await expect(assertMfaWithClient(new Request('https://edge.test',{headers:{authorization}}),false,create)).rejects.toThrow('Sesión');
  }
  expect(create).not.toHaveBeenCalled();
 });
 it('fails closed on database rejection, missing migration and unavailable infrastructure',async()=>{
  for(const message of ['MFA_REQUIRED','MFA_RECENT_REQUIRED','MFA_RECOVERY_LOCKED','function not found']){
   await expect(assertMfaWithClient(new Request('https://edge.test',{headers:{authorization:'Bearer token'}}),false,()=>({rpc:async()=>({error:{message}})}))).rejects.toThrow(message);
  }
 });
 it('fails closed when the authority request rejects',async()=>{
  await expect(assertMfaWithClient(new Request('https://edge.test',{headers:{authorization:'Bearer token'}}),false,()=>({rpc:async()=>{throw new Error('network unavailable');}}))).rejects.toThrow('network unavailable');
 });
 it('bridge permits only an explicit server decision',async()=>{
  for(const result of [{data:false},{data:null},{data:true,error:{message:'unavailable'}}]){
   await expect(assertBridgeMfaAllowed({rpc:async()=>result})).rejects.toThrow();
  }
  await expect(assertBridgeMfaAllowed({rpc:async()=>({data:true,error:null})})).resolves.toBeUndefined();
 });
});

// Regression inventory: endpoints retain their existing role/tenant checks and
// must also pass the shared server guard before their privileged client is used.
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
function sources(dir:string):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?sources(join(dir,entry.name)):entry.name.endsWith('.ts')?[join(dir,entry.name)]:[]);}
describe('Edge guard inventory',()=>{
 it('covers every explicit human getUser entry point',()=>{
  const files=sources('supabase/functions').filter(path=>readFileSync(path,'utf8').includes('.auth.getUser(token)'));
  expect(files.length).toBeGreaterThan(15);
  for(const file of files){
   const source=readFileSync(file,'utf8');
   expect(source.indexOf('await assertHumanMfa(req,'),file).toBeGreaterThan(-1);
   expect(source.indexOf('await assertHumanMfa(req,'),file).toBeLessThan(source.indexOf('.auth.getUser(token)'));
  }
 });
 it('keeps machine workers behind internal credentials',()=>{
  for(const name of ['amazon-sync-worker','amazon-sync-orchestrator','amazon-sync-orders','amazon-sync-inventory','amazon-sync-finances','amazon-sync-fx','amazon-sync-product-images','amazon-backfill-finance-components']){
   const source=readFileSync(`supabase/functions/${name}/index.ts`,'utf8');
   expect(source,name).toContain('requireInternalSecret(req)');
   expect(source,name).not.toContain('assertHumanMfa(req');
  }
 });
 it('scopes PostgREST authorization to the received human bearer',()=>{
  const source=readFileSync('supabase/functions/_shared/mfa.ts','utf8');
  expect(source).toContain('SUPABASE_ANON_KEY');
  expect(source).toContain('global:{headers:{Authorization:`Bearer ${token}`}}');
 });
});
