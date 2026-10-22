// @vitest-environment node
import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';

const migrations='supabase/migrations/';
const read=(name:string)=>readFileSync(migrations+name,'utf8');
const setup=async()=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema private;create table integration_accounts(id uuid primary key,owner_id uuid,provider text,enabled boolean,status text);create table workspaces(id uuid primary key,status text);`+readFileSync('tests/fixtures/orders-table-schema.sql','utf8')+`alter table fulfillment_orders add primary key(id);`);
 for(const file of ['20261022053808_shipment_tracking_shadow.sql','20261022055814_shipment_tracking_terminal_guards.sql','20261022060055_shipment_tracking_provider_event_time.sql','20261022060645_shipment_tracking_privacy.sql'])await db.exec(read(file));
 await db.exec(`insert into workspaces values(md5('owner')::uuid,'active');insert into integration_accounts values(md5('account')::uuid,md5('owner')::uuid,'sendcloud',true,'active');insert into fulfillment_orders(id,owner_id,shipping_integration_account_id,sendcloud_id,source_status,tracking_number,shipping_provider,sendcloud_parcel_id,label_created_at,order_created_at,tracking_status_code,items,shipping_address,raw_payload) values(md5('order')::uuid,md5('owner')::uuid,md5('account')::uuid,'1','SHIPPED','T1','sendcloud',1,now(),now(),'SHIPPED','[]','{}','{}');select tracking_seed_shadow();select tracking_claim(md5('run')::uuid,25);`);
 return db;
};
const apply=async(db:PGlite)=>{
 await db.exec(read('20261022095709_shipment_tracking_finish_account_guard.sql'));
};
const snapshot=async(db:PGlite)=>(await db.query<any>(`select (select to_jsonb(s) from shipment_tracking_state s) state,(select jsonb_agg(to_jsonb(e)) from shipment_tracking_events e) events,(select to_jsonb(o) from fulfillment_orders o) orders`)).rows[0];
const finish=async(db:PGlite,error:string|null=null)=>(await db.query<any>(`select tracking_finish(md5('order')::uuid,md5('run')::uuid,identity_key,$1::jsonb,now()+interval '1 hour',$2) applied from shipment_tracking_state`,[JSON.stringify({state:'in_transit',code:'SHIPPED',message:'Carrier movement',eventAt:'2026-10-22T10:00:00Z',eventTimeRaw:'2026-10-22 10:00:00',observedAt:'2026-10-22T10:01:00Z',movementAt:'2026-10-22T10:00:00Z'}),error])).rows[0].applied;

it.each([
 ['disabled account',`update integration_accounts set enabled=false`],
 ['disabled account status',`update integration_accounts set status='disabled'`],
 ['moved account owner',`update integration_accounts set owner_id=md5('other')::uuid`],
 ['changed account provider',`update integration_accounts set provider='envia'`],
 ['inactive workspace',`update workspaces set status='disabled'`],
 ['missing account',`delete from integration_accounts`],
 ['missing workspace',`delete from workspaces`],
])('rejects an in-flight observation after %s',async(_label,change)=>{
 const db=await setup();try{
  await apply(db);await db.exec(change);const before=await snapshot(db);
  expect(await finish(db)).toBe(false);expect(await snapshot(db)).toEqual(before);
 }finally{await db.close()}
},20000);

it('preserves valid finish, errors, terminal/identity guards, ACLs and invoker security',async()=>{
 const db=await setup();try{
  const contract=(await db.query<any>(`select oid,prosecdef,proacl::text acl from pg_proc where oid='tracking_finish(uuid,uuid,text,jsonb,timestamptz,text)'::regprocedure`)).rows[0];
  const before=await snapshot(db);await apply(db);expect(await snapshot(db)).toEqual(before);
  expect((await db.query<any>(`select oid,prosecdef,proacl::text acl from pg_proc where oid='tracking_finish(uuid,uuid,text,jsonb,timestamptz,text)'::regprocedure`)).rows[0]).toEqual(contract);
  expect((await db.query<any>(`select proconfig from pg_proc where oid='tracking_finish(uuid,uuid,text,jsonb,timestamptz,text)'::regprocedure`)).rows[0].proconfig).toContain('lock_timeout=25ms');
  expect((await db.query<any>(`select current_setting('lock_timeout') timeout`)).rows[0].timeout).toBe('0');
  await db.exec(`update workspaces set status='trialing'`);
  expect(await finish(db)).toBe(true);
  const valid=await snapshot(db);expect(valid.orders).toEqual(before.orders);expect(valid.state.normalized_state).toBe('in_transit');expect(valid.state.raw_event_time).toBe('2026-10-22 10:00:00');expect(valid.events).toHaveLength(1);
  await db.exec(`update shipment_tracking_state set lease_id=md5('run')::uuid,lease_until=now()+interval '3 minutes'`);
  expect(await finish(db,'TRACKING_PROVIDER_UNAVAILABLE')).toBe(true);
  const failed=await snapshot(db);expect(failed.orders).toEqual(before.orders);expect(failed.state.normalized_state).toBe('in_transit');expect(failed.state.failures).toBe(1);expect(failed.state.last_error).toBe('TRACKING_PROVIDER_UNAVAILABLE');expect(failed.events).toHaveLength(1);
  for(const change of [`update fulfillment_orders set tracking_status_code='DELIVERED'`,`update fulfillment_orders set tracking_status_code='SHIPPED',tracking_number='OTHER'`]){
   await db.exec(`update shipment_tracking_state set lease_id=md5('run')::uuid,lease_until=now()+interval '3 minutes';`+change);const guarded=await snapshot(db);expect(await finish(db)).toBe(false);expect(await snapshot(db)).toEqual(guarded);
  }
  await db.exec('set role authenticated');await expect(finish(db)).rejects.toThrow('permission denied');await db.exec('reset role');
 }finally{await db.close()}
},20000);

it('omits lock failures without partially persisting a movement',async()=>{
 const db=await setup();try{
  await apply(db);const before=await snapshot(db);
  // PGlite cannot contend across sessions. Inject PostgreSQL's lock timeout
  // SQLSTATE during the state update, after the event was inserted, to verify
  // the exception rolls back that earlier event along with all state writes.
  await db.exec(`create function reject_busy_write() returns trigger language plpgsql as $$begin raise exception 'busy' using errcode='55P03';end$$;create trigger busy before update on shipment_tracking_state for each row execute function reject_busy_write();`);
  expect(await finish(db)).toBe(false);expect(await snapshot(db)).toEqual(before);
 }finally{await db.close()}
},20000);
