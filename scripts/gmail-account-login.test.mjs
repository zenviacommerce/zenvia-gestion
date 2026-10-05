import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

test('Gmail authorization always offers account selection with optional consent',async()=>{
  const source=fs.readFileSync('src/services/gmail.ts','utf8');
  const match=source.match(/export async function connectGmail[\s\S]*?\n}\n/);
  assert.ok(match);
  const code=stripTypeScriptTypes(match[0].replace('export ',''));
  for(const consent of [true,false]){
    let config,request,saved;
    const context={loadGoogleIdentityServices:async()=>{},getClientId:()=> 'shared-client',GMAIL_SCOPE:'gmail.readonly',gmailFetch:async()=>({emailAddress:'other@example.com'}),saveConnection:v=>saved=v,window:{google:{accounts:{oauth2:{initTokenClient:c=>{config=c;return {requestAccessToken:r=>{request=r;void c.callback({access_token:'test-token',expires_in:3600})}}}}}}}};
    const connect=vm.runInNewContext(code+'\nconnectGmail',context);
    const result=await connect(consent);
    assert.ok(request.prompt.split(' ').includes('select_account'));
    assert.equal(request.prompt.includes('consent'),consent);
    assert.equal(config.client_id,'shared-client');
    assert.equal(result.email,'other@example.com');
    assert.equal(saved.email,'other@example.com');
  }
});

test('closing Google popup is distinct from an OAuth configuration problem',()=>{
  const source=fs.readFileSync('src/pages/Gmail.tsx','utf8');
  const match=source.match(/function gmailConnectionError[\s\S]*?\n}\n/);
  const code=stripTypeScriptTypes(match[0]);
  const error=vm.runInNewContext(code+'\ngmailConnectionError',{Error,window:{location:{origin:'https://example.com'}}});
  assert.match(error(new Error('popup_closed')),/cerrado|cerró/i);
  assert.doesNotMatch(error(new Error('origin_mismatch')),/Google Cloud|Vercel|Client ID/);
});

test('requesting an unconnected Gmail account never falls back to another mailbox',()=>{
  const source=fs.readFileSync('src/services/gmail.ts','utf8');
  const code=stripTypeScriptTypes(source.slice(source.indexOf('function connectionKey'),source.indexOf('const sleep =')).replaceAll('export ',''));
  const account={email:'first@example.com',accessToken:'token',expiresAt:Date.now()+3600000};
  const values=new Map([['accounts',JSON.stringify({'first@example.com':account})]]);
  const context={TOKEN_ACCOUNTS_STORAGE_KEY:'accounts',TOKEN_ACTIVE_STORAGE_KEY:'active',TOKEN_STORAGE_KEY:'legacy',TOKEN_REFRESH_BUFFER_MS:300000,sessionStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}};
  const get=vm.runInNewContext(code+'\ngetCachedGmailConnection',context);
  assert.equal(get('second@example.com'),null);
  assert.equal(get('first@example.com').email,'first@example.com');
});
