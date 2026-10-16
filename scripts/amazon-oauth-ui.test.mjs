import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { Window } from 'happy-dom';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

function load(file,mocks={}){
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const exports={};vm.runInNewContext(code,{exports,require:name=>{if(name in mocks)return mocks[name];if(name==='react')return React;if(name==='react/jsx-runtime')return jsx;throw Error(name)},URL,URLSearchParams,AbortController,setTimeout,clearTimeout,window:globalThis.window});return exports;
}
import * as jsx from 'react/jsx-runtime';
const base='https://tenant.supabase.co';
const ticket=base+'/functions/v1/amazon-oauth-start?ticket=opaque&state=signed';
const service=()=>load('src/services/amazonOAuth.ts',{'./supabase':{getActiveTenant:()=>({supabase_url:base}),supabase:{functions:{invoke:async()=>({data:{launchUrl:ticket}})}}}});

test('launch URL accepts only the tenant backend ticket endpoint',()=>{
 const {validateAmazonLaunchUrl}=service();assert.equal(validateAmazonLaunchUrl(ticket,base),ticket);
 for(const bad of ['https://sellercentral-europe.amazon.com/apps/authorize/consent',ticket.replace('tenant.','evil.'),ticket+'&code=secret',ticket+'#fragment',ticket.replace('https://','https://user@'),ticket.replace('/amazon-oauth-start','/other'),ticket+'&ticket=second'])assert.throws(()=>validateAmazonLaunchUrl(bad,base),/No se pudo/);
});
test('first head bootstrap strips login query before module initialization and preserves only continuation in memory',()=>{
 const html=fs.readFileSync('index.html','utf8');const script=html.match(/<script id="amazon-oauth-bootstrap">([\s\S]*?)<\/script>/)?.[1];assert.ok(script,'early bootstrap exists');
 const w=new Window({url:'https://app.example/amazon/oauth/login?amazon_callback_uri='+encodeURIComponent('https://sellercentral-europe.amazon.com/apps/authorize/confirm/app')+'&amazon_state=state-canary&selling_partner_id=SELLER&workspace_id=evil&beta=1#secret'});
 vm.runInNewContext(script,{window:w,URL,URLSearchParams});assert.equal(w.location.search,'');assert.equal(w.location.hash,'');assert.equal(w.localStorage.length,0);assert.equal(w.sessionStorage.length,0);
 assert.deepEqual(JSON.parse(JSON.stringify(w.__amazonOAuthEntry)),{login:true,continuation:{amazonCallbackUri:'https://sellercentral-europe.amazon.com/apps/authorize/confirm/app',amazonState:'state-canary',sellingPartnerId:'SELLER'}});
 assert.ok(html.indexOf('amazon-oauth-bootstrap')<html.indexOf('src="/src/main.tsx"'));w.happyDOM.abort();
});
test('bootstrap rejects duplicated, oversized and malformed login continuation',()=>{
 const script=fs.readFileSync('index.html','utf8').match(/<script id="amazon-oauth-bootstrap">([\s\S]*?)<\/script>/)?.[1];assert.ok(script);
 for(const query of ['amazon_state=x&amazon_state=y','amazon_state='+ 'x'.repeat(9000),'amazon_callback_uri=https://evil.example&amazon_state=x&selling_partner_id=A']){
  const w=new Window({url:'https://app.example/amazon/oauth/login?'+query});vm.runInNewContext(script,{window:w,URL,URLSearchParams});assert.equal(w.location.search,'');assert.equal(w.__amazonOAuthEntry.continuation,null);w.happyDOM.abort();
 }
});
test('capability false, failure and timeout hide OAuth while manual action remains',async()=>{
 const w=new Window();Object.assign(globalThis,{window:w,document:w.document,IS_REACT_ACT_ENVIRONMENT:true});
 try{
  for(const capability of [async()=>({enabled:false}),async()=>{throw Error('secret')},async()=>({enabled:true})]){
   const {AmazonOAuthButton}=load('src/components/amazon/AmazonOAuthLaunch.tsx',{'../../services/amazonOAuth':{loadAmazonOAuthCapability:capability,beginAmazonAuthorization:async()=>ticket}});
   const host=w.document.createElement('div');w.document.body.append(host);const root=createRoot(host);
   await act(async()=>{root.render(React.createElement('div',null,React.createElement('button',null,'Conectar Amazon'),React.createElement(AmazonOAuthButton,{navigate:()=>{}})));});
   assert.ok(host.textContent.includes('Conectar Amazon'));assert.equal(host.textContent.includes('Conectar con Amazon'),(await capability().catch(()=>({enabled:false}))).enabled);
   await act(async()=>root.unmount());host.remove();
  }
 }finally{w.happyDOM.abort();}
});
test('enabled button performs one top-level launch despite double click, and renders only safe error',async()=>{
 const w=new Window();Object.assign(globalThis,{window:w,document:w.document,IS_REACT_ACT_ENVIRONMENT:true});let requests=0;const navigations=[];
 const {AmazonOAuthButton}=load('src/components/amazon/AmazonOAuthLaunch.tsx',{'../../services/amazonOAuth':{loadAmazonOAuthCapability:async()=>({enabled:true}),beginAmazonAuthorization:async()=>{requests++;return ticket}}});
 const host=w.document.createElement('div');w.document.body.append(host);const root=createRoot(host);await act(async()=>root.render(React.createElement(AmazonOAuthButton,{navigate:url=>navigations.push(url)})));
 await act(async()=>{host.querySelector('button').click();host.querySelector('button').click();});assert.equal(requests,1);assert.deepEqual(navigations,[ticket]);await act(async()=>root.unmount());w.happyDOM.abort();
});

