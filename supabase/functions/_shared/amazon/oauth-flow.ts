import {readAmazonOAuthConfig,buildAmazonConsentUrl,validateAmazonContinuation,validAmazonSeller} from './oauth-config.ts';
import type {AmazonOAuthHumanRpc} from './oauth-auth.ts';
import type {EnabledAmazonOAuthConfig,OAuthContinuation} from './oauth-config.ts';
import {authenticateAmazonOAuth,authorizeAmazonOAuthEntitlement,AmazonOAuthAuthError,readTrustedAmazonOAuthActor,amazonOAuthMfaReady} from './oauth-auth.ts';
import {encodeOAuthBytes,hashOAuthValue,signAmazonState,verifyAmazonState} from './oauth-state.ts';
export type OAuthStartInput={workspaceId?:string;integrationAccountId?:string;continuation?:OAuthContinuation};
export type OAuthDependencies={admin:any;humanRpc?:AmazonOAuthHumanRpc;fetch:typeof fetch;now:()=>number;envGet:(name:string)=>string|undefined;randomBytes:(n:number)=>Uint8Array};
const cookieName='__Host-zenvia-amazon-oauth';
const safeHeaders={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'};
function headers(config?:EnabledAmazonOAuthConfig){const h=new Headers(safeHeaders);if(config){h.set('Access-Control-Allow-Origin',config.uiOrigin);h.set('Vary','Origin');h.set('Access-Control-Allow-Headers','authorization, apikey, content-type, x-client-info');h.set('Access-Control-Allow-Methods','POST, GET, OPTIONS');}return h;}
function failure(status:number,config?:EnabledAmazonOAuthConfig){const h=headers(config);h.set('Content-Type','application/json');return new Response(JSON.stringify({error:'Amazon authorization unavailable.'}),{status,headers:h});}
function cookie(value:string,ttl:number){return `${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ttl}`;}
function readCookie(req:Request):string|null{const values=(req.headers.get('cookie')||'').split(';').map(p=>p.trim()).filter(p=>p.startsWith(cookieName+'='));if(values.length>1)throw Error();if(!values.length)return null;const value=values[0].slice(cookieName.length+1);if(!/^[A-Za-z0-9_-]{43}$/.test(value))throw Error();return value;}
function opaque(deps:OAuthDependencies){const bytes=deps.randomBytes(32);if(!(bytes instanceof Uint8Array)||bytes.length!==32)throw Error();return encodeOAuthBytes(bytes);}
function query(url:URL,allowed:string[]){if(url.search.length>16384)throw Error();for(const name of url.searchParams.keys())if(!allowed.includes(name)||url.searchParams.getAll(name).length!==1)throw Error();}
async function rpc(deps:OAuthDependencies,name:string,args:Record<string,unknown>){const r=await deps.admin.rpc(name,args);if(r.error)throw Error('Amazon authorization unavailable.');return r.data;}
function finalRedirect(config:EnabledAmazonOAuthConfig,result:'connected'|'failed'|'unavailable'):Response{const url=new URL(config.uiReturnUrl);url.searchParams.set('amazon_oauth',result);const h=headers();h.set('Location',url.href);h.set('Set-Cookie',cookie('',0));return new Response(null,{status:303,headers:h});}
async function boundedJson(req:Request){const declared=req.headers.get('content-length');if(declared&&(!/^\d+$/.test(declared)||Number(declared)>16384))throw Error();if(!req.body)throw Error();const reader=req.body.getReader();let size=0;const chunks:Uint8Array[]=[];try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384)throw Error();chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}const all=new Uint8Array(size);let pos=0;for(const part of chunks){all.set(part,pos);pos+=part.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));}
function inputChecked(raw:any):OAuthStartInput{if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['workspaceId','integrationAccountId','continuation'].includes(k))||(raw.workspaceId!==undefined&&(typeof raw.workspaceId!=='string'||!raw.workspaceId||raw.workspaceId.length>100))||(raw.integrationAccountId!==undefined&&(typeof raw.integrationAccountId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw.integrationAccountId))))throw Error();return raw;}
export async function handleAmazonOAuthStart(req:Request,deps:OAuthDependencies):Promise<Response>{
  const config=readAmazonOAuthConfig(deps.envGet);if(!config.enabled)return failure(503);
  try{
    const url=new URL(req.url);if(url.origin!==new URL(config.redirectUri).origin||url.pathname!=='/functions/v1/amazon-oauth-start')return failure(400,config);
    if(req.method==='OPTIONS'){if(req.headers.get('origin')!==config.uiOrigin)return failure(403,config);return new Response(null,{status:204,headers:headers(config)});}
    if(req.method==='POST'){
      if(req.headers.get('origin')!==config.uiOrigin)return failure(403,config);query(url,[]);
      const input=inputChecked(await boundedJson(req));const context=await authenticateAmazonOAuth(req,deps.admin,input.workspaceId);await authorizeAmazonOAuthEntitlement(deps.admin,context);
      const continuation=input.continuation===undefined?undefined:validateAmazonContinuation(input.continuation,config.applicationId);
      let expectedSeller=continuation?.sellingPartnerId||null;
      if(input.integrationAccountId){const r=await deps.admin.from('integration_accounts').select('id,owner_id,provider,external_account_id').eq('id',input.integrationAccountId).eq('owner_id',context.ownerId).eq('provider','amazon').maybeSingle();const target=r.data;if(r.error||target?.id!==input.integrationAccountId||target.owner_id!==context.ownerId||target.provider!=='amazon'||!validAmazonSeller(target.external_account_id)||(expectedSeller&&expectedSeller!==target.external_account_id))return failure(403,config);expectedSeller=target.external_account_id;}
      const now=deps.now(),iat=Math.floor(now/1000),nonce=opaque(deps),ticket=opaque(deps);
      const state=await signAmazonState({v:1,nonce,iat,exp:iat+600,app:'public_v1',purpose:'connect'},config.signingKey);
      if(!readAmazonOAuthConfig(deps.envGet).enabled)return failure(503,config);
      const actor=await readTrustedAmazonOAuthActor(req,context,deps.humanRpc);
      if(!await amazonOAuthMfaReady(deps.admin)||!readAmazonOAuthConfig(deps.envGet).enabled)return failure(503,config);
      await rpc(deps,'integration_amazon_oauth_reserve',{p_user_id:context.userId,p_workspace_id:context.workspaceId,p_owner_id:context.ownerId,p_target_integration_id:input.integrationAccountId||null,p_expected_seller_id:expectedSeller,p_nonce_hash:await hashOAuthValue(nonce),p_ticket_hash:await hashOAuthValue(ticket),p_expires_at:new Date((iat+600)*1000).toISOString(),p_ticket_expires_at:new Date(now+30000).toISOString(),p_actor_session_id:actor.actor_session_id,p_actor_factor_id:actor.actor_factor_id,p_mfa_verified_at:actor.mfa_verified_at,p_continuation:continuation||null});
      const launch=new URL('/functions/v1/amazon-oauth-start',config.redirectUri);launch.searchParams.set('ticket',ticket);launch.searchParams.set('state',state);const h=headers(config);h.set('Content-Type','application/json');return new Response(JSON.stringify({launchUrl:launch.href}),{headers:h});
    }
    if(req.method==='GET'){
      query(url,['ticket','state']);const ticket=url.searchParams.get('ticket')||'',state=url.searchParams.get('state')||'';if(!/^[A-Za-z0-9_-]{43}$/.test(ticket))throw Error();
      const payload=await verifyAmazonState(state,config.signingKey,deps.now()),browser=opaque(deps),previous=readCookie(req);
      if(!readAmazonOAuthConfig(deps.envGet).enabled)return failure(503,config);
      const bound=await rpc(deps,'integration_amazon_oauth_bind_browser',{p_ticket_hash:await hashOAuthValue(ticket),p_nonce_hash:await hashOAuthValue(payload.nonce),p_browser_hash:await hashOAuthValue(browser),p_previous_browser_hash:previous?await hashOAuthValue(previous):null});
      if(!bound||typeof bound!=='object')throw Error();const continuation=bound.continuation?validateAmazonContinuation(bound.continuation,config.applicationId):undefined;
      const h=headers();h.set('Set-Cookie',cookie(browser,600));h.set('Location',buildAmazonConsentUrl(config,state,continuation));return new Response(null,{status:303,headers:h});
    }
    return failure(405,config);
  }catch(error){return failure(error instanceof AmazonOAuthAuthError?error.status:400,config);}
}
async function exchange(deps:OAuthDependencies,config:EnabledAmazonOAuthConfig,code:string):Promise<string>{
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Amazon authorization unavailable.'));},10000);});
  try{return await Promise.race([deadline,(async()=>{
    const response=await deps.fetch('https://api.amazon.com/auth/o2/token',{method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:config.redirectUri,client_id:config.clientId,client_secret:config.clientSecret}).toString(),signal:controller.signal});
    if(!response.ok||!response.body)throw Error();const reader=response.body.getReader();let size=0;const parts:Uint8Array[]=[];try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>65536)throw Error();parts.push(r.value);}}finally{await reader.cancel().catch(()=>{});}const bytes=new Uint8Array(size);let position=0;for(const p of parts){bytes.set(p,position);position+=p.length;}const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(typeof data?.refresh_token!=='string'||!data.refresh_token.trim()||data.refresh_token.length>16384||/[\x00-\x1f\x7f]/.test(data.refresh_token))throw Error();return data.refresh_token;
  })()]);}finally{if(timer!==undefined)clearTimeout(timer);}
}
export async function handleAmazonOAuthCallback(req:Request,deps:OAuthDependencies):Promise<Response>{
  const config=readAmazonOAuthConfig(deps.envGet);if(!config.enabled){const r=failure(503);r.headers.set('Set-Cookie',cookie('',0));return r;}
  let attemptId:string|undefined;let phase='exchange_failed';
  try{
    const url=new URL(req.url);if(req.method!=='GET'||url.origin!==new URL(config.redirectUri).origin||url.pathname!==new URL(config.redirectUri).pathname)throw Error();
    query(url,['state','spapi_oauth_code','selling_partner_id','error']);
    const state=url.searchParams.get('state')||'',seller=url.searchParams.get('selling_partner_id'),code=url.searchParams.get('spapi_oauth_code'),amazonError=url.searchParams.get('error');
    if(!validAmazonSeller(seller)||(amazonError?(!/^[a-z_]{1,64}$/.test(amazonError)||code!==null):(!code||code.length>4096||/[\x00-\x1f\x7f]/.test(code))))throw Error();
    const payload=await verifyAmazonState(state,config.signingKey,deps.now()),browser=readCookie(req);if(!browser)throw Error();
    if(!readAmazonOAuthConfig(deps.envGet).enabled)return finalRedirect(config,'unavailable');
    if(!await amazonOAuthMfaReady(deps.admin)||!readAmazonOAuthConfig(deps.envGet).enabled)return finalRedirect(config,'unavailable');
    const claim=await rpc(deps,'integration_amazon_oauth_claim',{p_nonce_hash:await hashOAuthValue(payload.nonce),p_browser_hash:await hashOAuthValue(browser),p_seller_id:seller});
    if(!claim||typeof claim.attempt_id!=='string'||!claim.attempt_id||claim.app_key!=='public_v1')throw Error();attemptId=claim.attempt_id;
    if(amazonError)throw Error();const refreshToken=await exchange(deps,config,code!);
    const current=readAmazonOAuthConfig(deps.envGet);if(!current.enabled||current.applicationId!==config.applicationId||current.redirectUri!==config.redirectUri||current.clientId!==config.clientId||current.clientSecret!==config.clientSecret){phase='configuration_unavailable';throw Error();}
    phase='commit_failed';const committed=await rpc(deps,'integration_amazon_oauth_commit',{p_attempt_id:attemptId,p_seller_id:seller,p_refresh_token:refreshToken});
    const result=Array.isArray(committed)?committed[0]:committed;if(!result?.integration_account_id||!result?.amazon_account_id||!Number.isSafeInteger(Number(result.amazon_credential_version)))throw Error();
    return finalRedirect(config,'connected');
  }catch{
    if(attemptId){try{await rpc(deps,'integration_amazon_oauth_fail',{p_attempt_id:attemptId,p_reason_code:phase});}catch{/* Never retry an ambiguous exchange or commit. */}}
    return finalRedirect(config,phase==='configuration_unavailable'?'unavailable':'failed');
  }
}
