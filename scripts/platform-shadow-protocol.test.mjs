import test from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import {readFile} from 'node:fs/promises';
const load=async()=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(await readFile('supabase/functions/_shared/platform-shadow-protocol.ts','utf8'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext})).toString('base64'));
test('HMAC binds body, key, timestamp and nonce; stale/replayed signatures are rejected by validation plus nonce store',async()=>{
 const {signShadow,verifyShadow}=await load();const raw='{"event_id":"test"}',secret='a-secret-with-256-bits-of-entropy-in-production';const now=Date.now();
 const headers=await signShadow(raw,'source-v1',secret,now);const request=new Request('https://example.invalid',{method:'POST',headers,body:raw});
 assert.equal(await verifyShadow(request,raw,'source-v1',secret,now),headers['x-shadow-nonce']);
 assert.equal(await verifyShadow(request,raw+' ','source-v1',secret,now),null);
 assert.equal(await verifyShadow(request,raw,'other',secret,now),null);
 assert.equal(await verifyShadow(request,raw,'source-v1','wrong',now),null);
 assert.equal(await verifyShadow(request,raw,'source-v1',secret,now+300001),null);
 assert.equal(await verifyShadow(request,'x'.repeat(262145),'source-v1',secret,now),null);
});
