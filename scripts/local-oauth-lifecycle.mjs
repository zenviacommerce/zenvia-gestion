// PREPARED ONLY: destructive only to fixtures created by the explicit local runner.
// Each lifecycle case uses real GoTrue operations and actual installed SQL/Vault.
import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';
export async function runLocalOAuthLifecycle({pg,fixtureOptions,waitForExpiry=false}){
 if(process.env.RUN_LOCAL_AUTH_VAULT_TESTS!=='1'||process.env.ALLOW_DISPOSABLE_LOCAL_DB!=='true')throw Error('Explicit disposable local flags required');
 const origin=new URL(fixtureOptions.url);if(origin.protocol!=='http:'||!['localhost','127.0.0.1'].includes(origin.hostname)||origin.port!=='54321')throw Error('Loopback Auth required');
 const {createLocalMfaFixture}=await import('./local-auth-mfa-fixture.mjs');
 const lit=value=>"'"+String(value).replaceAll("'","''")+"'",id=value=>{assert.match(value,/^[0-9a-f-]{36}$/i);return lit(value)+'::uuid';};
 const scalar=async sql=>(await pg(sql)).output;
 let completed=0;
 for(const scenario of ['recovery','logout','removed_factor',...(waitForExpiry?['expired_proof']:[])])for(const phase of ['claim','commit']){
  let fixture;try{
   fixture=await createLocalMfaFixture(fixtureOptions);const c=fixture.context,owner=id(fixture.ownerId),identity=[id(fixture.userId),owner,owner].join(','),seller='TEST'+randomBytes(12).toString('hex').toUpperCase(),token='synthetic-'+randomBytes(24).toString('hex');
   const base=JSON.parse(await scalar(`select row_to_json(x) from integration_amazon_commit_manual(${identity},null,${lit(seller)},${lit(token)},'Lifecycle fixture','{}',null) x;`));
   const nonce=randomBytes(32).toString('hex'),ticket=randomBytes(32).toString('hex'),browser=randomBytes(32).toString('hex');
   const attempt=await scalar(`select integration_amazon_oauth_reserve(${identity},${id(base.integration_account_id)},${lit(seller)},${lit(nonce)},${lit(ticket)},now()+interval '9 minutes',now()+interval '29 seconds',${id(c.actor_session_id)},${id(c.actor_factor_id)},${Number(c.mfa_verified_at)});`);
   await pg(`select integration_amazon_oauth_bind_browser(${lit(ticket)},${lit(nonce)},${lit(browser)});`);
   if(phase==='commit')assert.equal((await pg(`select integration_amazon_oauth_claim(${lit(nonce)},${lit(browser)},${lit(seller)});`)).ok,true);
   if(scenario==='recovery'){const result=await fixture.admin.rpc('security_mfa_authorize_enrollment',{p_user_id:fixture.userId,p_reference:'disposable-local-recovery-test',p_recovery:true});assert.equal(result.error,null);}
   if(scenario==='logout'){const result=await fixture.userClient.auth.signOut({scope:'global'});assert.equal(result.error,null);}
   if(scenario==='removed_factor'){const result=await fixture.admin.auth.admin.mfa.deleteFactor({userId:fixture.userId,id:fixture.factorId});assert.equal(result.error,null);}
   // Deliberate real-clock check: no fabricated AMR/session timestamp. Opt-in
   // separately because both claim and commit cases each wait over five minutes.
   if(scenario==='expired_proof')await new Promise(resolve=>setTimeout(resolve,301000));
   const denied=await pg(phase==='claim'?`select integration_amazon_oauth_claim(${lit(nonce)},${lit(browser)},${lit(seller)});`:`select * from integration_amazon_oauth_commit(${id(attempt)},${lit(seller)},'must-never-write');`,{allowFailure:true});
   assert.equal(denied.ok,false,'Current real Auth state must reject the callback');
   const snapshot=JSON.parse(await scalar(`select row_to_json(x) from integration_amazon_credential_snapshot(${owner},${id(base.integration_account_id)},null) x;`));
   assert.equal(snapshot.secret_payload.refreshToken,token);assert.equal(Number(snapshot.amazon_credential_version),1);assert.equal(snapshot.sp_api_app_key,'private_v1');completed++;
  }finally{if(fixture)await fixture.cleanup();}
 }
 return {recoveryLogoutFactorCases:completed,realExpiryWaitExecuted:waitForExpiry};
}
