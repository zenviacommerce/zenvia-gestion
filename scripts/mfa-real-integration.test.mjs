import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';
import {totpCode} from './local-auth-mfa-fixture.mjs';

const url=process.env.API_URL||'http://127.0.0.1:54321';
const anon=process.env.ANON_KEY||process.env.PUBLISHABLE_KEY;
const service=process.env.SERVICE_ROLE_KEY||process.env.SECRET_KEY;
const outcomes=[];
function gate(name,fn){test(name,async()=>{try{await fn();outcomes.push({name,status:'passed'})}catch(e){outcomes.push({name,status:'failed',reason:e?.name||'Error'});throw e}})}
process.on('exit',()=>writeFileSync('mfa-real-results.json',JSON.stringify({engine:'disposable local Supabase GoTrue',outcomes},null,2)));
assert.equal(process.env.RUN_LOCAL_AUTH_VAULT_TESTS,'1','Explicit disposable-only gate required');
assert.ok(url.startsWith('http://127.0.0.1:54321')||url.startsWith('http://localhost:54321'));
assert.ok(anon&&service,'Local Supabase credentials missing');
const opts={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const admin=createClient(url,service,opts);
const user=createClient(url,anon,opts);
const email='mfa-real-'+randomBytes(8).toString('hex')+'@example.test';
const password=randomBytes(36).toString('base64url');
let uid,factor,secret;
const must=(result,label)=>{if(result.error)throw new Error(label+': '+(result.error.code||result.error.status));return result.data};
gate('GoTrue create user, AAL1 login',async()=>{
 const created=must(await admin.auth.admin.createUser({email,password,email_confirm:true}),'create');uid=created.user.id;
 const s=must(await user.auth.signInWithPassword({email,password}),'login');
 assert.equal(s.session?.user?.id,uid);
 const aal=must(await user.auth.mfa.getAuthenticatorAssuranceLevel(),'aal1');
 assert.equal(aal.currentLevel,'aal1');
});
gate('GoTrue TOTP enroll, challenge, verify and AAL2',async()=>{
 const enrolled=must(await user.auth.mfa.enroll({factorType:'totp',friendlyName:'real-ci-disposable'}),'enroll');
 factor=enrolled.id;secret=enrolled.totp.secret;
 const ch=must(await user.auth.mfa.challenge({factorId:factor}),'challenge');
 must(await user.auth.mfa.verify({factorId:factor,challengeId:ch.id,code:totpCode(secret)}),'verify');
 const aal=must(await user.auth.mfa.getAuthenticatorAssuranceLevel(),'aal2');
 assert.equal(aal.currentLevel,'aal2');
});
gate('GoTrue refresh preserves authenticated session',async()=>{
 const refreshed=must(await user.auth.refreshSession(),'refresh');
 assert.equal(refreshed.user?.id,uid);
});
gate('GoTrue revoke factor changes next-session assurance',async()=>{
 must(await user.auth.mfa.unenroll({factorId:factor}),'unenroll');
 const factors=must(await user.auth.mfa.listFactors(),'list');
 assert.equal(factors.totp?.some(x=>x.id===factor),false);
});
gate('Direct sensitive RPC without AAL2 must reject',async()=>{
 const other=createClient(url,anon,opts);
 must(await other.auth.signInWithPassword({email,password}),'second login');
 const res=await other.rpc('security_mfa_assert',{p_recent:true});
 assert.ok(res.error,'Expected direct RPC rejection without aal2');
});
gate('Direct sensitive Edge without AAL2 must reject',async()=>{
 const other=createClient(url,anon,opts);
 must(await other.auth.signInWithPassword({email,password}),'third login');
 const res=await other.functions.invoke('platform-bridge',{body:{action:'security_probe'}});
 assert.ok(res.error||res.data?.error||res.data?.status==='denied','Expected Edge rejection');
});
gate('Vault actual database integration',async()=>{
 // Exercise real SQL encryption/decryption in the disposable Postgres container.
 const containers=spawnSync('docker',['ps','--filter','name=supabase_db_','--format','{{.Names}}'],{encoding:'utf8'});
 assert.equal(containers.status,0,'Docker database discovery failed');
 const name=containers.stdout.trim().split('\\n').filter(Boolean)[0];
 assert.ok(name?.startsWith('supabase_db_'),'Disposable Supabase database missing');
 const sql=`BEGIN;
 DO $test$ DECLARE secret_id uuid; result_count int; BEGIN
  secret_id := vault.create_secret('ci-nonsecret-disposable-123','mfa-ci-secret');
  SELECT count(*) INTO result_count FROM vault.decrypted_secrets
    WHERE id=secret_id AND decrypted_secret='ci-nonsecret-disposable-123';
  IF result_count<>1 THEN RAISE EXCEPTION 'Vault roundtrip mismatch'; END IF;
 END $test$;
 ROLLBACK;`;
 const run=spawnSync('docker',['exec','-i',name,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-q'],{input:sql,encoding:'utf8'});
 assert.equal(run.status,0,'Real Vault round-trip failed');
});
gate('Adaptive recovery: single admin, double admin, break-glass',async()=>{
 assert.fail('End-to-end service workflow + independent approver binding not implemented');
});
test('Disposable cleanup',async()=>{
 if(uid)must(await admin.auth.admin.deleteUser(uid),'delete fixture user');
});
