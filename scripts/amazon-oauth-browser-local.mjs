import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export function readLocalBrowserConfig(env){
 if(env.RUN_LOCAL_AUTH_VAULT_TESTS!=='1'||env.ALLOW_DISPOSABLE_LOCAL_DB!=='true')throw Error('explicit disposable-local opt-ins required');
 const database=new URL(env.LOCAL_DATABASE_URL||'');
 if(!['postgres:','postgresql:'].includes(database.protocol)||!['127.0.0.1','localhost','[::1]'].includes(database.hostname)||database.search||database.hash)throw Error('only disposable loopback PostgreSQL is permitted');
 const url=new URL(env.LOCAL_SUPABASE_URL||'');
 if(url.protocol!=='http:'||!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='54321'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('only the disposable loopback Supabase origin is permitted');
 const anonKey=env.LOCAL_SUPABASE_ANON_KEY,serviceKey=env.LOCAL_SUPABASE_SERVICE_ROLE_KEY;
 if(!anonKey?.trim()||!serviceKey?.trim())throw Error('local keys required');
 return {url:url.origin,anonKey,serviceKey};
}
export function checkGuards(){
 const good={ALLOW_DISPOSABLE_LOCAL_DB:'true',LOCAL_DATABASE_URL:'postgresql://fixture:synthetic@127.0.0.1:54322/postgres',RUN_LOCAL_AUTH_VAULT_TESTS:'1',LOCAL_SUPABASE_URL:'http://127.0.0.1:54321',LOCAL_SUPABASE_ANON_KEY:'synthetic-anon',LOCAL_SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'};
 assert.equal(readLocalBrowserConfig(good).url,good.LOCAL_SUPABASE_URL);
 for(const url of ['https://remote.supabase.co','http://localhost:54322','http://user@localhost:54321','http://127.0.0.1:54321/path','http://127.0.0.1:54321/?secret=value','http://127.0.0.2:54321'])assert.throws(()=>readLocalBrowserConfig({...good,LOCAL_SUPABASE_URL:url}));
 assert.throws(()=>readLocalBrowserConfig({...good,RUN_LOCAL_AUTH_VAULT_TESTS:'0'}));
 assert.throws(()=>readLocalBrowserConfig({...good,ALLOW_DISPOSABLE_LOCAL_DB:'false'}));
 assert.throws(()=>readLocalBrowserConfig({...good,LOCAL_DATABASE_URL:'postgresql://fixture:synthetic@remote.example/postgres'}));
 assert.throws(()=>readLocalBrowserConfig({...good,LOCAL_SUPABASE_SERVICE_ROLE_KEY:''}));
 console.log('Browser harness guard checks passed; Auth, Vault and browser were NOT exercised.');
}

export async function runLocalBrowserHarness(env=process.env){
 const config=readLocalBrowserConfig(env); // Must precede fixture/handler/browser imports and any I/O.
 const [{createClient},{chromium},{createLocalMfaFixture},{provisionAdmin},{handleAmazonOAuthStart,handleAmazonOAuthCallback},{createAmazonOAuthHumanRpc},https,fs,os,path,child,util,crypto]=await Promise.all([
  import('@supabase/supabase-js'),import('playwright'),import('./local-auth-mfa-fixture.mjs'),import('./local-oauth-provision.mjs'),
  import('../supabase/functions/_shared/amazon/oauth-flow.ts'),import('../supabase/functions/_shared/amazon/oauth-auth.ts'),
  import('node:https'),import('node:fs/promises'),import('node:os'),import('node:path'),import('node:child_process'),import('node:util'),import('node:crypto'),
 ]);
 // Production configuration intentionally permits only default HTTPS ports.
 const origin='https://127.0.0.1',callbackPath='/functions/v1/amazon-oauth-callback',startPath='/functions/v1/amazon-oauth-start';
 const cookieName='__Host-zenvia-amazon-oauth';
 const seller='TEST'+crypto.randomBytes(12).toString('hex').toUpperCase();
 const code='simulated-code-'+crypto.randomBytes(16).toString('hex');
 const refreshToken='simulated-refresh-'+crypto.randomBytes(32).toString('hex');
 const localFetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(url.origin!==config.url||url.username||url.password)throw Error('non-local Supabase request blocked');
  return fetch(input,{...init,redirect:'error'});
 };
 const admin=createClient(config.url,config.serviceKey,{global:{fetch:localFetch},auth:{persistSession:false,autoRefreshToken:false}});
 let fixture,browser,server,tempDir;let exchanges=0,consents=0,serverFailure=false,browserBlocked=0;
 try{
  // The fixture performs actual GoTrue password sign-in, TOTP enrollment/challenge/verify.
  fixture=await createLocalMfaFixture({...config,allowDisposableLocal:true,provisionAdmin:({userId,email})=>provisionAdmin({userId,email,admin})});
  assert.ok(fixture.session?.access_token,'fixture must return actual AAL2 session');
  tempDir=await fs.mkdtemp(path.join(os.tmpdir(),'amazon-oauth-browser-'));
  const keyPath=path.join(tempDir,'tls-key.pem'),certPath=path.join(tempDir,'tls-cert.pem');
  await util.promisify(child.execFile)('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyPath,'-out',certPath,'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{timeout:10000});
  const values={SUPABASE_URL:config.url,SUPABASE_ANON_KEY:config.anonKey,AMAZON_PUBLIC_OAUTH_ENABLED:'true',AMAZON_PUBLIC_APPLICATION_ID:'amzn1.sellerapps.app.local-browser-test',AMAZON_PUBLIC_OAUTH_REDIRECT_URI:origin+callbackPath,AMAZON_PUBLIC_OAUTH_UI_ORIGIN:origin,AMAZON_PUBLIC_OAUTH_MODE:'draft',AMAZON_OAUTH_STATE_SIGNING_KEY:crypto.randomBytes(32).toString('hex'),AMAZON_SPAPI_PUBLIC_V1_CLIENT_ID:'simulated-public-client',AMAZON_SPAPI_PUBLIC_V1_CLIENT_SECRET:'simulated-public-secret'};
  const envGet=name=>values[name];
  const scopedHumanRpc=createAmazonOAuthHumanRpc((url,key,options)=>createClient(url,key,{...options,global:{...options.global,fetch:localFetch}}),envGet);
  const deps={admin,humanRpc:scopedHumanRpc,envGet,now:Date.now,randomBytes:n=>new Uint8Array(crypto.randomBytes(n)),fetch:async(input,init)=>{
   assert.equal(String(input),'https://api.amazon.com/auth/o2/token','unexpected token exchange destination');
   assert.equal(init?.method,'POST','token exchange must POST');
   assert.equal(new Headers(init.headers).has('authorization'),false,'Supabase Bearer must not reach LWA');
   const body=new URLSearchParams(init.body);
   assert.equal(body.get('code'),code,'only the simulated code is accepted');
   assert.equal(body.get('client_id'),values.AMAZON_SPAPI_PUBLIC_V1_CLIENT_ID);
   assert.equal(body.get('client_secret'),values.AMAZON_SPAPI_PUBLIC_V1_CLIENT_SECRET);
   assert.equal(body.get('redirect_uri'),origin+callbackPath);
   exchanges++;assert.equal(exchanges,1,'the code must exchange exactly once');
   return Response.json({refresh_token:refreshToken}); // Never invoke the network for Amazon.
  }};
  server=https.createServer({key:await fs.readFile(keyPath),cert:await fs.readFile(certPath)},async(incoming,outgoing)=>{
   try{
    const url=new URL(incoming.url||'/',origin);
    if(url.pathname!==startPath&&url.pathname!==callbackPath){
     outgoing.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; connect-src 'self'; script-src 'unsafe-inline'; frame-ancestors 'none'"});outgoing.end('<!doctype html><title>Disposable local OAuth harness</title>');return;
    }
    const chunks=[];let length=0;
    for await(const chunk of incoming){length+=chunk.length;if(length>16384)throw Error('request body too large');chunks.push(chunk);}
    const headers=new Headers();for(const [name,value] of Object.entries(incoming.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(','):value);
    const body=Buffer.concat(chunks);
    const request=new Request(url,{method:incoming.method,headers,...(body.length?{body}: {})});
    const response=await(url.pathname===startPath?handleAmazonOAuthStart(request,deps):handleAmazonOAuthCallback(request,deps));
    outgoing.writeHead(response.status,Object.fromEntries(response.headers));outgoing.end(Buffer.from(await response.arrayBuffer()));
   }catch{serverFailure=true;outgoing.writeHead(500,{'content-type':'text/plain','cache-control':'no-store'});outgoing.end('Local harness failed.');}
  });
  await new Promise((resolveListen,reject)=>{server.once('error',reject);server.listen(443,'127.0.0.1',resolveListen)});
  browser=await chromium.launch({headless:true});
  const legitimate=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'});
  const separate=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'});
  let callbackUrl,attackerDenied=false,cookieVerified=false;
  const attacker=await separate.newPage();
  await separate.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await legitimate.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin===origin){await route.continue();return;}
   if(url.origin!=='https://sellercentral-europe.amazon.com'||url.pathname!=='/apps/authorize/consent'){browserBlocked++;await route.abort();return;}
   // Fulfill the exact Amazon navigation locally: no DNS/TLS/HTTP reaches Amazon.
   consents++;assert.equal(consents,1);assert.equal(url.searchParams.get('application_id'),values.AMAZON_PUBLIC_APPLICATION_ID);
   const state=url.searchParams.get('state');assert.ok(state);
   const cookies=await legitimate.cookies(origin),binding=cookies.find(item=>item.name===cookieName);
   assert.ok(binding,'legitimate context must receive host cookie before consent');
   assert.equal(binding.secure,true);assert.equal(binding.httpOnly,true);assert.equal(binding.sameSite,'Lax');assert.equal(binding.path,'/');
   assert.ok(binding.expires>Date.now()/1000&&binding.expires<=Date.now()/1000+601);cookieVerified=true;
   assert.equal((await separate.cookies(origin)).some(item=>item.name===cookieName),false,'separate browser has no binding cookie');
   callbackUrl=origin+callbackPath+'?'+new URLSearchParams({state,spapi_oauth_code:code,selling_partner_id:seller});
   // Test the valid state in a different browser before allowing the legitimate return.
   await attacker.goto(callbackUrl,{waitUntil:'domcontentloaded'});
   assert.equal(new URL(attacker.url()).searchParams.get('amazon_oauth'),'failed','same state in another browser must fail');
   assert.equal(exchanges,0,'missing browser binding must prevent any LWA exchange');attackerDenied=true;
   await route.fulfill({status:303,headers:{location:callbackUrl,'cache-control':'no-store','referrer-policy':'no-referrer'},body:''});
  });
  const page=await legitimate.newPage();await page.goto(origin,{waitUntil:'domcontentloaded'});
  const startResult=await page.evaluate(async({path,accessToken})=>{
   const response=await fetch(path,{method:'POST',headers:{authorization:'Bearer '+accessToken,'content-type':'application/json'},body:'{}'});
   if(response.status!==200)return {status:response.status};
   const data=await response.json();return {status:response.status,launchUrl:data.launchUrl};
  },{path:startPath,accessToken:fixture.session.access_token});
  assert.equal(startResult.status,200,'real MFA-backed start must reserve through actual SQL');
  const launch=new URL(startResult.launchUrl);assert.equal(launch.origin,origin);assert.equal(launch.pathname,startPath);
  await page.goto(launch.href,{waitUntil:'domcontentloaded'});
  assert.equal(new URL(page.url()).searchParams.get('amazon_oauth'),'connected','legitimate browser must complete');
  assert.equal(attackerDenied,true);assert.equal(cookieVerified,true);assert.equal(exchanges,1);assert.equal(consents,1);assert.equal(browserBlocked,0);assert.equal(serverFailure,false);
  assert.equal((await legitimate.cookies(origin)).some(item=>item.name===cookieName),false,'callback must expire binding cookie');
  // Assert the actual SQL/Vault-backed commit through the protected coherent reader.
  const {data:account,error:accountError}=await admin.from('integration_accounts').select('id,sp_api_app_key,owner_id').eq('owner_id',fixture.ownerId).eq('provider','amazon').eq('external_account_id',seller).single();
  assert.equal(accountError,null,'committed account must be readable by service');assert.equal(account.sp_api_app_key,'public_v1');
  const snapshot=await admin.rpc('integration_amazon_credential_snapshot',{p_owner_id:fixture.ownerId,p_integration_account_id:account.id});
  assert.equal(snapshot.error,null,'actual credential snapshot must resolve');const row=Array.isArray(snapshot.data)?snapshot.data[0]:snapshot.data;
  assert.equal(row.sp_api_app_key,'public_v1');assert.equal(row.secret_payload.refreshToken??row.secret_payload.refresh_token,refreshToken,'actual Vault must contain only simulated token');
  await page.goto(callbackUrl,{waitUntil:'domcontentloaded'});assert.equal(new URL(page.url()).searchParams.get('amazon_oauth'),'failed');assert.equal(exchanges,1,'replay must not exchange twice');
  return {realLocalAuth:true,realLocalVault:true,realHttpsCookie:true,separateBrowserDenied:true,simulatedAmazonOnly:true,exchanges};
 }finally{
  // Attempt every cleanup even if a prior teardown fails; never print fixture/key details.
  const failures=[];
  for(const cleanup of [
   async()=>{if(browser)await browser.close()},
   async()=>{if(server){server.closeAllConnections();await new Promise(resolveClose=>server.close(resolveClose))}},
   async()=>{if(fixture)await fixture.cleanup()},
   async()=>{if(tempDir)await fs.rm(tempDir,{recursive:true,force:true})},
  ])try{await cleanup()}catch{failures.push(true)}
  if(failures.length)throw Error('local harness cleanup failed');
 }
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 if(process.argv.includes('--check-guards'))checkGuards();
 else if(process.env.RUN_LOCAL_AUTH_VAULT_TESTS!=='1')console.log('PREPARED ONLY: real local Auth/Vault/HTTPS browser suite NOT RUN. Explicit disposable-local opt-in is required.');
 else try{const result=await runLocalBrowserHarness();console.log('Local OAuth browser assertions passed:',JSON.stringify(result));}
 catch{console.error('Local OAuth browser harness FAILED; sensitive details suppressed. No passing real-environment claim is available.');process.exitCode=1;}
}
