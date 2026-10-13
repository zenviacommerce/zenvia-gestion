import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
import {validateInquiry} from '../supabase/functions/website-contact/validation.ts';
const code=ts.transpileModule(fs.readFileSync('supabase/functions/website-contact/index.ts','utf8').replace(/^import .*;\n/gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
async function attempt({configured=true,sent=false,mailStatus=200}={}){
 let handler,calls=0,updates=0,payload;
 const original={name:'Cliente original',email:'original@example.com',company:'Empresa',message:'Consulta original guardada',plan_key:'pro',notification_sent:sent};
 const admin={rpc:async()=>({data:{id:'saved-id',duplicate:true},error:null}),from:()=>({select:()=>({eq:()=>({single:async()=>({data:original,error:null})})}),update:()=>({eq:async()=>{updates++;return {error:null};}})})};
 vm.runInNewContext(code,{sendCentralWebsiteInquiry:async(admin,input)=>{calls++;payload=input;if(!configured||mailStatus!==200)throw new Error('Mailer failed');},createClient:()=>admin,validateInquiry,crypto:webcrypto,Request,Response,AbortSignal,TextEncoder,console:{info(){},error(){}},Deno:{env:{get:key=>key==='RESEND_API_KEY'?(configured?'key':undefined):key==='AUTH_EMAIL_FROM'?'Verified <verified@example.com>':'placeholder'},serve:fn=>handler=fn},fetch:async(url,options)=>{calls++;payload=JSON.parse(options.body);return new Response('{}',{status:mailStatus});}});
 const response=await handler(new Request('https://example.com',{method:'POST',headers:{origin:'https://gestion.zenviacommerce.com'},body:JSON.stringify({requestId:'11111111-1111-4111-8111-111111111111',name:'Changed',email:'changed@example.com',company:'',plan:'',message:'Changed retry message',privacyAccepted:true})}));
 return {status:response.status,body:await response.json(),calls,updates,payload};
}
test('missing mail configuration preserves inquiry but never claims success',async()=>{const result=await attempt({configured:false});assert.equal(result.status,503);assert.equal(result.body.reference,'saved-id');assert.equal(result.calls,1);});
test('retry delivers an unsent saved inquiry using original data and verified sender',async()=>{const result=await attempt();assert.equal(result.status,200);assert.equal(result.calls,1);assert.equal(result.updates,1);assert.equal(result.payload.email,'original@example.com');assert.equal(result.payload.message,'Consulta original guardada');});
test('already sent inquiry is acknowledged without a second email',async()=>{const result=await attempt({sent:true});assert.equal(result.status,200);assert.equal(result.calls,0);});
test('mail provider rejection cannot set sent status or report success',async()=>{const result=await attempt({mailStatus:403});assert.equal(result.status,503);assert.equal(result.updates,0);});
