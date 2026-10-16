import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function protocol(){const exports={};const code=ts.transpileModule(readFileSync(new URL('../supabase/functions/_shared/amazon/confirmation-protocol.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,{exports});return exports.executeAmazonConfirmation;}
const detail={packageReferenceId:'1',trackingNumber:'OWN-TRACKING',carrierCode:'MRW',carrierName:'MRW',orderItems:[{orderItemId:'line',quantity:2}]};
function fixture(){
 let op=null,posts=0,reads=0,packages=[],postError=null,saveError=false;
 const intent={payload:{marketplaceId:'ES',packageDetail:detail}};
 const store={async begin(){if(op)return {...op,send:false,verify:op.state==='pending_verification'};op={state:'pending_verification',fence:1,payload:intent.payload,send:true,verify:false};return {...op}},async finish(_op,state){if(saveError&&state==='confirmed')throw new Error('DB unavailable');op={...op,state,send:false};return {...op}}};
 const effects={async read(){reads++;return packages},async post(){assert.equal(op.state,'pending_verification','uncertainty persisted before POST');posts++;if(postError)throw postError}};
 return {intent,store,effects,setPackages(value){packages=value},setPostError(value){postError=value},setSaveError(){saveError=true},get posts(){return posts},get reads(){return reads},get state(){return op?.state}};
}
for(const [name,error] of [['500',Object.assign(new Error('ambiguous'),{status:500})],['lost response',new Error('connection lost')],['timeout',new Error('TimeoutError')]])test(`${name}: one POST total and later exact GET repairs state`,async()=>{
 const run=protocol(),f=fixture();f.setPostError(error);
 assert.equal((await run(f.store,f.intent,f.effects)).state,'pending_verification');assert.equal(f.posts,1);
 f.setPackages([detail]);assert.equal((await run(f.store,f.intent,f.effects)).state,'confirmed');assert.equal(f.posts,1);
});
test('success followed by local save failure leaves durable pending and no later POST',async()=>{
 const run=protocol(),f=fixture();f.setSaveError();assert.equal((await run(f.store,f.intent,f.effects)).state,'pending_verification');assert.equal(f.state,'pending_verification');
 f.setPackages([detail]);await run(f.store,f.intent,f.effects);assert.equal(f.posts,1);
});
test('crash after begin before POST is conservative; next invocation only verifies',async()=>{
 const run=protocol(),f=fixture();await f.store.begin();await run(f.store,f.intent,f.effects);assert.equal(f.posts,0);assert.equal(f.state,'pending_verification');
});
test('empty reads do not authorize a POST after ambiguity',async()=>{const run=protocol(),f=fixture();f.setPostError(new Error('lost'));await run(f.store,f.intent,f.effects);for(let i=0;i<4;i++)await run(f.store,f.intent,f.effects);assert.equal(f.posts,1);});
test('a definitive 400 is rejected once and never retried',async()=>{const run=protocol(),f=fixture();f.setPostError(Object.assign(new Error('bad payload'),{status:400}));assert.equal((await run(f.store,f.intent,f.effects)).state,'rejected');await run(f.store,f.intent,f.effects);assert.equal(f.posts,1);});
test('exact match requires reference, carrier, item ids and quantities as well as tracking',async()=>{
 for(const changed of [{packageReferenceId:'2'},{carrierCode:'Other'},{orderItems:[{orderItemId:'line',quantity:1}]},{orderItems:undefined}]){
  const run=protocol(),f=fixture();await f.store.begin();f.setPackages([{...detail,...changed}]);const result=await run(f.store,f.intent,f.effects);assert.notEqual(result.state,'confirmed');assert.equal(f.posts,0);
 }
});
test('already confirmed returns without GET or POST',async()=>{const run=protocol(),f=fixture();f.setPackages([detail]);await run(f.store,f.intent,f.effects);const reads=f.reads;await run(f.store,f.intent,f.effects);assert.equal(f.reads,reads);assert.equal(f.posts,0);});
