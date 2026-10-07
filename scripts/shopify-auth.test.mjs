import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {createHmac} from 'node:crypto';

function helper(overrides={}){
  const file='supabase/functions/_shared/shopifyAuth.ts';
  assert.ok(fs.existsSync(file),'Falta el adaptador de autorización Shopify');
  const source=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
  return vm.runInNewContext(stripTypeScriptTypes(source.replaceAll('export ',''))+'\n({shopifyDomain,shopifyError,verifyShopifyCallback,shopifyTokenRequest,resolveShopifyCredentials,shopifyAccountCredentials,shopifyLegacyCredentials,commitShopifyAuthorization,shopifyApplicationCredentials,shopifyStoredApplicationCredentials})',{URL,URLSearchParams,crypto,TextEncoder,Date,Error,fetch,setTimeout,AbortSignal,Deno:{env:{get:()=>''}},...overrides});
}
test('Shopify domain rejects arbitrary hosts, ports and paths before any request',()=>{
  const {shopifyDomain}=helper();
  assert.equal(shopifyDomain('https://MY-shop.myshopify.com/'),'my-shop.myshopify.com');
  for(const value of ['evil.com','shop.myshopify.com.evil.com','shop.myshopify.com/admin','shop.myshopify.com:443','user@shop.myshopify.com',''])assert.throws(()=>shopifyDomain(value));
});

function renewalFixture(){
  const row={id:'account',owner_id:'tenant',secret_id:'vault',enabled:true,status:'connected',config:{shopDomain:'my-shop.myshopify.com'},shopify_credential_version:1};
  let stored={shopDomain:'my-shop.myshopify.com',accessToken:'old',expiresAt:1,authMode:'oauth',clientId:'id',clientSecret:'secret',refreshToken:'refresh'};
  let lease=null,requests=0,onFetch=()=>{};
  const admin={from:()=>({select(){return this},eq(){return this},async maybeSingle(){return {data:{...row},error:null}}}),async rpc(name,args){
    if(name==='integration_read_secret')return {data:JSON.stringify(stored)};
    if(name==='integration_shopify_claim_refresh'){
      if(lease||!row.enabled)return {data:false};lease=args.p_lease;return {data:true};
    }
    if(name==='integration_shopify_release_refresh'){if(lease===args.p_lease)lease=null;return {data:null};}
    if(name==='integration_shopify_commit_refresh'){
      if(!row.enabled||lease!==args.p_lease||row.shopify_credential_version!==args.p_version)return {data:false};
      stored=JSON.parse(args.p_secret);row.shopify_credential_version++;lease=null;return {data:true};
    }
    throw new Error(name);
  }};
  const auth=helper({fetch:async()=>{requests++;onFetch();await new Promise(resolve=>setTimeout(resolve,25));return {ok:true,json:async()=>({access_token:'renewed',refresh_token:'rotated',expires_in:3600,scope:'read_orders'})};}});
  return {admin,row,auth,stored:()=>stored,requests:()=>requests,onFetch:fn=>onFetch=fn};
}
test('simultaneous sync and connection test share one refresh and retain rotated token',async()=>{
  const f=renewalFixture();
  const results=await Promise.all([f.auth.shopifyAccountCredentials(f.admin,f.row),f.auth.shopifyAccountCredentials(f.admin,f.row)]);
  assert.equal(f.requests(),1);assert.equal(results[0].accessToken,'renewed');assert.equal(results[1].accessToken,'renewed');assert.equal(f.stored().refreshToken,'rotated');
});
test('disconnect during renewal rejects stale persistence',async()=>{
  const f=renewalFixture();f.onFetch(()=>{f.row.enabled=false;f.row.status='disabled';f.row.shopify_credential_version++;});
  await assert.rejects(f.auth.shopifyAccountCredentials(f.admin,f.row),/cambió/);
  assert.equal(f.stored().accessToken,'old');
});
test('legacy replacement contains no former app, refresh or expiry fields',()=>{
  const {shopifyLegacyCredentials}=helper();
  const result=shopifyLegacyCredentials('my-shop.myshopify.com','manual');
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{shopDomain:'my-shop.myshopify.com',accessToken:'manual',authMode:'token'});
});

