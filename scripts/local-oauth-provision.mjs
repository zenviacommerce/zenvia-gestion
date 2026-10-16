// Disposable local-only fixture helpers. Never print SQL, keys, URLs, or stderr.
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
export function localPg(sql,{allowFailure=false}={}){
 if(process.env.RUN_LOCAL_AUTH_VAULT_TESTS!=='1'||process.env.ALLOW_DISPOSABLE_LOCAL_DB!=='true')throw new Error('Explicit disposable local database flags required');
 const u=new URL(process.env.LOCAL_DATABASE_URL||'invalid:');
 if(!['postgres:','postgresql:'].includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.search||u.hash)throw new Error('Loopback PostgreSQL required');
 const env={...process.env,PGHOST:u.hostname.replace(/^\[|\]$/g,''),PGPORT:u.port||'54322',PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:decodeURIComponent(u.pathname.slice(1)),PGCONNECT_TIMEOUT:'5'};
 delete env.LOCAL_DATABASE_URL;
 return new Promise((resolve,reject)=>{const c=spawn('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],{env,stdio:['pipe','pipe','pipe']});let output='';c.stdout.on('data',b=>{output+=b;if(output.length>1048576)c.kill();});c.stderr.on('data',()=>{});c.on('error',()=>reject(new Error('Local PostgreSQL executable unavailable')));c.on('close',code=>code!==0&&!allowFailure?reject(new Error('Local PostgreSQL fixture operation failed')):resolve({ok:code===0,output:output.trim()}));c.stdin.end(sql);});
}
const lit=v=>"'"+String(v).replaceAll("'","''")+"'";
const id=v=>{if(!/^[0-9a-f-]{36}$/i.test(v))throw new Error('Invalid fixture identifier');return lit(v)+'::uuid';};
export async function provisionAdmin({userId,email,admin}){
 // Auth fixture creates the user; this callback only creates its own tenant rows.
 const url=new URL(process.env.LOCAL_SUPABASE_URL||'invalid:');
 if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||url.port!=='54321')throw new Error('Local Supabase origin required');
 const version=(await localPg("select current_setting('server_version_num');")).output;
 if(!/^17\d{4}$/.test(version))throw new Error('PostgreSQL 17 required');
 const ownerId=userId;
 await localPg(`begin;insert into public.workspaces(id,slug,name,status,created_by) values(${id(ownerId)},${lit('oauth-fixture-'+randomUUID())},'Disposable OAuth fixture','active',${id(userId)});
 insert into public.app_users(user_id,email,role,active,workspace_id,data_owner_id) values(${id(userId)},${lit(email)},'admin',true,${id(ownerId)},${id(ownerId)}) on conflict(user_id) do update set role='admin',active=true,workspace_id=excluded.workspace_id,data_owner_id=excluded.data_owner_id;
 insert into public.app_subscription_state(workspace_id,plan_key,plan_name,plan_version,status,entitlements) values(${id(ownerId)},'disposable','Disposable',1,'active','{"integration.amazon":{"enabled":true},"amazon_accounts":{"limit":1}}');commit;`);
 return {ownerId,workspaceId:ownerId,cleanup:async()=>{
 // Vault IDs are captured privately in a temporary table, never in subprocess args.
 await localPg(`begin;create temporary table oauth_fixture_secrets on commit drop as select secret_id id from public.integration_accounts where owner_id=${id(ownerId)} and secret_id is not null;
 delete from public.amazon_oauth_attempts where owner_id=${id(ownerId)};delete from public.amazon_seller_owners where owner_id=${id(ownerId)};
 delete from public.amazon_accounts where owner_id=${id(ownerId)};delete from public.integration_accounts where owner_id=${id(ownerId)};
 delete from vault.secrets where id in(select id from oauth_fixture_secrets);
 delete from private.mfa_audit where user_id=${id(userId)};delete from private.mfa_principals where user_id=${id(userId)};
 delete from public.app_users where user_id=${id(userId)};delete from public.workspaces where id=${id(ownerId)};commit;`);
 }};
}
