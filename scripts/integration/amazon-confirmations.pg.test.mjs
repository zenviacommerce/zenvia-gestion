import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
const url=process.env.PG_TEST_URL;
if(!url||new URL(url).pathname!=='/confirmations_test')throw new Error('PG_TEST_URL must name the disposable confirmations_test database');
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
 await pool.query('truncate fulfillment_orders,amazon_accounts,integration_accounts,amazon_orders,order_cancellation_operations cascade');
 await pool.query('insert into integration_accounts(id,owner_id) values($1,$2)',[integration,owner]);
 await pool.query('insert into amazon_accounts values($1,$2,$3)',[account,owner,integration]);
 await pool.query("insert into fulfillment_orders(id,owner_id,order_id,source_integration_account_id,tracking_number) values($1,$2,'123-1234567-1234567',$3,'REAL-FIXTURE-ONLY')",[order,owner,integration]);
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
