/** PREPARATION for an explicitly disposable LOCAL GoTrue harness. Never production.
 * No keys, passwords, TOTP secrets/codes or tokens are printed or written to disk.
 * Docker/Supabase/Auth integration execution is separate from its unit tests. */
import {createClient} from '@supabase/supabase-js';
import {createHmac,randomBytes} from 'node:crypto';

export function localAuthOrigin(value,allowDisposableLocal){
 if(allowDisposableLocal!==true)throw new Error('Explicit disposable-local authorization required');
 const url=new URL(value);
 if(url.protocol!=='http:'||!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='54321'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Disposable Auth must be loopback HTTP port 54321');
 return url.origin;
}
export function totpCode(secret,nowMs=Date.now()){
 const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',normalized=String(secret).toUpperCase().replace(/=+$/,'');
 if(!/^[A-Z2-7]{16,}$/.test(normalized)||!Number.isFinite(nowMs)||nowMs<0)throw new Error('Invalid local TOTP input');
 let buffer=0,bits=0;const bytes=[];
 for(const char of normalized){buffer=(buffer<<5)|chars.indexOf(char);bits+=5;while(bits>=8){bits-=8;bytes.push((buffer>>bits)&255)}buffer&=(1<<bits)-1;}
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(nowMs/30000)));
 const digest=createHmac('sha1',Buffer.from(bytes)).update(counter).digest(),offset=digest[digest.length-1]&15;
 const number=(digest.readUInt32BE(offset)&0x7fffffff)%1_000_000;
 return String(number).padStart(6,'0');
}
function checked(result,label){
 if(result.error)throw new Error(`${label} failed (${result.error.code||result.error.status||'ERROR'})`);
 return result.data;
}
function sessionId(session){
 // This is fixture routing only. The SQL service release verifies the actual
 // session row; authorization never relies on this local JWT decoding.
 const payload=JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url').toString('utf8'));
 if(typeof payload.session_id!=='string')throw new Error('Local Auth session lacks session_id');
 return payload.session_id;
}
export async function createLocalMfaFixture({url,anonKey,serviceKey,allowDisposableLocal,provisionAdmin}){
 if(process.env.RUN_LOCAL_AUTH_VAULT_TESTS!=='1')throw new Error('Set RUN_LOCAL_AUTH_VAULT_TESTS=1 only for disposable local services');
 const origin=localAuthOrigin(url,allowDisposableLocal);
 if(!anonKey||!serviceKey||typeof provisionAdmin!=='function')throw new Error('Local keys and provisionAdmin hook required');
 const localFetch=(input,init={})=>{
  const target=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  if(target.origin!==origin)throw new Error('Fixture refused nonlocal service request');
  return fetch(input,{...init,redirect:'error'});
 };
 const options={global:{fetch:localFetch},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
 const admin=createClient(origin,serviceKey,options),userClient=createClient(origin,anonKey,options),clients=[userClient];
 const credentials={email:`mfa-oauth-${randomBytes(8).toString('hex')}@example.test`,password:randomBytes(30).toString('base64url')};
 let userId,ownerId,provisioned,latestSession,totpSecret,factorId,cleaned=false;
 const cleanup=async()=>{
  if(cleaned)return;cleaned=true;
  for(const client of clients){try{await client.auth.signOut({scope:'local'})}catch{/* Continue owned fixture cleanup. */}client.auth.stopAutoRefresh();}
  if(provisioned?.cleanup)await provisioned.cleanup();
  if(userId)checked(await admin.auth.admin.deleteUser(userId),'local fixture user cleanup');
  admin.auth.stopAutoRefresh();
 };
 try{
  const created=checked(await admin.auth.admin.createUser({...credentials,email_confirm:true}),'local fixture user creation');
  if(!created?.user?.id)throw new Error('Local fixture user creation returned no identity');userId=created.user.id;
  provisioned=await provisionAdmin({userId,email:credentials.email});ownerId=provisioned?.ownerId;
  if(typeof ownerId!=='string')throw new Error('provisionAdmin must return ownerId');
  // Lock/revoke first, then authorize only the independently selected NEW session.
  checked(await admin.rpc('security_mfa_authorize_enrollment',{p_user_id:userId,p_reference:'disposable-local-first-approval',p_recovery:false}),'local enrollment authorization');
  const signed=checked(await userClient.auth.signInWithPassword(credentials),'local password sign-in');
  if(!signed?.session)throw new Error('Local Auth returned no password session');latestSession=signed.session;
  checked(await admin.rpc('security_mfa_release_enrollment',{p_user_id:userId,p_reference:'disposable-local-second-approval',p_session_id:sessionId(latestSession)}),'local bound enrollment release');
  const enrolled=checked(await userClient.auth.mfa.enroll({factorType:'totp',friendlyName:'Disposable local MFA fixture'}),'local TOTP enrollment');
  factorId=enrolled.id;totpSecret=enrolled.totp.secret;
  checked(await userClient.rpc('security_mfa_prepare_enrollment',{p_factor_id:factorId}),'local factor reservation');
  const verifyAgain=async()=>{
   const challenge=checked(await userClient.auth.mfa.challenge({factorId}),'local TOTP challenge');
   checked(await userClient.auth.mfa.verify({factorId,challengeId:challenge.id,code:totpCode(totpSecret)}),'local TOTP verification');
   latestSession=checked(await userClient.auth.getSession(),'local elevated session').session;
   if(!latestSession)throw new Error('Local elevated session unavailable');return latestSession;
  };
  await verifyAgain();
  checked(await userClient.rpc('security_mfa_complete_enrollment',{p_factor_id:factorId}),'local server factor admission');
  const context=checked(await userClient.rpc('security_mfa_oauth_start_context'),'local OAuth MFA context');
  const signInAal1=async()=>{
   const other=createClient(origin,anonKey,options);clients.push(other);
   const result=checked(await other.auth.signInWithPassword(credentials),'local AAL1 sign-in');
   if(!result?.session)throw new Error('Local AAL1 session unavailable');return other;
  };
  return {admin,userClient,userId,ownerId,get sessionId(){return sessionId(latestSession)},factorId,context,get session(){return latestSession},credentials,signInAal1,verifyAgain,cleanup};
 }catch(error){try{await cleanup()}catch{/* Never log keys/tokens from cleanup errors. */}throw error;}
}
