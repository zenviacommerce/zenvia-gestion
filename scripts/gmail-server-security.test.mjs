import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
function helper(){
  const source=fs.existsSync('supabase/functions/_shared/gmailOAuth.ts')?fs.readFileSync('supabase/functions/_shared/gmailOAuth.ts','utf8'):'';
  return vm.runInNewContext(stripTypeScriptTypes(source.replaceAll('export ',''))+'\n({gmailAccessAllowed,validateGmailOrigin,gmailConnectionFromToken})',{Error,URL});
}
test('expense users can read Gmail accounts but cannot manage authorization',()=>{
  const {gmailAccessAllowed:allowed}=helper();
  const user={role:'user',permissions:['invoices']};
  assert.equal(allowed(user,'gmail_list'),true);
  assert.equal(allowed(user,'gmail_token'),true);
  assert.equal(allowed(user,'gmail_exchange'),false);
  assert.equal(allowed(user,'disconnect'),false);
  assert.equal(allowed({role:'user',permissions:['orders']},'gmail_token'),false);
});
test('OAuth exchange rejects missing CSRF header and foreign origins',()=>{
  const {validateGmailOrigin:validate}=helper();
  assert.throws(()=>validate('https://evil.test','XmlHttpRequest',['https://gestion.zenviacommerce.com']),/origen/i);
  assert.throws(()=>validate('https://gestion.zenviacommerce.com','',['https://gestion.zenviacommerce.com']),/solicitud/i);
  assert.equal(validate('https://gestion.zenviacommerce.com','XmlHttpRequest',['https://gestion.zenviacommerce.com']),'https://gestion.zenviacommerce.com');
});
test('token response exposes only a short-lived access token and validates identity',()=>{
  const {gmailConnectionFromToken:connection}=helper();
  const result=connection({access_token:'access',refresh_token:'private',expires_in:3600},'me@example.com',1000);
  assert.equal(result.email,'me@example.com');assert.equal(result.expiresAt,3601000);
  assert.equal(result.refresh_token,undefined);assert.equal(result.refreshToken,undefined);
  assert.throws(()=>connection({},'me@example.com',1000),/Google/);
});
