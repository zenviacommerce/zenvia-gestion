import test from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import {readFile} from 'node:fs/promises';
const url=s=>'data:text/javascript;base64,'+Buffer.from(ts.transpile(s,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext})).toString('base64');
test('real signed snapshot handler preserves PostgreSQL microseconds across incremental pages',async()=>{
 const protocolURL=url(await readFile('supabase/functions/_shared/platform-shadow-protocol.ts','utf8'));
 const protocol=await import(protocolURL);let handler,seen,repairCalls=0;
 const priorDeno=globalThis.Deno;
 globalThis.__shadowCursorClient=()=>({rpc:async(name,args)=>{let data;if(name==='platform_shadow_source_credentials')data={enabled:true,key_id:'source-v1',hmac_key:'test-only-key',worker_token:'worker',source_project_ref:'source',generation:'generation'};
 else if(name==='platform_shadow_source_nonce')data=true;else if(name==='platform_shadow_source_bootstrap'){repairCalls++;data=null;}else if(name==='platform_shadow_source_snapshot'){seen=args;data={events:[],workspaces:[],has_more:false,metrics_has_more:false};}else throw Error(name);return {data,error:null};}});
 globalThis.Deno={env:{get:()=>''},serve:fn=>{handler=fn;}};
 try{
 let code=await readFile('supabase/functions/platform-shadow-source/index.ts','utf8');code=code.replace("import {createClient} from 'npm:@supabase/supabase-js@2.105.0';",'const createClient=globalThis.__shadowCursorClient;').replace("'../_shared/platform-shadow-protocol.ts'",JSON.stringify(protocolURL));await import(url(code));
 const requested='2026-10-21T08:01:00.123456+00:00';
 const invoke=async full=>{const raw=JSON.stringify({action:'snapshot',source_project_ref:'source',generation:'generation',upper:requested,full_repair:full});return handler(new Request('https://source.invalid',{method:'POST',headers:await protocol.signShadow(raw,'source-v1','test-only-key'),body:raw}));};
 const response=await invoke(false);assert.equal(response.status,200);assert.equal(seen.p_upper,requested);assert.equal((await response.json()).upper,requested);assert.equal(repairCalls,0);
 const repaired=await invoke(true);assert.equal(repaired.status,200);assert.equal(repairCalls,1);assert.ok(Date.parse((await repaired.json()).upper)>Date.parse(requested));
 }finally{globalThis.Deno=priorDeno;delete globalThis.__shadowCursorClient;}
});
