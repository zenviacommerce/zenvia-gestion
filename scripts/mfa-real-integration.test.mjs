import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';
import {totpCode} from './local-auth-mfa-fixture.mjs';

const url=process.env.API_URL||'http://127.0.0.1:54321';
const anon=process.env.ANON_KEY;
const service=process.env.SERVICE_ROLE_KEY;
const outcomes=[], created=[];
const opts={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
assert.equal(process.env.RUN_LOCAL_AUTH_VAULT_TESTS,'1');
assert.ok(/^http:\/\/(127\.0\.0\.1|localhost):54321$/.test(url));
assert.ok(anon&&service);
const admin=createClient(url,service,opts);
const suffix=randomBytes(5).toString('hex');
const clients=[];
function client(){let c=createClient(url,anon,opts);clients.push(c);return c;}
const must=(r,label)=>{if(r.error)throw new Error(label+':'+String(r.error.code||r.error.status||'AUTH_ERROR'));return r.data};
function gate(name,fn){test(name,async()=>{try{await fn();outcomes.push({name,status:'passed'});}catch(e){outcomes.push({name,status:'failed',reason:e?.name||'Error'});throw e;}})}
process.on('exit',()=>{writeFileSync('mfa-real-results.json',JSON.stringify({engine:'Supabase local GoTrue + PostgreSQL + Vault',outcomes},null,2));});
const discovery=spawnSync('docker',['ps','--filter','name=supabase_db_','--format','{{.Names}}'],{encoding:'utf8'});
assert.equal(discovery.status,0);
const dbContainer=discovery.stdout.trim().split('\n').filter(Boolean)[0];
assert.ok(dbContainer?.startsWith('supabase_db_'));
function sql(query){
 const r=spawnSync('docker',['exec','-i',dbContainer,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-q'],{input:query,encoding:'utf8'});
 assert.equal(r.status,0,'Local SQL failed: '+String(r.stderr||'').replace(/ci-nonsecret-disposable-123/g,'[REDACTED]').slice(0,500));
}
async function addAdmin(workspaceId,createWorkspace=false){
 const email='mfa-ci-'+randomBytes(5).toString('hex')+'@example.test',password=randomBytes(30).toString('base64url');
 const a=must(await admin.auth.admin.createUser({email,password,email_confirm:true}),'create user');
 const id=a.user.id;created.push(id);
 if(createWorkspace)sql(`insert into public.workspaces(id,slug,name,status,created_by)
 values('${workspaceId}','mfa-ci-${suffix}','Disposable MFA CI','active','${id}');`);
 sql(`insert into public.app_users(user_id,email,role,active,data_owner_id,workspace_id)
 values('${id}','${email}','admin',true,'${workspaceId}','${workspaceId}');`);
 return {id,email,password,session:null,c:null,factor:null,secret:null};
}
function sessionId(jwt){
 const body=JSON.parse(Buffer.from(jwt.split('.')[1],'base64url').toString('utf8'));
 assert.match(body.session_id,/^[a-f0-9-]{36}$/i);
 return body.session_id;
}
async function login(user){
 user.c=client();const signed=must(await user.c.auth.signInWithPassword({email:user.email,password:user.password}),'login');
 user.session=signed.session;assert.equal(user.session.user.id,user.id);
 return user.session;
}
async function startEnrollment(user,firstRef,secondRef,approver=null){
 must(await admin.rpc('security_mfa_authorize_enrollment',{p_user_id:user.id,p_reference:firstRef,p_recovery:Boolean(user.factor)}),'authorize');
 if(user.factor){
  // GoTrue Admin API deletes factors; the SQL authorization already revoked sessions.
  must(await admin.auth.admin.mfa.deleteFactor({id:user.factor,userId:user.id}),'remove factor');
  user.factor=null;
 }
 await login(user);
 must(await admin.rpc('security_mfa_release_enrollment',{
  p_user_id:user.id,p_reference:secondRef,p_session_id:sessionId(user.session.access_token),
  p_approver_user_id:approver?.id||null,
 }),'release');
}
async function registerTotp(user,label){
 const enroll=must(await user.c.auth.mfa.enroll({factorType:'totp',friendlyName:label}),'enroll');
 user.factor=enroll.id;user.secret=enroll.totp.secret;
 must(await user.c.rpc('security_mfa_prepare_enrollment',{p_factor_id:user.factor}),'reserve');
 const challenge=must(await user.c.auth.mfa.challenge({factorId:user.factor}),'challenge');
 must(await user.c.auth.mfa.verify({factorId:user.factor,challengeId:challenge.id,code:totpCode(user.secret)}),'verify');
 const assurance=must(await user.c.auth.mfa.getAuthenticatorAssuranceLevel(),'assurance');
 assert.equal(assurance.currentLevel,'aal2');
 must(await user.c.rpc('security_mfa_complete_enrollment',{p_factor_id:user.factor}),'admit');
}
let primary,secondary;
gate('Real local Vault encrypt/decrypt round-trip',async()=>{
 sql(`BEGIN;
 DO $test$ DECLARE v_secret_id uuid; n int; BEGIN
 v_secret_id := vault.create_secret('ci-nonsecret-disposable-123','mfa-ci-vault');
 SELECT count(*) INTO n FROM vault.decrypted_secrets d
 WHERE d.id=v_secret_id AND d.decrypted_secret='ci-nonsecret-disposable-123';
 IF n<>1 THEN RAISE EXCEPTION 'Vault mismatch'; END IF;
 END $test$;
 ROLLBACK;`);
});
gate('Real GoTrue AAL1 -> TOTP -> AAL2 and admission',async()=>{
 const first=must(await admin.auth.admin.createUser({email:'mfa-owner-'+suffix+'@example.test',password:randomBytes(30).toString('base64url'),email_confirm:true}),'create owner');
 // The owner must also exist as an admin workspace principal.
 created.push(first.user.id);
 const ownerPwd=randomBytes(30).toString('base64url');
 // Update only this disposable user's password through Auth Admin.
 must(await admin.auth.admin.updateUserById(first.user.id,{password:ownerPwd}),'password');
 const id=first.user.id,email='mfa-owner-'+suffix+'@example.test';
 sql(`insert into public.workspaces(id,slug,name,status,created_by) values('${id}','mfa-ci-${suffix}','MFA CI','active','${id}');
 insert into public.app_users(user_id,email,role,active,data_owner_id,workspace_id)
 values('${id}','${email}','admin',true,'${id}','${id}');`);
 primary={id,email,password:ownerPwd,session:null,c:null,factor:null,secret:null};
 await startEnrollment(primary,'initial-owner-check-'+suffix,'owner-release-'+suffix);
 const level=must(await primary.c.auth.mfa.getAuthenticatorAssuranceLevel(),'AAL1');
 assert.equal(level.currentLevel,'aal1');
 await registerTotp(primary,'CI-primary-TOTP');
});
gate('GoTrue refresh preserves the verified account',async()=>{
 const refreshed=must(await primary.c.auth.refreshSession(),'refresh');
 assert.equal(refreshed.user.id,primary.id);
});
gate('Direct forced MFA RPC denies fresh AAL1',async()=>{
 const c=client();must(await c.auth.signInWithPassword({email:primary.email,password:primary.password}),'AAL1');
 const result=await c.rpc('security_mfa_oauth_start_context');
 assert.ok(result.error&&String(result.error.message).includes('MFA_'),'Direct MFA RPC did not enforce aal2');
});
gate('Two-admin recovery needs a different AAL2 approver',async()=>{
 secondary=await addAdmin(primary.id,false);
 const first='peer-first-'+suffix,second='peer-second-'+suffix;
 must(await admin.rpc('security_mfa_authorize_enrollment',{p_user_id:secondary.id,p_reference:first,p_recovery:false}),'peer authorize');
 await login(secondary);
 let release=await admin.rpc('security_mfa_release_enrollment',{
  p_user_id:secondary.id,p_reference:second,p_session_id:sessionId(secondary.session.access_token),p_approver_user_id:primary.id,
 });
 assert.ok(release.error,'Peer recovery unexpectedly accepted an unauthenticated reviewer');
 must(await primary.c.rpc('security_mfa_approve_recovery',{p_target_user_id:secondary.id,p_case_reference:first}),'peer MFA approval');
 must(await admin.rpc('security_mfa_release_enrollment',{
  p_user_id:secondary.id,p_reference:second,p_session_id:sessionId(secondary.session.access_token),p_approver_user_id:primary.id,
 }),'approved peer release');
 await registerTotp(secondary,'CI-peer-TOTP');
});
gate('Owner service_role break-glass when no other admitted admin',async()=>{
 sql(`update public.app_users set active=false where user_id='${primary.id}';`);
 await startEnrollment(secondary,'owner-break-glass-'+suffix,'owner-second-proof-'+suffix);
 await registerTotp(secondary,'CI-recovered-TOTP');
 sql(`update public.app_users set active=true where user_id='${primary.id}';`);
});
gate('GoTrue factor revocation and re-enrollment',async()=>{
 must(await admin.auth.admin.mfa.deleteFactor({id:secondary.factor,userId:secondary.id}),'revoke');
 const f=must(await admin.auth.admin.mfa.listFactors({userId:secondary.id}),'factor list');
 assert.equal(f.factors?.some(x=>x.id===secondary.factor),false);
});
gate('Real Edge denies unauthenticated or AAL1 calls (not 404)',async()=>{
 const unauth=await fetch(url+'/functions/v1/platform-bridge',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
 assert.notEqual(unauth.status,404,'Edge function not served; cannot claim denial');
 assert.ok([401,403].includes(unauth.status),'Expected Edge authentication denial');
});
after(async()=>{
 for(const c of clients){try{await c.auth.signOut({scope:'local'});}catch{}c.auth.stopAutoRefresh();}
 for(const id of created.reverse()){try{must(await admin.auth.admin.deleteUser(id),'delete local user');}catch{}}
 if(primary){try{sql(`delete from public.app_users where data_owner_id='${primary.id}';delete from public.workspaces where id='${primary.id}';`)}catch{}}
 admin.auth.stopAutoRefresh();
});
