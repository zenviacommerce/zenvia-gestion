import test from 'node:test';
import assert from 'node:assert/strict';
import {localAuthOrigin,totpCode} from './local-auth-mfa-fixture.mjs';
test('disposable Auth fixture refuses production, credentials, HTTPS or unknown ports',()=>{
 for(const url of ['https://real.supabase.co','http://example.com:54321','http://localhost:3000','https://localhost:54321','http://user:password@localhost:54321'])assert.throws(()=>localAuthOrigin(url,true));
 assert.throws(()=>localAuthOrigin('http://localhost:54321',false));
 assert.equal(localAuthOrigin('http://127.0.0.1:54321',true),'http://127.0.0.1:54321');
});
test('local real-Auth TOTP generator matches RFC6238 known six-digit suffixes',()=>{
 const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
 assert.equal(totpCode(secret,59000),'287082');
 assert.equal(totpCode(secret,1111111109000),'081804');
 assert.equal(totpCode(secret,1234567890000),'005924');
 assert.throws(()=>totpCode('not-a-base32-secret'));
});