test('OAuth completion rejects a callback overtaken by disconnect or credential replacement',async()=>{
  const {commitShopifyAuthorization}=helper();
  const snapshot={id:'account',owner_id:'tenant',shopify_credential_version:3,config:{},display_name:'Shop'};
  for(const disabled of [true,false]){
    const current={...snapshot,enabled:!disabled,shopify_credential_version:4};
    let writes=0;
    const admin={rpc:async(name,args)=>{
      assert.equal(name,'integration_shopify_complete_oauth');
      assert.equal(args.p_owner_id,'tenant');
      const valid=current.enabled&&args.p_version===current.shopify_credential_version;
      if(valid)writes++;
      return {data:valid};
    }};
    await assert.rejects(commitShopifyAuthorization(admin,snapshot,{syncOrders:true},{shopDomain:'my-shop.myshopify.com',accessToken:'new'}),/cambió/);
    assert.equal(writes,0);
  }
});
test('callback validates HMAC and rejects tampering and repeated parameters',async()=>{
  const {verifyShopifyCallback}=helper();
  const q=new URLSearchParams({code:'test',shop:'my-shop.myshopify.com',state:'nonce',timestamp:'123'});
  const message=[...q.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('&');
  q.set('hmac',createHmac('sha256','secret').update(message).digest('hex'));
  assert.equal(await verifyShopifyCallback(q,'secret'),true);
  q.set('code','tampered');assert.equal(await verifyShopifyCallback(q,'secret'),false);
  q.append('shop','other.myshopify.com');assert.equal(await verifyShopifyCallback(q,'secret'),false);
});
test('structured backend errors retain their real message',()=>{
  const {shopifyError}=helper();
  assert.equal(shopifyError({message:'duplicate key',code:'23505'}),'duplicate key');
  assert.equal(shopifyError({error:{message:'Access denied'}}),'Access denied');
  assert.notEqual(shopifyError({code:'unknown'}),'[object Object]');
});
test('legacy tokens do not require app credentials or renewal',async()=>{
  const {resolveShopifyCredentials}=helper();
  const result=await resolveShopifyCredentials({shopDomain:'my-shop.myshopify.com',accessToken:'legacy'},{},async()=>{throw new Error('must not request a token')});
  assert.equal(result.accessToken,'legacy');
});
test('own app renews expired tokens and persists credentials before use',async()=>{
  const {resolveShopifyCredentials}=helper();let saved;
  const result=await resolveShopifyCredentials({shopDomain:'my-shop.myshopify.com',accessToken:'old',expiresAt:1,authMode:'client_credentials',clientId:'id',clientSecret:'secret'},{},async(domain,body)=>{
    assert.equal(domain,'my-shop.myshopify.com');assert.equal(body.get('grant_type'),'client_credentials');
    return {access_token:'new',expires_in:86400,scope:'read_orders'};
  },async value=>{saved=value;});
  assert.equal(result.accessToken,'new');assert.equal(saved.accessToken,'new');assert.ok(saved.expiresAt>Date.now());
});
test('OAuth renews using refresh token and rejects missing order permissions',async()=>{
  const {resolveShopifyCredentials}=helper();
  const stored={shopDomain:'my-shop.myshopify.com',accessToken:'old',expiresAt:1,authMode:'oauth',clientId:'id',clientSecret:'secret',refreshToken:'refresh'};
  const result=await resolveShopifyCredentials(stored,{},async(domain,body)=>{
    assert.equal(body.get('grant_type'),'refresh_token');assert.equal(body.get('refresh_token'),'refresh');
    return {access_token:'renewed',refresh_token:'rotated',expires_in:3600,scope:'read_orders'};
  },async value=>assert.equal(value.refreshToken,'rotated'));
  assert.equal(result.accessToken,'renewed');
  await assert.rejects(resolveShopifyCredentials({...stored,authMode:'client_credentials'}, {},async()=>({access_token:'bad',expires_in:3600,scope:'read_products'})),/read_orders/);
});


test('central app credentials are configured once and tenant lookup stays scoped',async()=>{
  const {shopifyApplicationCredentials,shopifyStoredApplicationCredentials}=helper();
  assert.equal(shopifyApplicationCredentials({},{}).ready,false);
  const configured={clientId:'id',clientSecret:'secret'};
  assert.equal(shopifyApplicationCredentials({},configured).ready,true);
  assert.equal(shopifyApplicationCredentials({clientId:'global',clientSecret:'global-secret'},configured).clientId,'global');
  const result=await shopifyStoredApplicationCredentials({rpc:async(name,args)=>{
    assert.equal(name,'integration_read_named_secret');assert.equal(args.p_name,'shopify-app:tenant-a');
    return {data:JSON.stringify(configured)};
  }},'tenant-a');
  assert.equal(result.clientId,'id');assert.equal(result.ready,true);
});

test('order sync works with read_orders without requiring the customer directory scope',()=>{
  const source=fs.readFileSync('supabase/functions/shopify-orders/index.ts','utf8');
  const query=source.match(/const ORDER_QUERY=`([\s\S]*?)`;/)[1];
  assert.doesNotMatch(query,/\bcustomer\s*\{/,'Order sync must not request read_customers-only customer data');
  assert.match(query,/shippingAddress\s*\{[^}]*name[^}]*phone/);
  assert.match(query,/\bemail\s+phone\b/);
});
