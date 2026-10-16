// Prepared-only integration harness. Requires disposable local Supabase/Auth/Vault.
// No DB URL, SQL, credentials, subprocess stderr, or Auth responses are logged.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

function deny(message){throw new Error(message);}
if(process.env.RUN_LOCAL_AUTH_VAULT_TESTS!=='1'||process.env.ALLOW_DISPOSABLE_LOCAL_DB!=='true')deny('Explicit disposable local Auth/Vault flags required');
const raw=process.env.LOCAL_DATABASE_URL;
if(!raw)deny('Local PostgreSQL configuration required');
const dbUrl=new URL(raw);
if(!['postgres:','postgresql:'].includes(dbUrl.protocol)||!['127.0.0.1','localhost','[::1]'].includes(dbUrl.hostname)||dbUrl.search||dbUrl.hash)deny('Only explicit loopback PostgreSQL is allowed');
const pgEnv={...process.env,PGHOST:dbUrl.hostname.replace(/^\[|\]$/g,''),PGPORT:dbUrl.port||'54322',PGUSER:decodeURIComponent(dbUrl.username),PGPASSWORD:decodeURIComponent(dbUrl.password),PGDATABASE:decodeURIComponent(dbUrl.pathname.slice(1)),PGCONNECT_TIMEOUT:'5'};
delete pgEnv.LOCAL_DATABASE_URL;
function pg(sql,{allowFailure=false}={}){
 return new Promise((resolve,reject)=>{
 const child=spawn('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],{env:pgEnv,stdio:['pipe','pipe','pipe']});
 let output='';child.stdout.on('data',b=>{output+=b;if(output.length>1048576)child.kill();});
 child.stderr.on('data',()=>{});child.on('error',()=>reject(new Error('Local PostgreSQL executable unavailable')));
 child.on('close',code=>{if(code!==0&&!allowFailure)return reject(new Error('Local PostgreSQL assertion failed'));resolve({ok:code===0,output:output.trim()});});
 child.stdin.end(sql);
 });
}
const literal=v=>"'"+String(v).replaceAll("'","''")+"'";
const uuid=v=>{assert.match(v,/^[0-9a-f-]{36}$/i);return literal(v)+'::uuid';};
const scalar=async sql=>(await pg(sql)).output;
const json=async sql=>JSON.parse(await scalar(sql));
assert.match(await scalar("select current_setting('server_version_num');"),/^17\d{4}$/);
await pg(await readFile(new URL('./amazon_oauth_mfa_binding.sql',import.meta.url),'utf8').then(s=>s.replace('\\ir amazon_oauth.sql',"select case when public.integration_amazon_oauth_hooks_ready() then true else null end;")));
const {createLocalMfaFixture}=await import('../../scripts/local-auth-mfa-fixture.mjs');
const {provisionAdmin}=await import('../../scripts/local-oauth-provision.mjs');
let fixture;
try{
 fixture=await createLocalMfaFixture({url:process.env.LOCAL_SUPABASE_URL,anonKey:process.env.LOCAL_SUPABASE_ANON_KEY,serviceKey:process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY,allowDisposableLocal:true,provisionAdmin});
 const {userId,ownerId,context}=fixture;
 assert.equal(context.actor_user_id,userId);assert.equal(context.actor_owner_id,ownerId);
 const token='synthetic-'+randomBytes(32).toString('hex'),seller='TEST'+randomBytes(12).toString('hex').toUpperCase();
 const actor=[uuid(context.actor_session_id),uuid(context.actor_factor_id),String(Number(context.mfa_verified_at))].join(',');
 const identity=[uuid(userId),uuid(ownerId),uuid(ownerId)].join(',');
 async function reserve(target,sellerId){
 const nonce=createHash('sha256').update(randomBytes(32)).digest('hex'),ticket=createHash('sha256').update(randomBytes(32)).digest('hex'),browser=createHash('sha256').update(randomBytes(32)).digest('hex');
 const id=await scalar(`select public.integration_amazon_oauth_reserve(${identity},${target?uuid(target):'null'},${sellerId?literal(sellerId):'null'},${literal(nonce)},${literal(ticket)},now()+interval '9 minutes',now()+interval '29 seconds',${actor});`);
 await pg(`select public.integration_amazon_oauth_bind_browser(${literal(ticket)},${literal(nonce)},${literal(browser)});`);
 return {id,nonce,browser};
 }
 const baseline=await json(`select row_to_json(x) from public.integration_amazon_commit_manual(${identity},null,${literal(seller)},${literal(token)},'Disposable','{"history":"retain"}',null) x;`);
 const snapshot=async()=>json(`select row_to_json(x) from public.integration_amazon_credential_snapshot(${uuid(ownerId)},${uuid(baseline.integration_account_id)},null) x;`);
 const attempt=await reserve(baseline.integration_account_id,seller);
 // TWO independent psql processes race the same pending attempt.
 const claimSql=`select public.integration_amazon_oauth_claim(${literal(attempt.nonce)},${literal(attempt.browser)},${literal(seller)});`;
 const claims=await Promise.all([pg(claimSql,{allowFailure:true}),pg(claimSql,{allowFailure:true})]);
 assert.equal(claims.filter(x=>x.ok).length,1,'Exactly one real database claim wins');
 assert.equal((await snapshot()).secret_payload.refreshToken,token);
 // A real Vault update occurs before the completion trigger throws; rollback
 // must restore both the Vault payload and app/version/links from the baseline.
 const trigger='oauth_fixture_'+randomBytes(8).toString('hex');
 await pg(`create function public.${trigger}() returns trigger language plpgsql as $$ begin if new.id=${uuid(attempt.id)} and new.status='complete' then raise exception 'fixture';end if;return new;end $$;create trigger ${trigger} before update on public.amazon_oauth_attempts for each row execute function public.${trigger}();`);
 try{
 const failed=await pg(`select * from public.integration_amazon_oauth_commit(${uuid(attempt.id)},${literal(seller)},${literal(token+'-rollback')});`,{allowFailure:true});
 assert.equal(failed.ok,false);const unchanged=await snapshot();assert.equal(unchanged.secret_payload.refreshToken,token);assert.equal(Number(unchanged.amazon_credential_version),1);assert.equal(unchanged.sp_api_app_key,'private_v1');
 }finally{await pg(`drop trigger if exists ${trigger} on public.amazon_oauth_attempts;drop function if exists public.${trigger}();`);}
 // Hold writer inside completion after Vault changed but before commit, while
 // a second connection reads. The snapshot must expose the old complete tuple.
 const barrier=194232;
 await pg(`create function public.${trigger}() returns trigger language plpgsql as $$ begin if new.id=${uuid(attempt.id)} and new.status='complete' then perform pg_advisory_xact_lock(${barrier});perform pg_sleep(2);end if;return new;end $$;create trigger ${trigger} before update on public.amazon_oauth_attempts for each row execute function public.${trigger}();`);
 try{
 const writing=pg(`begin;select * from public.integration_amazon_oauth_commit(${uuid(attempt.id)},${literal(seller)},${literal(token+'-public')});commit;`);
 let held=false;for(let i=0;i<30&&!held;i++){held=(await scalar(`select exists(select 1 from pg_locks where locktype='advisory' and objid=${barrier} and granted);`))==='t';}
 assert.equal(held,true,'Writer barrier reached');
 const old=await snapshot();assert.equal(old.sp_api_app_key,'private_v1');assert.equal(old.secret_payload.refreshToken,token);assert.equal(Number(old.amazon_credential_version),1);
 await writing;
 const current=await snapshot();assert.equal(current.sp_api_app_key,'public_v1');assert.equal(current.secret_payload.refreshToken,token+'-public');assert.equal(Number(current.amazon_credential_version),2);assert.equal(current.amazon_account_id,baseline.amazon_account_id);
 }finally{await pg(`drop trigger if exists ${trigger} on public.amazon_oauth_attempts;drop function if exists public.${trigger}();`);}
 // A separate process cannot suspend an authorization workspace while a claim
 // transaction holds its FOR SHARE membership/workspace/owner locks.
 const lockAttempt=await reserve(baseline.integration_account_id,seller);
 const lockBarrier=194233;
 const holding=pg(`begin;select public.integration_amazon_oauth_claim(${literal(lockAttempt.nonce)},${literal(lockAttempt.browser)},${literal(seller)});select pg_advisory_xact_lock(${lockBarrier});select pg_sleep(2);commit;`);
 let rowLockHeld=false;
 for(let i=0;i<30&&!rowLockHeld;i++)rowLockHeld=(await scalar(`select exists(select 1 from pg_locks where locktype='advisory' and objid=${lockBarrier} and granted);`))==='t';
 assert.equal(rowLockHeld,true,'Claim transaction reached authorization lock barrier');
 let suspensionFinished=false;
 const suspension=pg(`update public.workspaces set status='suspended' where id=${uuid(ownerId)};`).then(value=>{suspensionFinished=true;return value;});
 await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(suspensionFinished,false,'Workspace suspension waits for claim transaction');
 await holding;await suspension;
 assert.equal(suspensionFinished,true);
 await pg(`update public.workspaces set status='active' where id=${uuid(ownerId)};select public.integration_amazon_oauth_fail(${uuid(lockAttempt.id)},'cancelled');`);
 // Last-slot manual/OAuth contention shares the workspace advisory lock.
 await pg(`update public.app_subscription_state set entitlements='{"integration.amazon":{"enabled":true},"amazon_accounts":{"limit":2}}' where workspace_id=${uuid(ownerId)};`);
 const nonce=randomBytes(32).toString('hex'),ticket=randomBytes(32).toString('hex');
 const competitors=await Promise.all([
 pg(`select public.integration_amazon_oauth_reserve(${identity},null,null,${literal(nonce)},${literal(ticket)},now()+interval '9 minutes',now()+interval '29 seconds',${actor});`,{allowFailure:true}),
 pg(`select * from public.integration_amazon_commit_manual(${identity},null,${literal(seller+'X')},${literal(token+'-other')},'Other','{}',null);`,{allowFailure:true})]);
 assert.equal(competitors.filter(x=>x.ok).length,1,'Exactly one last-slot competitor wins');
 const logoutAttempt=await reserve(baseline.integration_account_id,seller);
 await fixture.userClient.auth.signOut({scope:'global'});
 assert.equal((await pg(`select public.integration_amazon_oauth_claim(${literal(logoutAttempt.nonce)},${literal(logoutAttempt.browser)},${literal(seller)});`,{allowFailure:true})).ok,false,'Logout invalidates stored attempt proof');
 assert.equal((await snapshot()).secret_payload.refreshToken,token+'-public');
 const {runLocalOAuthLifecycle}=await import('../../scripts/local-oauth-lifecycle.mjs');
 const lifecycle=await runLocalOAuthLifecycle({pg,fixtureOptions:{url:process.env.LOCAL_SUPABASE_URL,anonKey:process.env.LOCAL_SUPABASE_ANON_KEY,serviceKey:process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY,allowDisposableLocal:true,provisionAdmin},waitForExpiry:process.env.RUN_LOCAL_MFA_EXPIRY_WAIT==='1'});
 console.log('Real local Auth/Vault two-connection assertions passed:',JSON.stringify(lifecycle));
} catch {
 throw new Error('Disposable local OAuth integration verification failed; sensitive details suppressed');
} finally {if(fixture)await fixture.cleanup();}
