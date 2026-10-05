import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

function service(context={}) {
  const source=fs.existsSync('src/services/gmailAccounts.ts')?fs.readFileSync('src/services/gmailAccounts.ts','utf8'):'';
  const code=stripTypeScriptTypes(source.replace(/^import[\s\S]*?;\n/gm,'').replaceAll('export ',''));
  return vm.runInNewContext(code+'\n({selectDefaultGmailAccount,ensureRegisteredGmailConnection})',{Error,...context});
}
const first={id:'a',provider:'gmail',externalAccountId:'first@example.com',enabled:true,status:'connected',isDefault:false,credentialSource:'session',config:{}};
const second={...first,id:'b',externalAccountId:'second@example.com',isDefault:true};

test('importer uses the registered default and excludes disabled mailboxes',()=>{
  const {selectDefaultGmailAccount:choose}=service();
  assert.equal(choose([first,second]).id,'b');
  assert.equal(choose([first,{...second,enabled:false}]).id,'a');
  assert.equal(choose([{...first,status:'disabled'}]),null);
  assert.equal(choose([{...first,id:'old',externalAccountId:'legacy',isDefault:true},second]).id,'b');
});

test('renewing a saved mailbox rejects a different Google account',async()=>{
  const {ensureRegisteredGmailConnection:ensure}=service({getCachedGmailConnection:()=>null,connectGmail:async()=>({email:'other@example.com',accessToken:'other',expiresAt:Date.now()+3600000})});
  await assert.rejects(ensure(first),/first@example.com/);
});

test('persisted authorization renews through server without opening Google',async()=>{
  const {ensureRegisteredGmailConnection:ensure}=service({getCachedGmailConnection:()=>null,supabase:{functions:{invoke:async(name,{body})=>{
    assert.equal(name,'integration-accounts');assert.equal(body.action,'gmail_token');assert.equal(body.id,'b');
    return {data:{connection:{email:'second@example.com',accessToken:'renewed',expiresAt:Date.now()+3600000}},error:null};
  }}},rememberGmailConnection:()=>{},connectGmail:()=>{throw new Error('must not open Google');}});
  const result=await ensure({...second,credentialSource:'vault'});
  assert.equal(result.email,'second@example.com');assert.equal(result.accessToken,'renewed');
});
