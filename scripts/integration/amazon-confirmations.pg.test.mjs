import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';
import pg from 'pg';
const url=process.env.PG_TEST_URL;
if(!url||new URL(url).pathname!=='/confirmations_test'||!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw new Error('PG_TEST_URL must name the disposable confirmations_test database');
const pool=new pg.Pool({connectionString:url,max:4});
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),other=id(2),order=id(3),account=id(4),integration=id(5),holder=id(6);
const payload={marketplaceId:'ES',packageDetail:{packageReferenceId:'1',trackingNumber:'REAL-FIXTURE-ONLY',carrierCode:'MRW',carrierName:'MRW',shipDate:'2026-10-16T00:00:00Z',orderItems:[{orderItemId:'item',quantity:1}]}};
async function begin(client=pool,patch={}){const args={p_order_id:order,p_owner_id:owner,p_account_id:account,p_marketplace_id:'ES',p_payload:payload,p_holder:holder,...patch};return (await client.query('select amazon_confirmation_begin($1,$2,$3,$4,$5,$6) as result',Object.values(args))).rows[0].result;}
async function finish(op,state='confirmed',client=pool,patch={}){const args={p_order_id:order,p_owner_id:owner,p_holder:holder,p_fence:op.fence,p_state:state,p_message:null,p_http_status:200,...patch};return (await client.query('select amazon_confirmation_finish($1,$2,$3,$4,$5,$6,$7) as result',Object.values(args))).rows[0].result;}
before(async()=>{
 await pool.query('drop schema public cascade; create schema public');
 await pool.query(await readFile(new URL('./confirmation-fixture.sql',import.meta.url),'utf8'));
 await pool.query(await readFile(new URL('./confirmation-original-claims.sql',import.meta.url),'utf8'));
 try{await pool.query(await readFile(new URL('../../supabase/migrations/20261016063000_amazon_confirmation_ledger.sql',import.meta.url),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
});
after(()=>pool.end());
beforeEach(async()=>{
 await pool.query('truncate fulfillment_orders,amazon_accounts,integration_accounts,amazon_orders,amazon_order_items,order_cancellation_operations cascade');
 await pool.query('insert into integration_accounts(id,owner_id,linked_resource_id,secret_id) values($1,$2,$3,$4)',[integration,owner,account,id(9)]);
 await pool.query('insert into amazon_accounts(id,owner_id,integration_account_id) values($1,$2,$3)',[account,owner,integration]);
 await pool.query("insert into fulfillment_orders(id,owner_id,order_id,source_integration_account_id,tracking_number,carrier_code,label_created_at) values($1,$2,'123-1234567-1234567',$3,'REAL-FIXTURE-ONLY','MRW','2026-10-16T00:00:00Z')",[order,owner,integration]);
 await pool.query("insert into amazon_order_items values($1,$2,'123-1234567-1234567','ES','item',1)",[owner,account]);
 await pool.query("insert into amazon_orders values($1,$2,'123-1234567-1234567','ES','MFN')",[owner,account]);
});
test('two real connections serialize submission; pending is committed before effects',async()=>{
 const a=await pool.connect(),b=await pool.connect();
 try{
  await a.query('begin');const first=await begin(a);assert.equal(first.send,true);
  const blocked=begin(b,{p_holder:id(7)});await a.query('commit');const second=await blocked;
  assert.equal(second.send,false);assert.equal(second.state,'pending_verification');
  assert.equal((await pool.query('select state from amazon_confirmation_operations')).rows[0].state,'pending_verification');
 }finally{await a.query('rollback');a.release();b.release();}
});
test('expired lease grants verification only and fences stale finalization',async()=>{
 const first=await begin();await pool.query("update amazon_confirmation_operations set lease_until=now()-interval '1 second'");
 const next=await begin(pool,{p_holder:id(7)});assert.equal(next.send,false);assert.equal(next.verify,true);assert.ok(next.fence>first.fence);
 await assert.rejects(finish(first),/lease|holder|fence/i);
 await finish(next,'confirmed',pool,{p_holder:id(7)});
 assert.ok((await pool.query('select amazon_tracking_synced_at from fulfillment_orders')).rows[0].amazon_tracking_synced_at);
});
test('local success write failure rolls back finalization and leaves pending durable',async()=>{
 const op=await begin();await pool.query("create function fail_success() returns trigger language plpgsql as $$ begin if new.amazon_tracking_synced_at is not null then raise exception 'injected save failure'; end if; return new; end $$; create trigger injected before update on fulfillment_orders for each row execute function fail_success()");
 try{await assert.rejects(finish(op),/injected save failure/);assert.equal((await pool.query('select state from amazon_confirmation_operations')).rows[0].state,'pending_verification');}finally{await pool.query('drop trigger injected on fulfillment_orders;drop function fail_success()');}
});
test('changed tracking and force cannot create a competing pending payload',async()=>{
 await begin();await assert.rejects(begin(pool,{p_payload:{...payload,packageDetail:{...payload.packageDetail,trackingNumber:'DIFFERENT'}}}),/409|pendiente|payload/i);
 assert.equal((await pool.query('select count(*)::int as n from amazon_confirmation_operations')).rows[0].n,1);
});
test('confirmed same intent returns confirmed without further submission',async()=>{const op=await begin();await finish(op);const next=await begin();assert.equal(next.send,false);assert.equal(next.state,'confirmed');});
test('tenant A cannot touch B order or use B account',async()=>{
 await assert.rejects(begin(pool,{p_owner_id:other}),/tenant|owner|Pedido/i);
 await pool.query('update amazon_accounts set owner_id=$1',[other]);await assert.rejects(begin(),/tenant|owner|cuenta/i);
 assert.equal((await pool.query('select count(*)::int as n from amazon_confirmation_operations')).rows[0].n,0);
});
test('wrong marketplace or integration account is rejected before an intent',async()=>{
 await assert.rejects(begin(pool,{p_marketplace_id:'FR'}),/marketplace|pedido/i);
 await pool.query('update integration_accounts set owner_id=$1',[other]);await assert.rejects(begin(),/tenant|owner|cuenta/i);
});
test('legacy attempted shipment is verification-only even when no operation was seeded',async()=>{
 await pool.query('update fulfillment_orders set amazon_tracking_sync_attempts=2');const op=await begin();assert.equal(op.send,false);assert.equal(op.verify,true);
});
test('pending confirmation blocks cancellation after lease expiry',async()=>{
 await begin();await pool.query("update fulfillment_orders set order_action_lease_until=now()-interval '1 hour'");
 await assert.rejects(pool.query("select integration_start_cancellation($1,$2,'order','amazon','reference',$3,'{}')",[order,owner,id(8)]),/confirmaci|verific/i);
 assert.equal((await pool.query('select count(*)::int as n from order_cancellation_operations')).rows[0].n,0);
});
test('cancellation holding order lock wins race before confirmation',async()=>{
 const a=await pool.connect(),b=await pool.connect();
 try{await a.query('begin');await a.query("select integration_start_cancellation($1,$2,'order','amazon','reference',$3,'{}')",[order,owner,id(8)]);const next=begin(b);await a.query('commit');await assert.rejects(next,/cancelaci/i);}finally{await a.query('rollback');a.release();b.release();}
});
test('ledger RLS enabled and privileged RPC execution is service-only',async()=>{
 const row=(await pool.query("select relrowsecurity from pg_class where oid='amazon_confirmation_operations'::regclass")).rows[0];assert.equal(row.relrowsecurity,true);
 for(const role of ['anon','authenticated']){
  const privileges=(await pool.query("select bool_or(has_function_privilege($1,p.oid,'EXECUTE')) as allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'amazon_confirmation_%'",[role])).rows[0];assert.equal(privileges.allowed,false);
 }
});
export {pool,begin,finish,payload,id};
test('dispatch consumes one send authorization; expired/stale holder cannot POST',async()=>{
 const op=await begin();const dispatch=(who=holder,fence=op.fence)=>pool.query('select amazon_confirmation_dispatch($1,$2,$3,$4) as allowed',[order,owner,who,fence]);
 assert.equal((await dispatch()).rows[0].allowed,true);assert.equal((await dispatch()).rows[0].allowed,false);
 await pool.query("update amazon_confirmation_operations set lease_until=now()-interval '1 second'");
 assert.equal((await dispatch()).rows[0].allowed,false);
});
test('five empty verification outcomes stop at needs_review without arming submission',async()=>{
 await pool.query('update fulfillment_orders set amazon_tracking_sync_attempts=1');
 for(let i=0;i<5;i++){
  await pool.query("update amazon_confirmation_operations set next_verification_at=now()-interval '1 second'");
  const op=await begin();assert.equal(op.send,false);assert.equal(op.verify,true);await finish(op,'pending_verification',pool,{p_http_status:null});
 }
 assert.equal((await begin()).state,'needs_review');assert.equal((await begin()).send,false);
});
test('review authorization cannot bypass pending; explicit rejected revision preserves history',async()=>{
 const op=await begin();const authorize=()=>pool.query('select amazon_confirmation_authorize($1,$2,$3,$4,$5)',[order,owner,id(8),'Reviewed remote evidence and corrected the invalid payload',payload]);
 await assert.rejects(authorize(),/409/);await finish(op,'rejected',pool,{p_http_status:400});await authorize();
 const next=await begin();assert.equal(next.send,true);assert.equal(next.revision,2);assert.equal(next.history.length,1);
});

// Real Edge module + real PostgreSQL RPCs; only auth identity and Amazon's HTTP boundary are controlled.
function edgeHarness({postStatus=200,loseResponse=false,timeout=false,onPost}={}){
 const outgoing=[];let packages=[];let handler;const modules=new Map();
 const admin={from(table){
  assert.ok(['fulfillment_orders','integration_accounts','amazon_accounts','amazon_orders','amazon_order_items','amazon_confirmation_operations'].includes(table));
  let columns='*',conditions=[],values=[],limit=0,sort='';
  const column=name=>{assert.match(name,/^[a-z_]+$/);return '"'+name+'"'};
  const chain={select(value){columns=value==='*'?'*':value.split(',').map(column).join(',');return this},eq(name,value){values.push(value);conditions.push(`${column(name)}=$${values.length}`);return this},gt(name,value){values.push(value);conditions.push(`${column(name)}>$${values.length}`);return this},is(name,value){assert.equal(value,null);conditions.push(`${column(name)} is null`);return this},not(name,op,value){assert.equal(op,'is');assert.equal(value,null);conditions.push(`${column(name)} is not null`);return this},limit(n){limit=Number(n);return this},order(name,options){sort=` order by ${column(name)} ${options?.ascending===false?'desc':'asc'}`;return this},async execute(single){try{const result=await pool.query(`select ${columns} from ${column(table)}${conditions.length?' where '+conditions.join(' and '):''}${sort}${limit?' limit '+limit:''}`,values);if(single&&result.rows.length>1)throw new Error('multiple rows');return {data:single?result.rows[0]||null:result.rows,error:null};}catch(error){return {data:null,error}}},maybeSingle(){return this.execute(true)},then(resolve,reject){return this.execute(false).then(resolve,reject)}};return chain;
 },async rpc(name,args){
  if(name==='integration_read_secret')return {data:JSON.stringify({refreshToken:'own-synthetic-refresh'}),error:null};
  assert.match(name,/^amazon_confirmation_(begin|finish|dispatch|authorize|due)$/);
  if(name==='amazon_confirmation_due'){const r=await pool.query('select * from amazon_confirmation_due($1,$2,$3)',Object.values(args));return {data:r.rows,error:null};}
  try{const keys=Object.keys(args);const r=await pool.query(`select ${name}(${keys.map((key,i)=>`${key}=>$${i+1}`).join(',')}) as data`,Object.values(args));return {data:r.rows[0].data,error:null};}catch(error){return {data:null,error}};
 }};
 const fetch=async(url,options={})=>{
  const value=String(url),method=options.method||'GET';outgoing.push({url:value,method,...(value.endsWith('/shipmentConfirmation')?{payload:JSON.parse(String(options.body))}:{})});
  if(value==='https://api.amazon.com/auth/o2/token')return new Response(JSON.stringify({access_token:'own-synthetic-access',expires_in:3600}));
  assert.ok(value.startsWith('https://sellingpartnerapi-eu.amazon.com/orders/'),'unexpected external destination');
  if(method==='GET')return new Response(JSON.stringify({order:{orderId:'123-1234567-1234567',packages}}));
  assert.equal(method,'POST');assert.ok(value.endsWith('/shipmentConfirmation'));
  await onPost?.();
  if(loseResponse){packages=[remotePackage()];throw new Error('accepted response lost');}
  if(timeout)throw Object.assign(new Error('request aborted at timeout'),{name:'TimeoutError'});
  return new Response('{}',{status:postStatus,headers:{'x-amzn-requestid':'synthetic-request-id'}});
 };
 function load(file){
  if(modules.has(file))return modules.get(file);
  if(file.endsWith('/amazon/supabase.ts'))return {createAdminClient:()=>admin,authenticateUser:async()=>({role:'admin',data_owner_id:owner,user_id:id(8)})};
  const exports={};modules.set(file,exports);
  const source=readFileSync(file,'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,require:relative=>load(path.resolve(path.dirname(file),relative)),fetch,Response,Headers,URL,URLSearchParams,AbortSignal,AbortController,Date,crypto:globalThis.crypto,setTimeout,clearTimeout,Deno:{env:{get:name=>name==='AMAZON_SPAPI_CREDENTIALS'?JSON.stringify({clientId:'own-app',clientSecret:'own-app-secret'}):''},serve:fn=>{handler=fn}}});return exports;
 }
 const module=load(path.resolve('supabase/functions/_shared/amazon/shipment-confirmation.ts'));
 load(path.resolve('supabase/functions/amazon-confirm-shipment/index.ts'));
 return {outgoing,admin,module,setPackages(value){packages=value},handler:body=>handler({method:'POST',json:async()=>body}),posts:()=>outgoing.filter(r=>r.url.endsWith('/shipmentConfirmation')).length};
}
function remotePackage(){return {packageReferenceId:'1',trackingNumber:'REAL-FIXTURE-ONLY',carrier:'MRW',packageStatus:{status:'SHIPPED'},packageItems:[{orderItemId:'item',quantity:1}]};}
async function due(){await pool.query("update amazon_confirmation_operations set lease_until=null,next_verification_at=now()-interval '1 second'");}
test('real handler and worker helper concurrently produce one POST across real connections',async()=>{
 let reached,release;const entered=new Promise(r=>{reached=r}),barrier=new Promise(r=>{release=r});
 const h=edgeHarness({postStatus:500,onPost:async()=>{reached();await barrier}});
 const first=h.handler({action:'confirm_order_tracking',orderId:order});await entered;
 const worker=await h.module.retryPendingAmazonTracking(h.admin,owner,5,true);assert.equal(worker.attempted,0);assert.equal(h.posts(),1);
 const concurrent=await h.handler({orderId:order});assert.equal(concurrent.status,202);assert.equal(h.posts(),1);
 release();assert.equal((await first).status,202);assert.equal(h.posts(),1);
 await due();h.setPackages([remotePackage()]);const next=await h.handler({action:'confirm_order_tracking',orderId:order});assert.equal((await next.json()).status,'confirmed');assert.equal(h.posts(),1);
});
for(const scenario of ['lost response','timeout','500'])test(`real handler ${scenario} stays pending until exact read; no duplicate POST`,async()=>{
 const h=edgeHarness({loseResponse:scenario==='lost response',timeout:scenario==='timeout',postStatus:scenario==='500'?500:200});
 assert.equal((await h.handler({orderId:order})).status,202);assert.equal(h.posts(),1);
 await due();h.setPackages([remotePackage()]);const next=await h.handler({orderId:order});assert.equal((await next.json()).status,'confirmed');assert.equal(h.posts(),1);
});
test('real handler repairs a failed success save using GET without a second POST',async()=>{
 const h=edgeHarness();await pool.query("create function fail_success() returns trigger language plpgsql as $$ begin if new.amazon_tracking_synced_at is not null then raise exception 'injected save failure';end if;return new;end $$;create trigger injected before update on fulfillment_orders for each row execute function fail_success()");
 try{assert.equal((await h.handler({orderId:order})).status,202);assert.equal(h.posts(),1);}finally{await pool.query('drop trigger injected on fulfillment_orders;drop function fail_success()');}
 await due();h.setPackages([remotePackage()]);assert.equal((await (await h.handler({orderId:order})).json()).status,'confirmed');assert.equal(h.posts(),1);
});
test('force, changed tracking and 400 cannot silently authorize a new send',async()=>{
 const h=edgeHarness({postStatus:400});const response=await h.handler({orderId:order});assert.equal((await response.json()).status,'rejected');assert.equal(h.posts(),1);
 await h.module.retryPendingAmazonTracking(h.admin,owner,5,true);assert.equal(h.posts(),1);
});
test('verification dispatch excludes terminal review and respects due time',async()=>{
 const op=await begin();await finish(op,'needs_review');
 const rows=await pool.query('select * from amazon_confirmation_due($1,5,false)',[owner]);assert.equal(rows.rows.length,0);
});
test('real handler stops after bounded empty evidence and never resubmits',async()=>{
 const h=edgeHarness({postStatus:500});await h.handler({orderId:order});
 for(let i=0;i<4;i++){await due();await h.handler({orderId:order});}
 assert.equal((await (await h.handler({orderId:order})).json()).status,'needs_review');assert.equal(h.posts(),1);
 const worker=await h.module.retryPendingAmazonTracking(h.admin,owner,1,true);assert.equal(worker.attempted,0);
});
test('real pending tracking override returns 409 with one intent and one POST',async()=>{
 const h=edgeHarness({postStatus:500});await h.handler({orderId:order});
 const response=await h.handler({orderId:order,trackingOverride:{trackingNumber:'DIFFERENT'}});assert.equal(response.status,409);assert.equal(h.posts(),1);
});
test('late in-flight holder cannot finalize after a verifier acquired the fence',async()=>{
 let reached,release;const entered=new Promise(r=>{reached=r}),barrier=new Promise(r=>{release=r});
 const h=edgeHarness({onPost:async()=>{reached();await barrier}}),first=h.handler({orderId:order});await entered;
 await due();const verification=await h.handler({orderId:order});assert.equal(verification.status,202);
 release();assert.equal((await first).status,202);assert.equal(h.posts(),1);
 await due();h.setPackages([remotePackage()]);assert.equal((await (await h.handler({orderId:order})).json()).status,'confirmed');assert.equal(h.posts(),1);
});
test('crash before the POST remains GET-only in the real handler',async()=>{
 await begin();await due();const h=edgeHarness();const response=await h.handler({orderId:order});assert.equal(response.status,202);assert.equal(h.posts(),0);
});
test('handler rejects crossed owner/account before token acquisition or any external request',async()=>{
 await pool.query('update amazon_accounts set owner_id=$1',[other]);const h=edgeHarness();const response=await h.handler({orderId:order});assert.equal(response.status,500);assert.equal(h.outgoing.length,0);
 assert.equal((await pool.query('select count(*)::int as n from amazon_confirmation_operations')).rows[0].n,0);
});
test('review authorization and prepared dispatch both respect an active shipping lease',async()=>{
 const op=await begin();await finish(op,'rejected',pool,{p_http_status:400});
 await pool.query('select integration_claim_order_shipping($1,$2,$3)',[order,owner,id(10)]);
 await assert.rejects(pool.query('select amazon_confirmation_authorize($1,$2,$3,$4)',[order,owner,id(8),'Reviewed exact package and corrected target tracking']),/envío|shipping/i);
 await pool.query('update fulfillment_orders set order_action_lease=null,order_action_lease_until=null');
 await pool.query('select amazon_confirmation_authorize($1,$2,$3,$4,$5)',[order,owner,id(8),'Reviewed exact package and corrected target tracking',payload]);
 await pool.query('select integration_claim_order_shipping($1,$2,$3)',[order,owner,id(10)]).catch(()=>{});
 // Simulate an already in-flight shipping owner, independent of the new ledger gate.
 await pool.query("update fulfillment_orders set order_action_lease_until=now()+interval '1 minute'");
 await assert.rejects(begin(),/envío|shipping/i);
});
test('review binds the immutable target; workers cannot consume prepared revisions',async()=>{
 const op=await begin();await finish(op,'rejected',pool,{p_http_status:400});
 const reviewed={...payload,packageDetail:{...payload.packageDetail,trackingNumber:'CORRECTED'}};
 await pool.query('select amazon_confirmation_authorize($1,$2,$3,$4,$5)',[order,owner,id(8),'Reviewed the corrected tracking with exact Amazon package evidence',reviewed]);
 assert.equal((await pool.query('select * from amazon_confirmation_due($1,5,true)',[owner])).rows.length,0);
 await assert.rejects(begin(),/409/);const next=await begin(pool,{p_payload:reviewed});assert.equal(next.payload.packageDetail.trackingNumber,'CORRECTED');
});
test('historical unknown package can recover through an explicit reviewed reference',async()=>{
 await pool.query('update fulfillment_orders set amazon_tracking_sync_attempts=2');
 const op=await begin(pool,{p_payload:{...payload,packageDetail:{...payload.packageDetail,packageReferenceId:null}}});await finish(op,'needs_review');
 const h=edgeHarness();const authorized=await h.handler({action:'authorize_reviewed_attempt',orderId:order,reviewReason:'Reviewed exact package reference from Amazon before new submission',packageReferenceId:'7'});assert.equal(authorized.status,200);
 const response=await h.handler({orderId:order});assert.equal((await response.json()).status,'confirmed');assert.equal(h.posts(),1);
 assert.equal((await pool.query('select package_reference_id from amazon_confirmation_operations')).rows[0].package_reference_id,'7');
});
test('review audit rejects NULL reasons and stores history without recursive nesting',async()=>{
 const op=await begin();await finish(op,'rejected',pool,{p_http_status:400});
 await assert.rejects(pool.query('select amazon_confirmation_authorize($1,$2,$3,$4,$5)',[order,owner,id(8),null,payload]),/documentar|revisión/i);
 await pool.query('select amazon_confirmation_authorize($1,$2,$3,$4,$5)',[order,owner,id(8),'Reviewed exact submitted package with evidence',payload]);
 const row=(await pool.query('select history from amazon_confirmation_operations')).rows[0];assert.equal(row.history.length,1);assert.equal(Object.hasOwn(row.history[0],'history'),false);
});
test('canonical Amazon order number fallback keeps legitimate legacy usage working',async()=>{
 await pool.query("update fulfillment_orders set order_id='legacy-prefixed-reference',order_number='123-1234567-1234567'");const op=await begin();assert.equal(op.send,true);assert.equal(op.amazon_order_id,'123-1234567-1234567');
});
test('reviewed corrected tracking is frozen before explicit submission, never consumed by worker',async()=>{
 const rejected=edgeHarness({postStatus:400});await rejected.handler({orderId:order});
 const next=edgeHarness();const response=await next.handler({action:'authorize_reviewed_attempt',orderId:order,reviewReason:'Verified exact package and corrected tracking against shipping evidence',trackingOverride:{trackingNumber:'CORRECTED'}});assert.equal(response.status,200);
 const worker=await next.module.retryPendingAmazonTracking(next.admin,owner,5,true);assert.equal(worker.attempted,0);assert.equal(next.posts(),0);
 const sent=await next.handler({orderId:order});assert.equal((await sent.json()).trackingNumber,'CORRECTED');assert.equal(next.posts(),1);
 const post=next.outgoing.find(r=>r.url.endsWith('/shipmentConfirmation'));assert.equal(post.payload.packageDetail.trackingNumber,'CORRECTED');
});
