import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
const code=ts.transpileModule(fs.readFileSync('supabase/functions/platform-mailer/index.ts','utf8').replace(/^import .*;\n/gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
async function attempt(token){
 let handler,mail=null;
 const hash=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode('bridge'))).toString('hex');
 vm.runInNewContext(code,{crypto:webcrypto,TextEncoder,Request,Response,console:{error(){}},adminClient:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{active:true,token_sha256:hash},error:null})})})})}),Deno:{env:{get:key=>key==='RESEND_API_KEY'?'configured-key':undefined},serve:fn=>handler=fn},fetch:async(url,options)=>{mail={body:JSON.parse(options.body),headers:options.headers};return new Response('{"id":"mail-id"}');}});
 const response=await handler(new Request('https://example.com',{method:'POST',headers:token?{'x-platform-token':token}:{},body:JSON.stringify({event:'website_inquiry',inquiryId:'11111111-1111-4111-8111-111111111111',name:'<Cliente>',email:'client@example.com',company:'Test',message:'Consulta de prueba',plan:'starter',to:'attacker@example.com'})}));
 return {status:response.status,mail};
}
test('contact mail uses authenticated central transport, fixed recipient, reply-to and idempotency',async()=>{const result=await attempt('bridge');assert.equal(result.status,200);assert.deepEqual(result.mail.body.to,['info@zenviacommerce.com']);assert.equal(result.mail.body.reply_to,'client@example.com');assert.equal(result.mail.headers['Idempotency-Key'],'website-inquiry-11111111-1111-4111-8111-111111111111');assert.match(result.mail.body.html,/&lt;Cliente&gt;/);});
test('contact mail cannot be sent without the private bridge token',async()=>{for(const token of ['', 'wrong']){const result=await attempt(token);assert.equal(result.status,401);assert.equal(result.mail,null);}});