test('capability authenticates via functions client and fails closed on error, malformed data and timeout',async()=>{
 for(const outcome of [{data:{enabled:false}},{data:{enabled:'true'}},{error:Error('secret')},{data:{enabled:true}}]){
  const seen=[];const mod=load('src/services/amazonOAuth.ts',{'./supabase':{getActiveTenant:()=>({supabase_url:base}),supabase:{functions:{invoke:async(...args)=>{seen.push(args);return outcome}}}}});
  assert.equal((await mod.loadAmazonOAuthCapability()).enabled,outcome.data?.enabled===true&&!outcome.error);assert.equal(seen[0][0],'integration-accounts');assert.equal(seen[0][1].body.action,'amazon_oauth_capability');assert.ok(seen[0][1].signal);
 }
});
test('result bootstrap only accepts fixed result codes and never renders arbitrary error details',()=>{
 const script=fs.readFileSync('index.html','utf8').match(/<script id="amazon-oauth-bootstrap">([\s\S]*?)<\/script>/)[1];
 for(const result of ['connected','failed','unavailable','secret-token','connected&amazon_oauth=failed']){
  const w=new Window({url:'https://app.example/?page=settings&section=integrations&amazon_oauth='+result+'&error=secret-code#state'});vm.runInNewContext(script,{window:w,URL,URLSearchParams});assert.equal(w.location.search,'');assert.equal(w.location.hash,'');
  assert.equal(w.__amazonOAuthEntry.result,['connected','failed','unavailable'].includes(result)?result:undefined);w.happyDOM.abort();
 }
});
test('login continuation asks for Zenvia session and does not derive tenant from Amazon query',()=>{
 const app=fs.readFileSync('src/App.tsx','utf8');assert.ok(app.indexOf('if(!session) return')<app.indexOf('if(amazonLogin)return'));assert.ok(app.indexOf('if(!access||!access.active')<app.indexOf('if(amazonLogin)return'));
 const w=new Window({url:'https://app.example/amazon/oauth/login'});globalThis.window=w;
 const entry={amazonCallbackUri:'https://sellercentral-europe.amazon.com/apps/authorize/confirm/app',amazonState:'state',sellingPartnerId:'SELLER'};w.__amazonOAuthEntry={login:true,continuation:entry};
 const mod=load('src/services/amazonOAuthLaunch.ts');assert.deepEqual(mod.readAmazonOAuthLaunch(w.location),entry);assert.equal(mod.readAmazonOAuthLaunch({pathname:'/'}),null);mod.clearAmazonOAuthLaunch();assert.equal(w.__amazonOAuthEntry.continuation,null);w.happyDOM.abort();
});
test('begin uses start POST without exchanging code or altering session, and rejects a switched tenant',async()=>{
 let active=base;const seen=[];const mod=load('src/services/amazonOAuth.ts',{'./supabase':{getActiveTenant:()=>({supabase_url:active}),supabase:{functions:{invoke:async(...args)=>{seen.push(args);active='https://other.supabase.co';return {data:{launchUrl:ticket}}}}}}});
 await assert.rejects(mod.beginAmazonAuthorization({continuation:{amazonCallbackUri:'uri',amazonState:'state',sellingPartnerId:'SELLER'}}),/No se pudo/);assert.equal(seen.length,1);assert.equal(seen[0][0],'amazon-oauth-start');assert.equal(seen[0][1].body.continuation.sellingPartnerId,'SELLER');
});
test('function gateway exceptions are restricted to the two OAuth endpoints',()=>{
 const config=fs.readFileSync('supabase/config.toml','utf8');for(const name of ['amazon-oauth-start','amazon-oauth-callback'])assert.match(config,new RegExp('\\[functions\\.'+name+'\\]\\s*verify_jwt = false'));
 const exceptions=[...config.matchAll(/\[functions\.([^\]]+)\]\s*verify_jwt = false/g)].map(match=>match[1]).sort();assert.deepEqual(exceptions,['amazon-oauth-callback','amazon-oauth-start']);
});

test('capability timeout is fail closed without touching account or session APIs',async()=>{
 let aborted=false;const mod=load('src/services/amazonOAuth.ts',{'./supabase':{supabase:{functions:{invoke:(_name,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('timeout canary'))}))}}}});
 assert.equal((await mod.loadAmazonOAuthCapability()).enabled,false);assert.equal(aborted,true);
});
test('launch failure exposes a generic message without backend canaries',async()=>{
 const w=new Window();Object.assign(globalThis,{window:w,document:w.document,IS_REACT_ACT_ENVIRONMENT:true});
 const {AmazonOAuthButton}=load('src/components/amazon/AmazonOAuthLaunch.tsx',{'../../services/amazonOAuth':{loadAmazonOAuthCapability:async()=>({enabled:true}),beginAmazonAuthorization:async()=>{throw Error('refresh-token-secret-canary')}}});
 const host=w.document.createElement('div');w.document.body.append(host);const root=createRoot(host);await act(async()=>root.render(React.createElement(AmazonOAuthButton)));
 await act(async()=>host.querySelector('button').click());assert.ok(host.querySelector('[role="alert"]'));assert.ok(!host.textContent.includes('canary'));assert.equal(host.querySelector('button').disabled,false);await act(async()=>root.unmount());w.happyDOM.abort();
});
